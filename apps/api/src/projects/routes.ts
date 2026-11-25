import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { HttpError, noStore, requireAuth } from '../auth/middleware.ts';
import { db } from '../db/index.ts';
import {
  boardColumns,
  defaultBoardColumns,
  intakeItems,
  modules,
  type Project,
  projectMembers,
  projects,
  tasks,
  users,
} from '../db/schema.ts';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const id = z.uuid();
const name = z.string().trim().min(1).max(200);
const description = z.string().max(20_000);
const role = z.enum(['viewer', 'commenter', 'editor']);
const intent = z.enum(['none', 'primary', 'success', 'warning', 'danger']);

/** Clients may pick the id (they create items optimistically); otherwise the database does. */
const projectCreate = z.object({ id: id.optional(), name, description: description.optional() });
const projectPatch = z
  .object({ name, description, linkAccess: z.enum(['restricted', 'anyone']), linkRole: role })
  .partial();
const inviteBody = z.object({
  usernames: z.array(z.string().trim().toLowerCase().min(1).max(64)).min(1).max(50),
  role,
});
const memberPatch = z.object({ role });

const checklistItem = z.object({ id: z.string().min(1).max(64), title: z.string().max(500), done: z.boolean() });
const taskFields = z.object({
  columnId: id,
  position: z.number().int().min(0),
  title: z.string().max(200),
  description,
  labels: z.string().max(1000),
  /** '' or null unassigns. */
  assigneeId: z.union([id, z.literal(''), z.null()]).transform((v) => v || null),
  dueDate: z.union([z.literal(''), z.iso.date()]),
  /** '' or null clears the module. */
  moduleId: z.union([id, z.literal(''), z.null()]).transform((v) => v || null),
  checklist: z.array(checklistItem).max(500),
});
const taskCreate = taskFields
  .partial()
  .extend({ id: id.optional(), title: taskFields.shape.title, columnId: taskFields.shape.columnId });
const taskPatch = taskFields.partial();

const columnFields = z.object({ title: z.string().trim().min(1).max(100), intent, position: z.number().int().min(0) });
const columnCreate = columnFields.partial({ intent: true, position: true }).extend({ id: id.optional() });
const columnPatch = columnFields.partial();

const moduleCreate = z.object({ id: id.optional(), name, description: description.optional() });
const modulePatch = z.object({ name, description }).partial();
const intakeCreate = z.object({ id: id.optional(), title: name, description: description.optional() });
const intakePatch = z.object({ title: name, description }).partial();

const searchQuery = z.object({ q: z.string().trim().toLowerCase().max(64).default('') });

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

type Role = 'owner' | 'viewer' | 'commenter' | 'editor';
type Need = 'read' | 'edit' | 'own';

function userId(req: Request): string {
  return req.auth!.user.id;
}

function allows(role: Role, need: Need): boolean {
  if (need === 'own') return role === 'owner';
  if (need === 'edit') return role === 'owner' || role === 'editor';
  return true;
}

/**
 * Loads a project the current user owns or has accepted an invitation to. Anything else is a
 * 404, so project ids of other people's projects are never confirmed.
 */
async function projectAccess(req: Request, need: Need): Promise<{ project: Project; role: Role }> {
  const projectId = id.safeParse(req.params.projectId);
  if (!projectId.success) throw new HttpError(404, 'Project not found');
  const [row] = await db
    .select({ project: projects, memberRole: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, userId(req)),
        eq(projectMembers.status, 'accepted'),
      ),
    )
    .where(eq(projects.id, projectId.data));
  if (!row) throw new HttpError(404, 'Project not found');
  const role: Role | null =
    row.project.ownerId === userId(req)
      ? 'owner'
      : (row.memberRole ?? (row.project.linkAccess === 'anyone' ? row.project.linkRole : null));
  if (!role) throw new HttpError(404, 'Project not found');
  if (!allows(role, need)) throw new HttpError(403, need === 'own' ? 'Only the owner can do this' : 'You have view-only access');
  return { project: row.project, role };
}

function paramId(req: Request, key: string): string {
  const parsed = id.safeParse(req.params[key]);
  if (!parsed.success) throw new HttpError(404, 'Not found');
  return parsed.data;
}

async function assertModuleInProject(projectId: string, moduleId: string | null | undefined) {
  if (!moduleId) return;
  const [found] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
  if (!found) throw new HttpError(400, 'Module does not belong to this project');
}

async function assertColumnInProject(projectId: string, columnId: string | undefined) {
  if (!columnId) return;
  const [found] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)));
  if (!found) throw new HttpError(400, 'Column does not belong to this project');
}

/** Only people who can open the project (owner or accepted member) can be assigned. */
async function assertAssignable(project: Project, assigneeId: string | null | undefined) {
  if (!assigneeId || assigneeId === project.ownerId) return;
  const [member] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, assigneeId),
        eq(projectMembers.status, 'accepted'),
      ),
    );
  if (!member) throw new HttpError(400, 'Assignee must be a member of this project');
}

function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new HttpError(404, `${what} not found`);
  return row;
}

/** Turns a duplicate client-chosen id into a 409 instead of a 500. */
async function insertOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === '23505') throw new HttpError(409, 'Already exists');
    throw err;
  }
}

const owners = alias(users, 'owners');

async function serializeProject(project: Project, role: Role) {
  const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, project.ownerId));
  const people = await db
    .select({
      userId: projectMembers.userId,
      username: users.username,
      role: projectMembers.role,
      status: projectMembers.status,
      addedAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, project.id))
    .orderBy(asc(projectMembers.createdAt));
  const { updatedAt: _updatedAt, ...rest } = project;
  return { ...rest, owner: owner?.username ?? '', myRole: role, people };
}

/** The client uses '' for "none". */
const serializeTask = <T extends { moduleId: string | null; assigneeId: string | null }>(t: T) => ({
  ...t,
  moduleId: t.moduleId ?? '',
  assigneeId: t.assigneeId ?? '',
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const projectsRouter = Router();
projectsRouter.use(noStore, requireAuth);

// Projects and invitations ----------------------------------------------------

/** Projects the user owns or has joined, plus invitations still waiting for an answer. */
projectsRouter.get('/', async (req, res) => {
  const me = userId(req);
  const rows = await db
    .select({ project: projects, memberRole: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, me), eq(projectMembers.status, 'accepted')),
    )
    .where(or(eq(projects.ownerId, me), sql`${projectMembers.userId} is not null`))
    .orderBy(asc(projects.createdAt));

  const invites = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      owner: owners.username,
      role: projectMembers.role,
      invitedAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(owners, eq(owners.id, projects.ownerId))
    .where(and(eq(projectMembers.userId, me), eq(projectMembers.status, 'pending')))
    .orderBy(asc(projectMembers.createdAt));

  res.json({
    projects: await Promise.all(
      rows.map((r) => serializeProject(r.project, r.project.ownerId === me ? 'owner' : r.memberRole!)),
    ),
    invites,
  });
});

projectsRouter.post('/', async (req, res) => {
  const body = projectCreate.parse(req.body);
  const project = await insertOnce(() =>
    db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({ ...body, ownerId: userId(req) }).returning();
      await tx
        .insert(boardColumns)
        .values(defaultBoardColumns.map((c, position) => ({ ...c, position, projectId: created!.id })));
      return created;
    }),
  );
  res.status(201).json({ project: await serializeProject(project!, 'owner') });
});

projectsRouter.post('/:projectId/invite/accept', async (req, res) => {
  const projectId = paramId(req, 'projectId');
  one(
    await db
      .update(projectMembers)
      .set({ status: 'accepted' })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId(req)), eq(projectMembers.status, 'pending')))
      .returning({ projectId: projectMembers.projectId }),
    'Invitation',
  );
  const { project, role } = await projectAccess(req, 'read');
  res.json({ project: await serializeProject(project, role) });
});

projectsRouter.post('/:projectId/invite/decline', async (req, res) => {
  const projectId = paramId(req, 'projectId');
  one(
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId(req)), eq(projectMembers.status, 'pending')))
      .returning({ projectId: projectMembers.projectId }),
    'Invitation',
  );
  res.status(204).end();
});

/** Project plus all of its data (tasks, modules, intake), matching the client's ProjectData. */
projectsRouter.get('/:projectId', async (req, res) => {
  const { project, role } = await projectAccess(req, 'read');
  const [columnRows, taskRows, moduleRows, intakeRows] = await Promise.all([
    db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.projectId, project.id))
      .orderBy(asc(boardColumns.position), asc(boardColumns.createdAt)),
    db.select().from(tasks).where(eq(tasks.projectId, project.id)).orderBy(asc(tasks.position), asc(tasks.createdAt)),
    db.select().from(modules).where(eq(modules.projectId, project.id)).orderBy(asc(modules.createdAt)),
    db.select().from(intakeItems).where(eq(intakeItems.projectId, project.id)).orderBy(asc(intakeItems.createdAt)),
  ]);
  res.json({
    project: await serializeProject(project, role),
    data: { columns: columnRows, tasks: taskRows.map(serializeTask), modules: moduleRows, intake: intakeRows },
  });
});

projectsRouter.patch('/:projectId', async (req, res) => {
  const body = projectPatch.parse(req.body);
  // Renaming is editing; changing who can open the project is the owner's call.
  const sharing = body.linkAccess !== undefined || body.linkRole !== undefined;
  const { project, role } = await projectAccess(req, sharing ? 'own' : 'edit');
  const [updated] = await db.update(projects).set(body).where(eq(projects.id, project.id)).returning();
  res.json({ project: await serializeProject(updated!, role) });
});

projectsRouter.delete('/:projectId', async (req, res) => {
  const { project } = await projectAccess(req, 'own');
  await db.delete(projects).where(eq(projects.id, project.id));
  res.status(204).end();
});

// Members -------------------------------------------------------------------

/** Invites existing users by username. Each one sees the project as a pending invitation. */
projectsRouter.post('/:projectId/members', async (req, res) => {
  const { project, role } = await projectAccess(req, 'own');
  const body = inviteBody.parse(req.body);
  const usernames = [...new Set(body.usernames.map((u) => u.replace(/^@/, '').normalize('NFKC')))];
  const found = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(inArray(users.username, usernames), ne(users.id, project.ownerId)));
  const missing = usernames.filter((u) => !found.some((f) => f.username === u));
  if (missing.length) throw new HttpError(400, `No user named ${missing.map((u) => '@' + u).join(', ')}`);
  await db
    .insert(projectMembers)
    .values(found.map((u) => ({ projectId: project.id, userId: u.id, role: body.role, invitedBy: userId(req) })))
    .onConflictDoNothing();
  res.json({ project: await serializeProject(project, role) });
});

projectsRouter.patch('/:projectId/members/:userId', async (req, res) => {
  const { project, role } = await projectAccess(req, 'own');
  const body = memberPatch.parse(req.body);
  one(
    await db
      .update(projectMembers)
      .set(body)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, paramId(req, 'userId'))))
      .returning({ userId: projectMembers.userId }),
    'Member',
  );
  res.json({ project: await serializeProject(project, role) });
});

/** The owner removes someone (or withdraws an invitation), or a member leaves. */
projectsRouter.delete('/:projectId/members/:userId', async (req, res) => {
  const target = paramId(req, 'userId');
  const { project } = await projectAccess(req, target === userId(req) ? 'read' : 'own');
  await db.transaction(async (tx) => {
    one(
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, target)))
        .returning({ userId: projectMembers.userId }),
      'Member',
    );
    // Someone who can no longer open the project shouldn't stay assigned to its work.
    await tx
      .update(tasks)
      .set({ assigneeId: null })
      .where(and(eq(tasks.projectId, project.id), eq(tasks.assigneeId, target)));
  });
  res.status(204).end();
});

// Board columns -------------------------------------------------------------

projectsRouter.post('/:projectId/columns', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = columnCreate.parse(req.body);
  const [column] = await insertOnce(() => db.insert(boardColumns).values({ ...body, projectId: project.id }).returning());
  res.status(201).json({ column });
});

projectsRouter.patch('/:projectId/columns/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = columnPatch.parse(req.body);
  const rows = await db
    .update(boardColumns)
    .set(body)
    .where(and(eq(boardColumns.id, paramId(req, 'itemId')), eq(boardColumns.projectId, project.id)))
    .returning();
  res.json({ column: one(rows, 'Column') });
});

/** Refused while the column still holds work items, and for a project's last column. */
projectsRouter.delete('/:projectId/columns/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const columnId = paramId(req, 'itemId');
  await db.transaction(async (tx) => {
    const [held] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, project.id), eq(tasks.columnId, columnId)))
      .limit(1);
    if (held) throw new HttpError(409, 'Move the work items out of this column first');
    const others = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(and(eq(boardColumns.projectId, project.id), ne(boardColumns.id, columnId)))
      .limit(1);
    if (!others.length) throw new HttpError(409, 'A board needs at least one column');
    one(
      await tx
        .delete(boardColumns)
        .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, project.id)))
        .returning({ id: boardColumns.id }),
      'Column',
    );
  });
  res.status(204).end();
});

// Tasks ---------------------------------------------------------------------

projectsRouter.post('/:projectId/tasks', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = taskCreate.parse(req.body);
  await assertColumnInProject(project.id, body.columnId);
  await assertModuleInProject(project.id, body.moduleId);
  await assertAssignable(project, body.assigneeId);
  const [task] = await insertOnce(() => db.insert(tasks).values({ ...body, projectId: project.id }).returning());
  res.status(201).json({ task: serializeTask(task!) });
});

projectsRouter.patch('/:projectId/tasks/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = taskPatch.parse(req.body);
  await assertColumnInProject(project.id, body.columnId);
  await assertModuleInProject(project.id, body.moduleId);
  await assertAssignable(project, body.assigneeId);
  const rows = await db
    .update(tasks)
    .set(body)
    .where(and(eq(tasks.id, paramId(req, 'itemId')), eq(tasks.projectId, project.id)))
    .returning();
  res.json({ task: serializeTask(one(rows, 'Task')) });
});

projectsRouter.delete('/:projectId/tasks/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  one(
    await db
      .delete(tasks)
      .where(and(eq(tasks.id, paramId(req, 'itemId')), eq(tasks.projectId, project.id)))
      .returning({ id: tasks.id }),
    'Task',
  );
  res.status(204).end();
});

// Modules -------------------------------------------------------------------

projectsRouter.post('/:projectId/modules', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = moduleCreate.parse(req.body);
  const [mod] = await insertOnce(() => db.insert(modules).values({ ...body, projectId: project.id }).returning());
  res.status(201).json({ module: mod });
});

projectsRouter.patch('/:projectId/modules/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = modulePatch.parse(req.body);
  const rows = await db
    .update(modules)
    .set(body)
    .where(and(eq(modules.id, paramId(req, 'itemId')), eq(modules.projectId, project.id)))
    .returning();
  res.json({ module: one(rows, 'Module') });
});

/** Tasks in the module are kept and unassigned (FK is ON DELETE SET NULL). */
projectsRouter.delete('/:projectId/modules/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  one(
    await db
      .delete(modules)
      .where(and(eq(modules.id, paramId(req, 'itemId')), eq(modules.projectId, project.id)))
      .returning({ id: modules.id }),
    'Module',
  );
  res.status(204).end();
});

// Intake --------------------------------------------------------------------

projectsRouter.post('/:projectId/intake', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = intakeCreate.parse(req.body);
  const [item] = await insertOnce(() => db.insert(intakeItems).values({ ...body, projectId: project.id }).returning());
  res.status(201).json({ item });
});

projectsRouter.patch('/:projectId/intake/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  const body = intakePatch.parse(req.body);
  const rows = await db
    .update(intakeItems)
    .set(body)
    .where(and(eq(intakeItems.id, paramId(req, 'itemId')), eq(intakeItems.projectId, project.id)))
    .returning();
  res.json({ item: one(rows, 'Intake item') });
});

projectsRouter.delete('/:projectId/intake/:itemId', async (req, res) => {
  const { project } = await projectAccess(req, 'edit');
  one(
    await db
      .delete(intakeItems)
      .where(and(eq(intakeItems.id, paramId(req, 'itemId')), eq(intakeItems.projectId, project.id)))
      .returning({ id: intakeItems.id }),
    'Intake item',
  );
  res.status(204).end();
});

// Users ---------------------------------------------------------------------

/** Username lookup for the share dialog. Prefix match only; returns nothing else about users. */
export const usersRouter = Router();
usersRouter.use(noStore, requireAuth);

usersRouter.get('/search', async (req, res) => {
  const { q } = searchQuery.parse(req.query);
  const needle = q.replace(/^@/, '');
  if (!needle) {
    res.json({ users: [] });
    return;
  }
  const escaped = needle.replace(/[\\%_]/g, (c) => '\\' + c);
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(sql`${users.username} like ${escaped + '%'}`, ne(users.id, userId(req))))
    .orderBy(asc(users.username))
    .limit(10);
  res.json({ users: rows });
});

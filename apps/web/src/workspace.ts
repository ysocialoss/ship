import { projectsApi } from './api'
import type { ColumnId } from './boardColumns'

export interface ChecklistItem {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  column: ColumnId
  title: string
  description: string
  labels: string
  /** User id of the owner or a member, or '' for unassigned. */
  assigneeId: string
  dueDate: string
  /** Id of the module this work item belongs to, or '' for none. */
  moduleId: string
  checklist: ChecklistItem[]
}

export interface Module {
  id: string
  name: string
  description: string
}

export interface IntakeItem {
  id: string
  title: string
  description: string
  createdAt: string
}

export type ShareRole = 'viewer' | 'commenter' | 'editor'
export type ProjectRole = 'owner' | ShareRole

/** Someone a project is shared with. Pending until they accept the invitation. */
export interface Member {
  userId: string
  username: string
  role: ShareRole
  status: 'pending' | 'accepted'
  addedAt: string
}

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
  /** Owner's username. */
  owner: string
  ownerId: string
  myRole: ProjectRole
  people: Member[]
  linkAccess: 'restricted' | 'anyone'
  linkRole: ShareRole
}

/** A project someone shared with the current user that they haven't accepted or declined yet. */
export interface Invite {
  projectId: string
  projectName: string
  owner: string
  role: ShareRole
  invitedAt: string
}

/** Everything that belongs to a single project. */
export interface ProjectData {
  tasks: Task[]
  modules: Module[]
  intake: IntakeItem[]
}

export function emptyProjectData(): ProjectData {
  return { tasks: [], modules: [], intake: [] }
}

export interface Assignable {
  id: string
  username: string
}

/** People a work item can be assigned to: the owner and everyone who accepted an invitation. */
export function assignablePeople(project: Project): Assignable[] {
  return [
    { id: project.ownerId, username: project.owner },
    ...project.people
      .filter((person) => person.status === 'accepted')
      .map((person) => ({ id: person.userId, username: person.username })),
  ]
}

export const canEdit = (project: Project) => project.myRole === 'owner' || project.myRole === 'editor'

// ---------------------------------------------------------------------------
// Syncing: components hand over whole ProjectData snapshots; send only what changed.
// ---------------------------------------------------------------------------

type Kind = 'tasks' | 'modules' | 'intake'
type Op =
  | { type: 'create'; kind: Kind; body: object }
  | { type: 'update'; kind: Kind; id: string; body: object }
  | { type: 'remove'; kind: Kind; id: string }

const taskFields = ['column', 'title', 'description', 'labels', 'assigneeId', 'dueDate', 'moduleId', 'checklist'] as const
const moduleFields = ['name', 'description'] as const
const intakeFields = ['title', 'description'] as const

function changed<T extends { id: string }>(prev: T, next: T, fields: readonly (keyof T)[]) {
  const patch: Record<string, unknown> = {}
  for (const field of fields) {
    if (JSON.stringify(prev[field]) !== JSON.stringify(next[field])) patch[field as string] = next[field]
  }
  return patch
}

function diffList<T extends { id: string }>(
  kind: Kind,
  prev: T[],
  next: T[],
  fields: readonly (keyof T)[],
  extra: (item: T, index: number) => object = () => ({}),
  extraChanged: (item: T, index: number, before: T, beforeIndex: number) => object = () => ({}),
): { creates: Op[]; updates: Op[]; removes: Op[] } {
  const before = new Map(prev.map((item, index) => [item.id, { item, index }]))
  const after = new Set(next.map((item) => item.id))
  const creates: Op[] = []
  const updates: Op[] = []
  next.forEach((item, index) => {
    const old = before.get(item.id)
    if (!old) {
      const body: Record<string, unknown> = { id: item.id, ...extra(item, index) }
      for (const field of fields) body[field as string] = item[field]
      creates.push({ type: 'create', kind, body })
      return
    }
    const patch = { ...changed(old.item, item, fields), ...extraChanged(item, index, old.item, old.index) }
    if (Object.keys(patch).length) updates.push({ type: 'update', kind, id: item.id, body: patch })
  })
  const removes: Op[] = prev.filter((item) => !after.has(item.id)).map((item) => ({ type: 'remove', kind, id: item.id }))
  return { creates, updates, removes }
}

/** Ordered so references hold: modules exist before tasks use them; tasks leave before modules go. */
export function diffProjectData(prev: ProjectData, next: ProjectData): Op[] {
  const position = (_: Task, index: number) => ({ position: index })
  const moved = (_: Task, index: number, __: Task, oldIndex: number) => (index !== oldIndex ? { position: index } : {})
  const m = diffList('modules', prev.modules, next.modules, moduleFields)
  const t = diffList('tasks', prev.tasks, next.tasks, taskFields, position, moved)
  const i = diffList('intake', prev.intake, next.intake, intakeFields)
  return [...m.creates, ...m.updates, ...t.creates, ...t.updates, ...t.removes, ...m.removes, ...i.creates, ...i.updates, ...i.removes]
}

export async function applyOps(projectId: string, ops: Op[]): Promise<void> {
  for (const op of ops) {
    if (op.type === 'create') await projectsApi.createItem(projectId, op.kind, op.body)
    else if (op.type === 'update') await projectsApi.updateItem(projectId, op.kind, op.id, op.body)
    else await projectsApi.removeItem(projectId, op.kind, op.id)
  }
}

// ---------------------------------------------------------------------------
// One-time import of projects that lived only in this browser before the server stored them.
// ---------------------------------------------------------------------------

const legacyKey = 'ship.workspace.v1'

interface LegacyWorkspace {
  projects: { id: string; name: string; description?: string }[]
  data: Record<string, ProjectData>
}

/** Uploads local projects once, then removes them from the browser. Returns true if anything was imported. */
export async function importLocalWorkspace(): Promise<boolean> {
  let legacy: LegacyWorkspace | null = null
  try {
    const saved = localStorage.getItem(legacyKey)
    legacy = saved ? (JSON.parse(saved) as LegacyWorkspace) : null
  } catch {
    return false
  }
  if (!legacy || !Array.isArray(legacy.projects)) return false
  const worth = legacy.projects.filter((project) => {
    const data = legacy.data?.[project.id]
    return project.name !== 'Project 1' || (data && (data.tasks.length || data.modules.length || data.intake.length))
  })
  for (const project of worth) {
    // A previous partial import may already have created it.
    await projectsApi.create({ id: project.id, name: project.name, description: project.description ?? '' }).catch(() => {})
    const data = legacy.data?.[project.id] ?? emptyProjectData()
    await applyOps(project.id, diffProjectData(emptyProjectData(), {
      ...data,
      // Free-text assignees from before can't be matched to accounts, so they are dropped.
      tasks: data.tasks.map((task) => ({ ...task, moduleId: task.moduleId ?? '', assigneeId: '' })),
    })).catch(() => {})
  }
  try {
    localStorage.removeItem(legacyKey)
    localStorage.removeItem('ship.board.v1')
  } catch {
    // Ignore: the import is idempotent anyway.
  }
  return worth.length > 0
}

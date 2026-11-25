import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalized (NFKC + lowercase) username, used for lookup and uniqueness. */
    username: text('username').notNull(),
    /** Argon2id PHC string. */
    passwordHash: text('password_hash').notNull(),
    /** AES-256-GCM encrypted base32 TOTP secret. Set during enrollment, before it is confirmed. */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    /** Last accepted TOTP time step, to reject replays of the same code. */
    totpLastUsedStep: integer('totp_last_used_step'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_username_key').on(t.username)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token. The raw token only ever lives in the client cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** False while the user has passed the password step but not yet the TOTP step. */
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    mfaAttempts: integer('mfa_attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId), index('sessions_expires_at_idx').on(t.expiresAt)],
);

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the code. Codes are high-entropy, so a fast hash is sufficient. */
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recovery_codes_user_code_key').on(t.userId, t.codeHash),
    index('recovery_codes_unused_idx').on(t.userId).where(sql`${t.usedAt} is null`),
  ],
);

export const columnIntent = pgEnum('column_intent', ['none', 'primary', 'success', 'warning', 'danger']);
export const shareRole = pgEnum('share_role', ['viewer', 'commenter', 'editor']);
export const linkAccess = pgEnum('link_access', ['restricted', 'anyone']);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    linkAccess: linkAccess('link_access').notNull().default('restricted'),
    linkRole: shareRole('link_role').notNull().default('viewer'),
    ...timestamps,
  },
  (t) => [index('projects_owner_id_idx').on(t.ownerId)],
);

export const memberStatus = pgEnum('member_status', ['pending', 'accepted']);

/** People a project is shared with. A row starts as a pending invitation until the invitee accepts. */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: shareRole('role').notNull(),
    status: memberStatus('status').notNull().default('pending'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_id_idx').on(t.userId)],
);

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ...timestamps,
  },
  (t) => [index('modules_project_id_idx').on(t.projectId)],
);

/** The columns ("holders") on a project's Work Items board, in position order. */
export const boardColumns = pgTable(
  'board_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    intent: columnIntent('intent').notNull().default('none'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('board_columns_project_id_idx').on(t.projectId)],
);

/** What a new project starts with. */
export const defaultBoardColumns = [
  { title: 'Backlog', intent: 'none' },
  { title: 'To do', intent: 'none' },
  { title: 'In progress', intent: 'primary' },
  { title: 'In review', intent: 'warning' },
  { title: 'Done', intent: 'success' },
] as const;

export type ChecklistItem = { id: string; title: string; done: boolean };

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Deleting a column that still holds tasks is refused; move them out first. */
    columnId: uuid('column_id')
      .notNull()
      .references(() => boardColumns.id, { onDelete: 'restrict' }),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    labels: text('labels').notNull().default(''),
    /** Must be the project owner or an accepted member; cleared when they leave the project. */
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** YYYY-MM-DD or empty. */
    dueDate: text('due_date').notNull().default(''),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_assignee_id_idx').on(t.assigneeId),
    index('tasks_column_id_idx').on(t.columnId),
  ],
);

export const intakeItems = pgTable(
  'intake_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('intake_items_project_id_idx').on(t.projectId)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Session = typeof sessions.$inferSelect;

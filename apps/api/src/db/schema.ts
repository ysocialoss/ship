import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { recoveryCodes, sessions, type User, users } from '../db/schema.ts';
import { credentialLimiter, HttpError, noStore, registerLimiter, requireAuth } from './middleware.ts';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from './password.ts';
import {
  clearSessionCookie,
  createSession,
  invalidateOtherSessions,
  invalidateSession,
  validateSession,
} from './session.ts';
import { createTotpSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from './totp.ts';

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MINUTES = 15;
const MAX_MFA_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const username = z
  .string()
  .trim()
  .transform((v) => v.normalize('NFKC').toLowerCase())
  .pipe(
    z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(32, 'Username must be at most 32 characters')
      .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'Use letters, numbers, ".", "_" or "-"'),
  );

// NIST SP 800-63B: length over composition rules; long maximum; no truncation.
const newPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password must be at most 256 characters');

const anyPassword = z.string().min(1).max(256);
/** A 6-digit TOTP code or a recovery code (XXXXX-XXXXX). */
const secondFactor = z.string().trim().min(6).max(20);

const registerBody = z
  .object({ username, password: newPassword })
  .refine((b) => b.password.toLowerCase() !== b.username, {
    path: ['password'],
    message: 'Password must not match your username',
  });
const loginBody = z.object({ username, password: anyPassword });
const codeBody = z.object({ code: secondFactor });
const passwordBody = z.object({ password: anyPassword });
const passwordAndCodeBody = z.object({ password: anyPassword, code: secondFactor });
const changePasswordBody = z.object({ currentPassword: anyPassword, newPassword });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const invalidCredentials = () => new HttpError(401, 'Invalid username or password');

function publicUser(user: User) {
  return { id: user.id, username: user.username, totpEnabled: user.totpEnabled, createdAt: user.createdAt };
}

function auth(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  return req.auth;
}

async function recordFailedLogin(userId: string): Promise<void> {
  // Temporary lock every LOCKOUT_THRESHOLD consecutive failures. Kept short so an attacker
  // can't use it to lock a real user out for long; per-IP rate limiting does the heavy lifting.
  await db
    .update(users)
    .set({
      failedLoginCount: sql`${users.failedLoginCount} + 1`,
      lockedUntil: sql`case when (${users.failedLoginCount} + 1) % ${LOCKOUT_THRESHOLD} = 0
        then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else ${users.lockedUntil} end`,
    })
    .where(eq(users.id, userId));
}

/** Verifies a TOTP or recovery code and consumes it atomically so it can't be replayed. */
async function verifySecondFactor(user: User, code: string): Promise<boolean> {
  if (!user.totpEnabled || !user.totpSecretEnc) return false;

  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(user.totpSecretEnc, user.id, code, user.totpLastUsedStep);
    if (step === null) return false;
    const [updated] = await db
      .update(users)
      .set({ totpLastUsedStep: step })
      .where(
        and(
          eq(users.id, user.id),
          sql`(${users.totpLastUsedStep} is null or ${users.totpLastUsedStep} < ${step})`,
        ),
      )
      .returning({ id: users.id });
    return updated !== undefined;
  }

  const [used] = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, user.id),
        eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used !== undefined;
}

async function replaceRecoveryCodes(tx: Pick<typeof db, 'delete' | 'insert'>, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
  return codes;
}

/** Issues a fresh session token (prevents fixation after a privilege change). */
async function rotateSession(req: Request, res: Response, userId: string, oldSessionId?: string) {
  if (oldSessionId) await invalidateSession(oldSessionId);
  return createSession(req, res, userId, { mfaVerified: true });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const authRouter = Router();
authRouter.use(noStore);

authRouter.post('/register', registerLimiter, async (req, res) => {
  const body = registerBody.parse(req.body);
  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(users)
    .values({ username: body.username, passwordHash })
    .onConflictDoNothing({ target: users.username })
    .returning();
  if (!user) throw new HttpError(409, 'Username is already taken');

  await createSession(req, res, user.id, { mfaVerified: true });
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', credentialLimiter, async (req, res) => {
  const body = loginBody.parse(req.body);

  // Drop any session the client already has, so an old token never survives a login.
  const existing = await validateSession(req, res);
  if (existing) await invalidateSession(existing.session.id);

  const [user] = await db.select().from(users).where(eq(users.username, body.username)).limit(1);
  if (!user) {
    await burnPasswordCheck(body.password);
    throw invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    // Same response as a wrong password, so lockout doesn't confirm the account exists.
    await burnPasswordCheck(body.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, body.password))) {
    await recordFailedLogin(user.id);
    throw invalidCredentials();
  }

  await db
    .update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      // Transparently upgrade hashes created with weaker parameters.
      ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(body.password) } : {}),
    })
    .where(eq(users.id, user.id));

  if (user.totpEnabled) {
    await createSession(req, res, user.id, { mfaVerified: false });
    res.json({ mfaRequired: true });
    return;
  }
  await createSession(req, res, user.id, { mfaVerified: true });
  res.json({ mfaRequired: false, user: publicUser(user) });
});

authRouter.post('/login/totp', credentialLimiter, async (req, res) => {
  const { code } = codeBody.parse(req.body);
  const pending = await validateSession(req, res);
  if (!pending || pending.session.mfaVerified) throw new HttpError(401, 'No pending sign-in. Start again.');

  if (!(await verifySecondFactor(pending.user, code))) {
    await recordFailedLogin(pending.user.id);
    const [s] = await db
      .update(sessions)
      .set({ mfaAttempts: sql`${sessions.mfaAttempts} + 1` })
      .where(eq(sessions.id, pending.session.id))
      .returning({ attempts: sessions.mfaAttempts });
    if (!s || s.attempts >= MAX_MFA_ATTEMPTS) {
      await invalidateSession(pending.session.id);
      clearSessionCookie(res);
      throw new HttpError(401, 'Too many invalid codes. Sign in again.');
    }
    throw new HttpError(401, 'Invalid code');
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, pending.user.id));
  await rotateSession(req, res, pending.user.id, pending.session.id);
  res.json({ user: publicUser(pending.user) });
});

authRouter.post('/logout', async (req, res) => {
  const current = await validateSession(req, res);
  if (current) await invalidateSession(current.session.id);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(auth(req).user) });
});

authRouter.post('/password', credentialLimiter, requireAuth, async (req, res) => {
  const { user, session } = auth(req);
  const body = changePasswordBody.parse(req.body);
  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  if (body.newPassword.toLowerCase() === user.username) {
    throw new HttpError(400, 'Password must not match your username');
  }

  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));
  // Sign out every other device, and rotate this one's token.
  await invalidateOtherSessions(user.id, session.id);
  await rotateSession(req, res, user.id, session.id);
  res.status(204).end();
});

// --- TOTP enrollment -------------------------------------------------------

/** Step 1: create a secret. Requires the password so a hijacked session can't enroll its own device. */
authRouter.post('/totp/setup', credentialLimiter, requireAuth, async (req, res) => {
  const { user } = auth(req);
  const { password } = passwordBody.parse(req.body);
  if (user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is already enabled');
  if (!(await verifyPassword(user.passwordHash, password))) throw new HttpError(401, 'Password is incorrect');

  const { secret, encrypted, uri } = createTotpSecret(user.id, user.username);
  await db.update(users).set({ totpSecretEnc: encrypted, totpLastUsedStep: null }).where(eq(users.id, user.id));
  // Render `uri` as a QR code client-side; show `secret` for manual entry.
  res.json({ secret, uri });
});

/** Step 2: confirm the app produces valid codes, then turn TOTP on and issue recovery codes. */
authRouter.post('/totp/enable', credentialLimiter, requireAuth, async (req, res) => {
  const { user, session } = auth(req);
  const { code } = codeBody.parse(req.body);
  if (user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is already enabled');
  if (!user.totpSecretEnc) throw new HttpError(400, 'Start setup first');

  const step = verifyTotp(user.totpSecretEnc, user.id, code, user.totpLastUsedStep);
  if (step === null) throw new HttpError(400, 'Invalid code');

  const codes = await db.transaction(async (tx) => {
    await tx.update(users).set({ totpEnabled: true, totpLastUsedStep: step }).where(eq(users.id, user.id));
    return replaceRecoveryCodes(tx, user.id);
  });
  // Sessions created before 2FA was on never passed the second factor.
  await invalidateOtherSessions(user.id, session.id);
  await rotateSession(req, res, user.id, session.id);
  res.json({ recoveryCodes: codes });
});

authRouter.post('/totp/disable', credentialLimiter, requireAuth, async (req, res) => {
  const { user } = auth(req);
  const body = passwordAndCodeBody.parse(req.body);
  if (!user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is not enabled');
  if (!(await verifyPassword(user.passwordHash, body.password)) || !(await verifySecondFactor(user, body.code))) {
    throw new HttpError(401, 'Password or code is incorrect');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastUsedStep: null })
      .where(eq(users.id, user.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
  });
  res.status(204).end();
});

authRouter.post('/totp/recovery-codes', credentialLimiter, requireAuth, async (req, res) => {
  const { user } = auth(req);
  const body = passwordAndCodeBody.parse(req.body);
  if (!user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is not enabled');
  if (!(await verifyPassword(user.passwordHash, body.password)) || !(await verifySecondFactor(user, body.code))) {
    throw new HttpError(401, 'Password or code is incorrect');
  }
  const codes = await db.transaction((tx) => replaceRecoveryCodes(tx, user.id));
  res.json({ recoveryCodes: codes });
});

import { and, eq, lt, ne } from 'drizzle-orm';
import type { CookieOptions, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { type Session, sessions, type User, users } from '../db/schema.ts';
import { isProd } from '../env.ts';
import { randomToken, sha256 } from './crypto.ts';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * DAY;
const SESSION_RENEW_THRESHOLD = 15 * DAY;
/** Lifetime of the half-authenticated session between the password and TOTP steps. */
export const MFA_PENDING_TTL = 10 * 60 * 1000;

// The __Host- prefix makes browsers enforce Secure, Path=/ and no Domain (needs HTTPS).
export const SESSION_COOKIE = isProd ? '__Host-ship_session' : 'ship_session';

const baseCookie: CookieOptions = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };

export async function createSession(
  req: Request,
  res: Response,
  userId: string,
  { mfaVerified }: { mfaVerified: boolean },
): Promise<Session> {
  // Only the SHA-256 of the token is stored, so a database leak does not leak live sessions.
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (mfaVerified ? SESSION_TTL : MFA_PENDING_TTL));
  const [session] = await db
    .insert(sessions)
    .values({
      id: sha256(token),
      userId,
      mfaVerified,
      expiresAt,
      userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      ip: req.ip ?? null,
    })
    .returning();
  res.cookie(SESSION_COOKIE, token, { ...baseCookie, expires: expiresAt });
  return session!;
}

/** Resolves the request's session cookie. Deletes expired sessions and slides the expiry when due. */
export async function validateSession(
  req: Request,
  res: Response,
): Promise<{ session: Session; user: User } | null> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0 || token.length > 100) return null;

  const id = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) {
    clearSessionCookie(res);
    return null;
  }
  if (row.session.expiresAt.getTime() <= Date.now()) {
    await invalidateSession(id);
    clearSessionCookie(res);
    return null;
  }
  if (row.session.mfaVerified && row.session.expiresAt.getTime() - Date.now() < SESSION_RENEW_THRESHOLD) {
    const expiresAt = new Date(Date.now() + SESSION_TTL);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    row.session.expiresAt = expiresAt;
    res.cookie(SESSION_COOKIE, token, { ...baseCookie, expires: expiresAt });
  }
  return row;
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseCookie);
}

export async function deleteExpiredSessions(): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return deleted.length;
}

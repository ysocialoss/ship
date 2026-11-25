import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Session, User } from '../db/schema.ts';
import { env } from '../env.ts';
import { validateSession } from './session.ts';

declare global {
  namespace Express {
    interface Request {
      auth?: { session: Session; user: User };
    }
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Requires a fully authenticated session (password and, if enabled, TOTP). */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await validateSession(req, res);
  if (!auth || !auth.session.mfaVerified) throw new HttpError(401, 'Not authenticated');
  req.auth = auth;
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Lax cookies: browsers send an Origin header on
 * every cross-origin (and same-origin) POST, so reject state-changing requests from
 * origins we don't know. Requests without Origin come from non-browser clients, which
 * cannot be driven by a malicious site.
 */
export function checkOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin !== undefined && !env.ALLOWED_ORIGINS.includes(origin)) {
    throw new HttpError(403, 'Origin not allowed');
  }
  if (origin === undefined && req.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'Cross-site request blocked');
  }
  next();
}

/** Per-IP throttle on failed password / second-factor checks. Successful requests don't count. */
export const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address. Try again later.' },
});

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

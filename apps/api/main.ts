import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { checkOrigin, HttpError } from './src/auth/middleware.ts';
import { authRouter } from './src/auth/routes.ts';
import { deleteExpiredSessions } from './src/auth/session.ts';
import { pool } from './src/db/index.ts';
import { env } from './src/env.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use(checkOrigin);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: z.flattenError(err).fieldErrors });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Invalid request' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const cleanup = setInterval(() => {
  deleteExpiredSessions().catch((err: unknown) => console.error('Session cleanup failed', err));
}, 60 * 60 * 1000);
cleanup.unref();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end());
  });
}

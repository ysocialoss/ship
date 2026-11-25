# Ship

Ship is a planner.

## Development

Use Node.js 22.18 or later and pnpm 12.18.0. From the repository root, run:

```sh
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env   # then fill in TOTP_ENCRYPTION_KEY
pnpm --filter @ship/api db:migrate
pnpm dev
```

After changing `apps/api/src/db/schema.ts`, run `pnpm --filter @ship/api db:generate` and commit the new file in `apps/api/drizzle/`.
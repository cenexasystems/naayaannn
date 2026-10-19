# Database migrations

The project's PostgreSQL migrations, run on **Neon**:

```bash
npm run db:migrate          # apply pending migrations
npm run db:migrate -- --list
```

The runner (`scripts/neon-migrate.mjs`) applies, in order:

1. `neon/000_compat.sql` — the few Supabase objects the older migrations reference
   (`auth.users`, `auth.uid()`, `storage.buckets`, the `anon` / `authenticated` roles), so they run unchanged
2. `neon/migrations/*.sql` — in filename order
3. `neon/100_runtime.sql` — file storage and change counters used by the API

Each applied file is recorded in `public.schema_migrations`. Add new changes as a new, additive file in
`neon/migrations/` and run `npm run db:migrate`.

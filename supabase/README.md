# Database migrations

These are the project's original PostgreSQL migrations. They now run on **Neon**:

```bash
npm run db:migrate          # apply pending migrations
npm run db:migrate -- --list
```

The runner (`scripts/neon-migrate.mjs`) applies, in order:

1. `db/neon/000_supabase_compat.sql` — the few Supabase objects these files reference
   (`auth.users`, `auth.uid()`, `storage.buckets`, the `anon` / `authenticated` roles), so they run unchanged
2. `supabase/migrations/*.sql` — in filename order
3. `db/neon/100_neon_runtime.sql` — file storage and change counters used by the API

Each applied file is recorded in `public.schema_migrations`. Add new changes as a new, additive file in
`supabase/migrations/` and run `npm run db:migrate`.

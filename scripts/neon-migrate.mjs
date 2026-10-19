/**
 * Applies the database schema to Neon, in order:
 *   1. neon/0xx_*.sql         (compatibility layer for objects the old migrations reference)
 *   2. neon/migrations/*.sql  (the project's migrations, in filename order)
 *   3. neon/1xx_*.sql         (runtime objects used by the API: file storage, change counters)
 * Applied files are recorded in public.schema_migrations and skipped next time.
 *
 * Uses DATABASE_URL_UNPOOLED (direct connection) when set, else DATABASE_URL.
 * Usage: npm run db:migrate            apply pending migrations
 *        npm run db:migrate -- --list  show applied / pending
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const ROOT = process.cwd()
const listOnly = process.argv.includes('--list')
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set. Add it to .env first.')
  process.exit(1)
}

const sqlFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []

const neonDir = path.join(ROOT, 'neon')
const migrationsDir = path.join(neonDir, 'migrations')
const neonFiles = sqlFiles(neonDir)
const plan = [
  ...neonFiles.filter((f) => f.startsWith('0')).map((f) => ({ key: `neon/${f}`, file: path.join(neonDir, f) })),
  ...sqlFiles(migrationsDir).map((f) => ({ key: `migrations/${f}`, file: path.join(migrationsDir, f) })),
  ...neonFiles.filter((f) => !f.startsWith('0')).map((f) => ({ key: `neon/${f}`, file: path.join(neonDir, f) })),
]

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    key TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  // Records from before the folder rename (supabase/migrations → neon/migrations)
  await client.query(`UPDATE public.schema_migrations SET key = 'migrations/' || substr(key, 10) WHERE key LIKE 'supabase/%'
    AND NOT EXISTS (SELECT 1 FROM public.schema_migrations m2 WHERE m2.key = 'migrations/' || substr(public.schema_migrations.key, 10))`)
  await client.query(`UPDATE public.schema_migrations SET key = 'neon/000_compat.sql' WHERE key = 'neon/000_supabase_compat.sql'`)
  await client.query(`UPDATE public.schema_migrations SET key = 'neon/100_runtime.sql' WHERE key = 'neon/100_neon_runtime.sql'`)
  const done = new Set((await client.query('SELECT key FROM public.schema_migrations')).rows.map((r) => r.key))
  const pending = plan.filter((m) => !done.has(m.key))

  if (listOnly) {
    for (const m of plan) console.log(`${done.has(m.key) ? 'applied ' : 'pending '} ${m.key}`)
    process.exit(0)
  }
  if (pending.length === 0) {
    console.log('Database is up to date.')
    process.exit(0)
  }

  for (const m of pending) {
    process.stdout.write(`→ ${m.key} ... `)
    const sql = fs.readFileSync(m.file, 'utf8')
    try {
      await client.query(sql)
      await client.query('INSERT INTO public.schema_migrations (key) VALUES ($1)', [m.key])
      console.log('ok')
    } catch (err) {
      console.log('FAILED')
      await client.query('ROLLBACK').catch(() => {})
      console.error(`\n${m.key}: ${err.message}${err.position ? ` (at character ${err.position})` : ''}`)
      process.exit(1)
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).`)
} finally {
  await client.end()
}

/**
 * One-time copy of the existing Supabase data into Neon, with verification.
 *
 *   SUPABASE_DB_URL        Supabase Postgres connection string (Project Settings → Database,
 *                          "Session" or direct connection) — source, read only
 *   DATABASE_URL_UNPOOLED  Neon direct connection — target (falls back to DATABASE_URL)
 *   SUPABASE_URL +         optional: also copy Storage files (product images, invoices,
 *   SUPABASE_SERVICE_ROLE_KEY   avatars, branding) and rewrite their URLs to /api/files
 *
 * Run `npm run db:migrate` first so Neon has the schema, then:
 *   npm run db:import-supabase -- --dry-run   counts only, changes nothing
 *   npm run db:import-supabase -- --yes       REPLACES the data in Neon's app tables
 *
 * The copy runs in one transaction on Neon: if any table fails, nothing is written.
 * Afterwards row counts and money totals are compared between the two databases.
 */
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const DRY = process.argv.includes('--dry-run')
const YES = process.argv.includes('--yes')
const SOURCE = process.env.SUPABASE_DB_URL
const TARGET = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKETS = ['product-images', 'invoices', 'avatars', 'branding']
const SKIP_TABLES = new Set(['schema_migrations', 'storage_files', 'table_versions'])
const BATCH = 500

if (!SOURCE || !TARGET) {
  console.error('Set SUPABASE_DB_URL (source) and DATABASE_URL_UNPOOLED or DATABASE_URL (Neon target) in .env.')
  process.exit(1)
}
if (!DRY && !YES) {
  console.error('This replaces the rows in Neon\'s app tables. Re-run with --dry-run to preview or --yes to proceed.')
  process.exit(1)
}

// Read every value as text so it round-trips exactly (numeric precision, timestamps, json, arrays)
const rawTypes = { getTypeParser: () => (v) => v }
const src = new pg.Client({ connectionString: SOURCE, types: rawTypes })
const dst = new pg.Client({ connectionString: TARGET, types: rawTypes })
await src.connect()
await dst.connect()

const qi = (s) => `"${s.replace(/"/g, '""')}"`

async function tablesInFkOrder(client) {
  const tables = (await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )).rows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.has(t))
  const deps = (await client.query(
    `SELECT cl.relname AS child, rcl.relname AS parent
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
       JOIN pg_class rcl ON rcl.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rcl.relnamespace AND rn.nspname = 'public'
      WHERE c.contype = 'f' AND cl.relname <> rcl.relname`,
  )).rows
  const ordered = []
  const seen = new Set()
  const visit = (t, stack = new Set()) => {
    if (seen.has(t) || stack.has(t)) return
    stack.add(t)
    for (const d of deps.filter((x) => x.child === t)) if (tables.includes(d.parent)) visit(d.parent, stack)
    seen.add(t)
    ordered.push(t)
  }
  tables.sort().forEach((t) => visit(t))
  return ordered
}

async function columns(client, schema, table) {
  return (await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER'
      ORDER BY ordinal_position`,
    [schema, table],
  )).rows.map((r) => r.column_name)
}

async function copyTable(schema, table) {
  const srcCols = await columns(src, schema, table)
  if (srcCols.length === 0) return { table, copied: 0, note: 'not in Supabase' }
  const dstCols = new Set(await columns(dst, schema, table))
  const cols = srcCols.filter((c) => dstCols.has(c))
  const total = Number((await src.query(`SELECT count(*) AS n FROM ${qi(schema)}.${qi(table)}`)).rows[0].n)
  if (DRY) return { table: `${schema}.${table}`, copied: total }

  const list = cols.map(qi).join(', ')
  let copied = 0
  for (let offset = 0; offset < total; offset += BATCH) {
    const rows = (await src.query(
      `SELECT ${list} FROM ${qi(schema)}.${qi(table)} ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}`,
    )).rows
    if (rows.length === 0) break
    const params = []
    const values = rows.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}` }).join(', ')})`)
    await dst.query(
      `INSERT INTO ${qi(schema)}.${qi(table)} (${list}) OVERRIDING SYSTEM VALUE VALUES ${values.join(', ')}`,
      params,
    )
    copied += rows.length
  }
  return { table: `${schema}.${table}`, copied }
}

async function resetSequences() {
  const seqs = (await dst.query(
    `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
            pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS seq
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) IS NOT NULL`,
  )).rows
  for (const s of seqs) {
    await dst.query(
      `SELECT setval($1, COALESCE((SELECT max(${qi(s.column)}) FROM ${qi(s.schema)}.${qi(s.table)}), 0) + 1, false)`,
      [s.seq],
    )
  }
  return seqs.length
}

async function copyStorage() {
  if (!SUPABASE_URL || !SERVICE_KEY) return { files: 0, note: 'skipped (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)' }
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  let files = 0
  const list = async (bucket, prefix) => {
    const out = []
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      })
      if (!res.ok) return out
      const items = await res.json()
      for (const it of items) {
        const full = prefix ? `${prefix}/${it.name}` : it.name
        if (it.id) out.push({ path: full, type: it.metadata?.mimetype || 'application/octet-stream' })
        else out.push(...(await list(bucket, full)))
      }
      if (items.length < 1000) return out
    }
  }
  for (const bucket of BUCKETS) {
    const objects = await list(bucket, '')
    for (const o of objects) {
      if (DRY) { files++; continue }
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${o.path.split('/').map(encodeURIComponent).join('/')}`, { headers })
      if (!res.ok) { console.warn(`  ! could not download ${bucket}/${o.path} (${res.status})`); continue }
      const data = Buffer.from(await res.arrayBuffer())
      await dst.query(
        `INSERT INTO public.storage_files (bucket, path, content_type, size, data) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bucket, path) DO UPDATE SET content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data`,
        [bucket, o.path, o.type, data.length, data],
      )
      files++
    }
  }
  if (DRY) return { files, note: 'would copy' }

  // Point stored links at the new file endpoint
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/`
  const textCols = (await dst.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
        AND table_name NOT IN ('schema_migrations', 'storage_files', 'table_versions')`,
  )).rows
  let rewritten = 0
  for (const { table_name: t, column_name: c } of textCols) {
    const rows = (await dst.query(`SELECT ctid::text AS ctid, ${qi(c)} AS v FROM public.${qi(t)} WHERE ${qi(c)} LIKE $1`, [`${prefix}%`])).rows
    for (const r of rows) {
      const rest = r.v.slice(prefix.length).split('?')[0]
      const [bucket, ...parts] = rest.split('/')
      const path = decodeURIComponent(parts.join('/'))
      const next = `/api/files?b=${encodeURIComponent(bucket)}&p=${encodeURIComponent(path)}`
      await dst.query(`UPDATE public.${qi(t)} SET ${qi(c)} = $1 WHERE ctid = $2::tid`, [next, r.ctid])
      rewritten++
    }
  }
  return { files, note: `${rewritten} link(s) rewritten` }
}

const CHECKS = [
  ['orders', 'count(*)', 'sum(total)'],
  ['order_items', 'count(*)', 'sum(line_total)'],
  ['advance_orders', 'count(*)', 'sum(total_amount)'],
  ['advance_order_payments', 'count(*)', 'sum(amount)'],
  ['expenses', 'count(*)', 'sum(amount)'],
  ['products', 'count(*)', 'sum(stock_quantity)'],
  ['product_variants', 'count(*)', 'sum(stock)'],
]

async function verify(tables) {
  let ok = true
  console.log('\nVerification (Supabase → Neon):')
  for (const t of tables) {
    const a = Number((await src.query(`SELECT count(*) AS n FROM public.${qi(t)}`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n)
    const b = Number((await dst.query(`SELECT count(*) AS n FROM public.${qi(t)}`)).rows[0].n)
    const same = a === b
    ok &&= same
    console.log(`  ${same ? '✓' : '✗'} ${t.padEnd(26)} rows ${a} → ${b}`)
  }
  for (const [t, , sum] of CHECKS) {
    if (!tables.includes(t)) continue
    const a = (await src.query(`SELECT COALESCE(${sum}, 0)::text AS v FROM public.${qi(t)}`).catch(() => ({ rows: [{ v: 'n/a' }] }))).rows[0].v
    const b = (await dst.query(`SELECT COALESCE(${sum}, 0)::text AS v FROM public.${qi(t)}`).catch(() => ({ rows: [{ v: 'n/a' }] }))).rows[0].v
    const same = a === b
    ok &&= same
    console.log(`  ${same ? '✓' : '✗'} ${t.padEnd(26)} ${sum} ${a} → ${b}`)
  }
  return ok
}

try {
  const tables = await tablesInFkOrder(dst)
  console.log(`${DRY ? 'DRY RUN — ' : ''}Copying ${tables.length} tables from Supabase to Neon…`)

  if (!DRY) {
    await dst.query('BEGIN')
    // Replace app data (including rows seeded by the migrations) with the Supabase copy
    await dst.query(`TRUNCATE ${tables.map((t) => `public.${qi(t)}`).join(', ')} CASCADE`)
    for (const t of tables) await dst.query(`ALTER TABLE public.${qi(t)} DISABLE TRIGGER USER`)
    await dst.query('ALTER TABLE auth.users DISABLE TRIGGER USER')
  }

  const results = []
  const hasAuth = (await src.query(`SELECT to_regclass('auth.users') IS NOT NULL AS ok`)).rows[0].ok === 't'
  if (hasAuth) {
    if (!DRY) await dst.query('DELETE FROM auth.users')
    const cols = ['id', 'email', 'phone', 'raw_app_meta_data', 'raw_user_meta_data', 'created_at', 'updated_at']
    const rows = (await src.query(`SELECT ${cols.join(', ')} FROM auth.users`)).rows
    if (!DRY) {
      for (const r of rows) {
        await dst.query(
          `INSERT INTO auth.users (${cols.join(', ')}) VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'), COALESCE($5::jsonb, '{}'), COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))`,
          cols.map((c) => r[c]),
        )
      }
    }
    results.push({ table: 'auth.users (ids/emails only)', copied: rows.length })
  }
  for (const t of tables) {
    const r = await copyTable('public', t)
    results.push(r)
    console.log(`  ${r.table.padEnd(30)} ${r.copied}${r.note ? ` (${r.note})` : ''}`)
  }

  if (!DRY) {
    for (const t of tables) await dst.query(`ALTER TABLE public.${qi(t)} ENABLE TRIGGER USER`)
    await dst.query('ALTER TABLE auth.users ENABLE TRIGGER USER')
    const n = await resetSequences()
    await dst.query('COMMIT')
    console.log(`Committed. ${n} sequence(s) advanced past the imported ids.`)
  }

  const storage = await copyStorage()
  console.log(`Storage files: ${storage.files} ${storage.note || ''}`)

  if (!DRY) {
    const ok = await verify(tables)
    console.log(ok ? '\nAll counts and totals match.' : '\nMISMATCH — do not switch traffic until resolved.')
    process.exitCode = ok ? 0 : 2
  }
} catch (err) {
  if (!DRY) await dst.query('ROLLBACK').catch(() => {})
  console.error('\nImport failed, Neon left unchanged:', err.message)
  process.exitCode = 1
} finally {
  await src.end()
  await dst.end()
}

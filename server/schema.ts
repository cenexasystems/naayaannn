import { query } from './db.js'

export interface ColumnInfo { name: string; dataType: string; udtName: string }
export interface TableInfo { name: string; columns: Map<string, ColumnInfo>; primaryKey: string[] }
export interface ForeignKey { table: string; column: string; refTable: string; refColumn: string }
export interface FunctionArg { name: string; type: string; hasDefault: boolean }
export interface FunctionInfo { name: string; args: FunctionArg[]; returnsSet: boolean; returnsComposite: boolean }

export interface SchemaCache {
  tables: Map<string, TableInfo>
  foreignKeys: ForeignKey[]
  functions: Map<string, FunctionInfo[]>
  loadedAt: number
}

/** Tables the API never exposes through the generic query endpoint. */
export const INTERNAL_TABLES = new Set(['schema_migrations', 'storage_files', 'table_versions'])
/** Functions callable through /api/rpc (all others are internal: triggers, helpers). */
export const RPC_ALLOWLIST = new Set([
  'add_advance_order_event',
  'adjust_inventory_stock',
  'complete_pos_sale_with_inventory',
  'create_advance_order',
  'create_barcode_and_receive_stock',
  'create_order_with_stock',
  'create_order_without_stock',
  'get_expense_summary_metrics',
  'get_public_invoice_by_number',
  'update_advance_order_status',
  'complete_advance_order',
  'complete_advance_order_v2',
])

let cache: SchemaCache | null = null
let loading: Promise<SchemaCache> | null = null
const TTL_MS = 5 * 60_000

async function load(): Promise<SchemaCache> {
  const [cols, pks, fks, fns] = await Promise.all([
    query<{ table_name: string; column_name: string; data_type: string; udt_name: string }>(
      `SELECT c.table_name, c.column_name, c.data_type, c.udt_name
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY c.table_name, c.ordinal_position`,
    ),
    query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position`,
    ),
    query<{ tbl: string; col: string; ref_tbl: string; ref_col: string }>(
      `SELECT cl.relname AS tbl, a.attname AS col, rcl.relname AS ref_tbl, ra.attname AS ref_col
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_class rcl ON rcl.oid = c.confrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
         JOIN pg_namespace rn ON rn.oid = rcl.relnamespace AND rn.nspname = 'public'
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`,
    ),
    query<{ proname: string; argnames: string[] | null; argtypes: string[] | null; nargs: number; ndefaults: number; retset: boolean; composite: boolean }>(
      `SELECT p.proname,
              p.proargnames AS argnames,
              ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t) AS argtypes,
              p.pronargs AS nargs, p.pronargdefaults AS ndefaults, p.proretset AS retset,
              (rt.typtype = 'c' OR rt.typname = 'record') AS composite
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         JOIN pg_type rt ON rt.oid = p.prorettype
        WHERE p.prokind = 'f'`,
    ),
  ])

  const tables = new Map<string, TableInfo>()
  for (const r of cols.rows) {
    let t = tables.get(r.table_name)
    if (!t) tables.set(r.table_name, (t = { name: r.table_name, columns: new Map(), primaryKey: [] }))
    t.columns.set(r.column_name, { name: r.column_name, dataType: r.data_type, udtName: r.udt_name })
  }
  for (const r of pks.rows) tables.get(r.table_name)?.primaryKey.push(r.column_name)

  const functions = new Map<string, FunctionInfo[]>()
  for (const r of fns.rows) {
    const names = r.argnames || []
    const types = r.argtypes || []
    const args: FunctionArg[] = types.map((type, i) => ({
      name: names[i] || `$${i + 1}`,
      type,
      hasDefault: i >= r.nargs - r.ndefaults,
    }))
    const list = functions.get(r.proname) || []
    list.push({ name: r.proname, args, returnsSet: r.retset, returnsComposite: r.composite })
    functions.set(r.proname, list)
  }

  return {
    tables,
    foreignKeys: fks.rows.map((r) => ({ table: r.tbl, column: r.col, refTable: r.ref_tbl, refColumn: r.ref_col })),
    functions,
    loadedAt: Date.now(),
  }
}

export async function getSchema(force = false): Promise<SchemaCache> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache
  if (!loading) {
    loading = load()
      .then((c) => (cache = c))
      .finally(() => { loading = null })
  }
  return loading
}

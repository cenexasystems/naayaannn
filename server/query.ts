/**
 * Translates the PostgREST-style requests sent by src/lib/db.ts into parameterised SQL.
 * Table, column and relationship names are checked against the live schema; every value
 * is passed as a bind parameter.
 */
import { getSchema, INTERNAL_TABLES, type SchemaCache, type TableInfo } from './schema.js'
import { query } from './db.js'

export interface Filter {
  op: string
  column?: string
  value?: unknown
  negate?: boolean
}

export interface OrderBy { column: string; ascending?: boolean; nullsFirst?: boolean }

export interface DbRequest {
  table: string
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  /** Columns for select; for mutations the RETURNING projection (null = return nothing). */
  select?: string | null
  filters?: Filter[]
  order?: OrderBy[]
  limit?: number | null
  offset?: number | null
  count?: 'exact' | 'planned' | 'estimated' | null
  head?: boolean
  values?: Record<string, unknown> | Record<string, unknown>[]
  onConflict?: string
  ignoreDuplicates?: boolean
}

export class ApiError extends Error {
  code: string
  status: number
  details: string | null
  hint: string | null
  constructor(message: string, code = 'PGRST100', status = 400, details: string | null = null, hint: string | null = null) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
    this.hint = hint
  }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const q = (name: string) => {
  if (!IDENT.test(name)) throw new ApiError(`Invalid identifier "${name}"`, 'PGRST100')
  return `"${name}"`
}

class Params {
  values: unknown[] = []
  add(v: unknown) {
    this.values.push(v)
    return `$${this.values.length}`
  }
}

/** Splits on commas that are not inside parentheses or double quotes. */
export function splitTopLevel(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let inQuote = false
  let cur = ''
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote
    if (!inQuote) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(cur)
        cur = ''
        continue
      }
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function requireTable(schema: SchemaCache, name: string): TableInfo {
  const t = IDENT.test(name) && !INTERNAL_TABLES.has(name) ? schema.tables.get(name) : undefined
  if (!t) throw new ApiError(`Could not find the table 'public.${name}' in the schema cache`, 'PGRST205', 404)
  return t
}

function requireColumn(table: TableInfo, column: string) {
  const c = table.columns.get(column)
  if (!c) throw new ApiError(`column ${table.name}.${column} does not exist`, '42703', 400)
  return c
}

let aliasSeq = 0
const nextAlias = () => `_t${++aliasSeq}`

function compileSelectList(schema: SchemaCache, table: TableInfo, alias: string, select: string): string {
  const items = splitTopLevel(select && select.trim() ? select : '*')
  const parts: string[] = []
  for (const raw of items) {
    const item = raw.replace(/\s+/g, ' ').trim()
    if (item === '*') {
      parts.push(`${alias}.*`)
      continue
    }
    const embed = /^(?:([A-Za-z_]\w*)\s*:\s*)?([A-Za-z_]\w*)(?:!([A-Za-z_]\w*))?(?:!inner)?\s*\(([\s\S]*)\)$/.exec(item)
    if (embed) {
      const [, as, relName, hint, inner] = embed
      const rel = requireTable(schema, relName)
      const a2 = nextAlias()
      const innerList = compileSelectList(schema, rel, a2, inner)
      const outName = q(as || relName)
      const toOne = schema.foreignKeys.find(
        (f) => f.table === table.name && f.refTable === rel.name && (!hint || f.column === hint || hint === rel.name),
      )
      if (toOne) {
        parts.push(
          `(SELECT row_to_json(${a2}_r) FROM (SELECT ${innerList} FROM public.${q(rel.name)} ${a2} WHERE ${a2}.${q(toOne.refColumn)} = ${alias}.${q(toOne.column)} LIMIT 1) ${a2}_r) AS ${outName}`,
        )
        continue
      }
      const toMany = schema.foreignKeys.find(
        (f) => f.table === rel.name && f.refTable === table.name && (!hint || f.column === hint),
      )
      if (toMany) {
        parts.push(
          `COALESCE((SELECT json_agg(${a2}_r) FROM (SELECT ${innerList} FROM public.${q(rel.name)} ${a2} WHERE ${a2}.${q(toMany.column)} = ${alias}.${q(toMany.refColumn)}) ${a2}_r), '[]'::json) AS ${outName}`,
        )
        continue
      }
      throw new ApiError(`Could not find a relationship between '${table.name}' and '${rel.name}' in the schema cache`, 'PGRST200')
    }
    const col = /^(?:([A-Za-z_]\w*)\s*:\s*)?([A-Za-z_]\w*)(?:::[A-Za-z_]+)?$/.exec(item)
    if (!col) throw new ApiError(`Unsupported select item "${item}"`, 'PGRST100')
    const [, as, name] = col
    requireColumn(table, name)
    parts.push(`${alias}.${q(name)} AS ${q(as || name)}`)
  }
  return parts.join(', ')
}

/** Parses one PostgREST condition such as `phone.ilike.%98%` or `id.in.("a","b")`. */
function parseCondition(cond: string): Filter | { group: 'and' | 'or'; negate: boolean; items: string[] } {
  const group = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(cond)
  if (group) return { group: group[2] as 'and' | 'or', negate: !!group[1], items: splitTopLevel(group[3]) }
  const m = /^([A-Za-z_]\w*)\.(not\.)?([a-z]+)\.([\s\S]*)$/.exec(cond)
  if (!m) throw new ApiError(`Could not parse filter "${cond}"`, 'PGRST100')
  const [, column, not, op, rawValue] = m
  let value: unknown = rawValue
  if (op === 'in') {
    const inner = rawValue.replace(/^\(/, '').replace(/\)$/, '')
    value = splitTopLevel(inner).map((v) => v.replace(/^"(.*)"$/, '$1'))
  } else if (op === 'is') {
    value = rawValue === 'null' ? null : rawValue === 'true' ? true : rawValue === 'false' ? false : rawValue
  } else if (op === 'like' || op === 'ilike') {
    value = rawValue.replace(/\*/g, '%')
  } else {
    value = rawValue.replace(/^"(.*)"$/, '$1')
  }
  return { op, column, value, negate: !!not }
}

function compileCondition(table: TableInfo, alias: string, f: Filter, params: Params): string {
  if (f.op === 'or' || f.op === 'and') {
    const items = splitTopLevel(String(f.value ?? ''))
    const sql = compileGroup(table, alias, f.op, items, params)
    return f.negate ? `NOT ${sql}` : sql
  }
  if (!f.column) throw new ApiError('Filter is missing a column', 'PGRST100')
  requireColumn(table, f.column)
  const col = `${alias}.${q(f.column)}`
  let sql: string
  switch (f.op) {
    case 'eq':
      sql = f.value === null ? `${col} IS NULL` : `${col} = ${params.add(f.value)}`
      break
    case 'neq':
      sql = f.value === null ? `${col} IS NOT NULL` : `${col} <> ${params.add(f.value)}`
      break
    case 'gt': sql = `${col} > ${params.add(f.value)}`; break
    case 'gte': sql = `${col} >= ${params.add(f.value)}`; break
    case 'lt': sql = `${col} < ${params.add(f.value)}`; break
    case 'lte': sql = `${col} <= ${params.add(f.value)}`; break
    case 'like': sql = `${col}::text LIKE ${params.add(String(f.value))}`; break
    case 'ilike': sql = `${col}::text ILIKE ${params.add(String(f.value))}`; break
    case 'in': {
      const list = Array.isArray(f.value) ? f.value : []
      sql = list.length === 0 ? 'FALSE' : `${col}::text = ANY(${params.add(list.map((v) => String(v)))}::text[])`
      break
    }
    case 'is':
      sql = f.value === null || f.value === 'null'
        ? `${col} IS NULL`
        : f.value === true || f.value === 'true'
          ? `${col} IS TRUE`
          : `${col} IS FALSE`
      break
    case 'cs': sql = `${col} @> ${params.add(f.value)}`; break
    default:
      throw new ApiError(`Unsupported filter operator "${f.op}"`, 'PGRST100')
  }
  return f.negate ? `NOT (${sql})` : sql
}

function compileGroup(table: TableInfo, alias: string, kind: 'and' | 'or', items: string[], params: Params): string {
  if (items.length === 0) return kind === 'or' ? 'FALSE' : 'TRUE'
  const parts = items.map((item) => {
    const parsed = parseCondition(item)
    if ('group' in parsed) {
      const sql = compileGroup(table, alias, parsed.group, parsed.items, params)
      return parsed.negate ? `NOT ${sql}` : sql
    }
    return compileCondition(table, alias, parsed, params)
  })
  return `(${parts.join(kind === 'or' ? ' OR ' : ' AND ')})`
}

function compileWhere(table: TableInfo, alias: string, filters: Filter[] | undefined, params: Params) {
  if (!filters || filters.length === 0) return ''
  return ` WHERE ${filters.map((f) => compileCondition(table, alias, f, params)).join(' AND ')}`
}

function toDbValue(table: TableInfo, column: string, value: unknown) {
  const c = table.columns.get(column)
  if (!c) throw new ApiError(`Could not find the '${column}' column of '${table.name}' in the schema cache`, 'PGRST204')
  if (value === null || value === undefined) return null
  if (c.dataType === 'json' || c.dataType === 'jsonb') return JSON.stringify(value)
  if (c.dataType === 'ARRAY') return Array.isArray(value) ? value : value
  if (typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value)
  return value
}

export interface DbResult { data: unknown; count: number | null }

export async function runDbRequest(req: DbRequest): Promise<DbResult> {
  const schema = await getSchema()
  const table = requireTable(schema, req.table)
  const params = new Params()
  const alias = '_t0'
  const base = `public.${q(table.name)}`

  if (req.action === 'select') {
    const where = compileWhere(table, alias, req.filters, params)
    let count: number | null = null
    if (req.count) {
      const c = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${base} ${alias}${where}`, params.values)
      count = c.rows[0]?.n ?? 0
    }
    if (req.head) return { data: null, count }
    const list = compileSelectList(schema, table, alias, req.select ?? '*')
    let sql = `SELECT ${list} FROM ${base} ${alias}${where}`
    if (req.order?.length) {
      sql += ' ORDER BY ' + req.order.map((o) => {
        requireColumn(table, o.column)
        const dir = o.ascending === false ? 'DESC' : 'ASC'
        const nulls = o.nullsFirst === undefined ? '' : o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'
        return `${alias}.${q(o.column)} ${dir}${nulls}`
      }).join(', ')
    }
    if (req.limit != null) sql += ` LIMIT ${params.add(Math.max(0, Math.floor(Number(req.limit))))}`
    if (req.offset != null) sql += ` OFFSET ${params.add(Math.max(0, Math.floor(Number(req.offset))))}`
    const rows = await query(sql, params.values)
    return { data: rows.rows, count }
  }

  let mutation: string
  if (req.action === 'insert' || req.action === 'upsert') {
    const rows = (Array.isArray(req.values) ? req.values : [req.values]).filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object',
    )
    if (rows.length === 0) throw new ApiError('No rows to insert', 'PGRST100')
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined))))
    keys.forEach((k) => toDbValue(table, k, null))
    if (keys.length === 0) {
      mutation = `INSERT INTO ${base} AS ${alias} DEFAULT VALUES`
    } else {
      const valuesSql = rows
        .map((r) => `(${keys.map((k) => (r[k] === undefined ? 'DEFAULT' : params.add(toDbValue(table, k, r[k])))).join(', ')})`)
        .join(', ')
      mutation = `INSERT INTO ${base} AS ${alias} (${keys.map(q).join(', ')}) VALUES ${valuesSql}`
    }
    if (req.action === 'upsert') {
      const conflict = (req.onConflict ? req.onConflict.split(',').map((s) => s.trim()) : table.primaryKey).filter(Boolean)
      if (conflict.length === 0) throw new ApiError('Upsert needs onConflict or a primary key', 'PGRST100')
      conflict.forEach((c) => requireColumn(table, c))
      const updates = keys.filter((k) => !conflict.includes(k))
      mutation += ` ON CONFLICT (${conflict.map(q).join(', ')}) `
      mutation += req.ignoreDuplicates || updates.length === 0
        ? 'DO NOTHING'
        : `DO UPDATE SET ${updates.map((k) => `${q(k)} = EXCLUDED.${q(k)}`).join(', ')}`
    }
  } else if (req.action === 'update') {
    const values = (req.values && !Array.isArray(req.values) ? req.values : {}) as Record<string, unknown>
    const keys = Object.keys(values).filter((k) => values[k] !== undefined)
    if (keys.length === 0) throw new ApiError('No columns to update', 'PGRST100')
    if (!req.filters?.length) throw new ApiError('UPDATE requires a WHERE clause', '21000')
    const set = keys.map((k) => `${q(k)} = ${params.add(toDbValue(table, k, values[k]))}`).join(', ')
    mutation = `UPDATE ${base} AS ${alias} SET ${set}${compileWhere(table, alias, req.filters, params)}`
  } else if (req.action === 'delete') {
    if (!req.filters?.length) throw new ApiError('DELETE requires a WHERE clause', '21000')
    mutation = `DELETE FROM ${base} AS ${alias}${compileWhere(table, alias, req.filters, params)}`
  } else {
    throw new ApiError(`Unsupported action "${String(req.action)}"`, 'PGRST100')
  }

  if (req.select === null || req.select === undefined) {
    const r = await query(mutation, params.values)
    return { data: null, count: req.count ? r.rowCount ?? 0 : null }
  }
  const m = '_m'
  const list = compileSelectList(schema, table, m, req.select)
  const r = await query(`WITH ${m} AS (${mutation} RETURNING ${alias}.*) SELECT ${list} FROM ${m}`, params.values)
  return { data: r.rows, count: req.count ? r.rowCount ?? 0 : null }
}

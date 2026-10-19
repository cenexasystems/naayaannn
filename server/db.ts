import pg from 'pg'

const { Pool, types } = pg

// Match the JSON shapes the app received from Supabase/PostgREST
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number(v))) // int8
types.setTypeParser(1082, (v) => v) // date → 'YYYY-MM-DD'
types.setTypeParser(1114, (v) => (v === null ? null : v.replace(' ', 'T'))) // timestamp
types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString())) // timestamptz

let pool: pg.Pool | null = null

export class ConfigError extends Error {}

/** Pooled Neon connection used by every API request. DATABASE_URL is server-side only. */
export function getPool(): pg.Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new ConfigError('DATABASE_URL is not configured on the server.')
  pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 })
  pool.on('error', () => {
    // Idle client dropped by Neon (scale to zero); the pool reconnects on next use
  })
  return pool
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params)
}

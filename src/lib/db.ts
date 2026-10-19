/**
 * Browser database client. Keeps the supabase-js query-builder API the app was written
 * against (from/select/eq/…/rpc/storage/channel) but sends every request to the server
 * API (/api/*), which talks to Neon PostgreSQL. No database credentials reach the browser.
 */

export interface DbError {
  message: string
  code: string
  details: string | null
  hint: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export interface DbResponse<T = Any> {
  data: T
  error: DbError | null
  count: number | null
  status: number
  statusText: string
}

interface Filter { op: string; column?: string; value?: unknown; negate?: boolean }

const API_BASE = '/api'

/** The database is always reached through the server API. */
export const isDatabaseConfigured = true

// ── Session token (set by the admin/staff login) ─────────────────────────────
let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setDbAuthToken(token: string | null) {
  authToken = token
}

export function setDbUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; json: T | null; error: DbError | null }> {
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let json: Any = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!res.ok) {
      if (res.status === 401 && authToken) onUnauthorized?.()
      return {
        status: res.status,
        json: null,
        error: {
          message: json?.message || `Request failed (${res.status})`,
          code: String(json?.code || res.status),
          details: json?.details ?? null,
          hint: json?.hint ?? null,
        },
      }
    }
    return { status: res.status, json, error: null }
  } catch (err) {
    return {
      status: 0,
      json: null,
      error: { message: err instanceof Error ? err.message : 'Network error', code: 'NETWORK', details: null, hint: null },
    }
  }
}

const singleError = (n: number): DbError => ({
  message: 'JSON object requested, multiple (or no) rows returned',
  code: 'PGRST116',
  details: `The result contains ${n} rows`,
  hint: null,
})

// ── Query builder ────────────────────────────────────────────────────────────
type Action = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

class QueryBuilder<T = Any[]> implements PromiseLike<DbResponse<T>> {
  private action: Action = 'select'
  private selectCols: string | null = null
  private filters: Filter[] = []
  private orders: Array<{ column: string; ascending?: boolean; nullsFirst?: boolean }> = []
  private limitN: number | null = null
  private offsetN: number | null = null
  private countMode: 'exact' | 'planned' | 'estimated' | null = null
  private head = false
  private values: unknown = undefined
  private onConflict: string | undefined
  private ignoreDuplicates = false
  private singleMode: 'single' | 'maybe' | null = null
  private readonly table: string

  constructor(table: string) {
    this.table = table
  }

  select(columns = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    this.selectCols = columns || '*'
    if (options?.count) this.countMode = options.count
    if (options?.head) this.head = true
    return this
  }

  insert(values: unknown, options?: { count?: 'exact' }) {
    this.action = 'insert'
    this.values = values
    if (options?.count) this.countMode = options.count
    return this
  }

  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.action = 'upsert'
    this.values = values
    this.onConflict = options?.onConflict
    this.ignoreDuplicates = !!options?.ignoreDuplicates
    return this
  }

  update(values: unknown, options?: { count?: 'exact' }) {
    this.action = 'update'
    this.values = values
    if (options?.count) this.countMode = options.count
    return this
  }

  delete(options?: { count?: 'exact' }) {
    this.action = 'delete'
    if (options?.count) this.countMode = options.count
    return this
  }

  private add(op: string, column: string, value: unknown) {
    this.filters.push({ op, column, value })
    return this
  }

  eq(column: string, value: unknown) { return this.add('eq', column, value) }
  neq(column: string, value: unknown) { return this.add('neq', column, value) }
  gt(column: string, value: unknown) { return this.add('gt', column, value) }
  gte(column: string, value: unknown) { return this.add('gte', column, value) }
  lt(column: string, value: unknown) { return this.add('lt', column, value) }
  lte(column: string, value: unknown) { return this.add('lte', column, value) }
  like(column: string, pattern: string) { return this.add('like', column, pattern) }
  ilike(column: string, pattern: string) { return this.add('ilike', column, pattern) }
  is(column: string, value: null | boolean) { return this.add('is', column, value) }
  in(column: string, values: readonly unknown[]) { return this.add('in', column, [...values]) }
  contains(column: string, value: unknown) { return this.add('cs', column, value) }

  match(query: Record<string, unknown>) {
    for (const [k, v] of Object.entries(query)) this.add('eq', k, v)
    return this
  }

  not(column: string, operator: string, value: unknown) {
    this.filters.push({ op: operator, column, value, negate: true })
    return this
  }

  or(filters: string) {
    this.filters.push({ op: 'or', value: filters })
    return this
  }

  filter(column: string, operator: string, value: unknown) {
    if (operator === 'in' && typeof value === 'string') {
      return this.add('in', column, value.replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1')))
    }
    return this.add(operator, column, value)
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string }) {
    this.orders.push({ column, ascending: options?.ascending, nullsFirst: options?.nullsFirst })
    return this
  }

  limit(count: number) {
    this.limitN = count
    return this
  }

  range(from: number, to: number) {
    this.offsetN = from
    this.limitN = to - from + 1
    return this
  }

  single() {
    this.singleMode = 'single'
    return this as unknown as QueryBuilder<Any>
  }

  maybeSingle() {
    this.singleMode = 'maybe'
    return this as unknown as QueryBuilder<Any>
  }

  returns<U>() {
    return this as unknown as QueryBuilder<U>
  }

  abortSignal(_signal: AbortSignal) {
    return this
  }

  throwOnError() {
    return this
  }

  private async execute(): Promise<DbResponse<T>> {
    const isMutation = this.action !== 'select'
    const { status, json, error } = await post<{ data: Any; count: number | null }>('db', {
      table: this.table,
      action: this.action,
      select: isMutation ? this.selectCols : this.selectCols ?? '*',
      filters: this.filters,
      order: this.orders,
      limit: this.limitN,
      offset: this.offsetN,
      count: this.countMode,
      head: this.head,
      values: this.values,
      onConflict: this.onConflict,
      ignoreDuplicates: this.ignoreDuplicates,
    })
    if (error) return { data: null as T, error, count: null, status, statusText: error.message }

    let data: Any = json?.data ?? null
    const count = json?.count ?? null
    if (this.singleMode && Array.isArray(data)) {
      if (data.length === 1) data = data[0]
      else if (data.length === 0 && this.singleMode === 'maybe') data = null
      else return { data: null as T, error: singleError(data.length), count, status: 406, statusText: 'Not Acceptable' }
    }
    if (isMutation && this.selectCols === null) data = null
    return { data, error: null, count, status, statusText: 'OK' }
  }

  then<R1 = DbResponse<T>, R2 = never>(
    onfulfilled?: ((value: DbResponse<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

// ── RPC ──────────────────────────────────────────────────────────────────────
class RpcBuilder<T = Any> implements PromiseLike<DbResponse<T>> {
  private singleMode: 'single' | 'maybe' | null = null
  private readonly fn: string
  private readonly args: Record<string, unknown>

  constructor(fn: string, args: Record<string, unknown>) {
    this.fn = fn
    this.args = args
  }

  single() {
    this.singleMode = 'single'
    return this
  }

  maybeSingle() {
    this.singleMode = 'maybe'
    return this
  }

  private async execute(): Promise<DbResponse<T>> {
    const { status, json, error } = await post<{ data: Any }>('rpc', { fn: this.fn, args: this.args })
    if (error) return { data: null as T, error, count: null, status, statusText: error.message }
    let data: Any = json?.data ?? null
    if (this.singleMode && Array.isArray(data)) {
      if (data.length === 1) data = data[0]
      else if (data.length === 0 && this.singleMode === 'maybe') data = null
      else return { data: null as T, error: singleError(data.length), count: null, status: 406, statusText: 'Not Acceptable' }
    }
    return { data, error: null, count: null, status, statusText: 'OK' }
  }

  then<R1 = DbResponse<T>, R2 = never>(
    onfulfilled?: ((value: DbResponse<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

// ── Storage (files kept in Neon, served from /api/files) ─────────────────────
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

async function shrinkImage(file: Blob): Promise<Blob> {
  if (file.size <= MAX_UPLOAD_BYTES || !file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read image'))
      i.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })

const publicFileUrl = (bucket: string, path: string) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${API_BASE}/files?b=${encodeURIComponent(bucket)}&p=${encodeURIComponent(path)}`
}

const storageBucket = (bucket: string) => ({
  async upload(path: string, file: Blob, options?: { upsert?: boolean; contentType?: string; cacheControl?: string }) {
    try {
      const body = await shrinkImage(file)
      const { json, error } = await post<{ data: { path: string; fullPath: string } }>('storage', {
        bucket,
        path,
        contentType: options?.contentType || body.type || 'application/octet-stream',
        base64: await toBase64(body),
        upsert: !!options?.upsert,
      })
      return { data: error ? null : json?.data ?? null, error }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : 'Upload failed', code: 'UPLOAD', details: null, hint: null } }
    }
  },
  getPublicUrl(path: string) {
    return { data: { publicUrl: publicFileUrl(bucket, path) } }
  },
  async remove(paths: string[]) {
    const { json, error } = await post<{ data: Array<{ name: string }> }>('storage', { action: 'remove', bucket, paths })
    return { data: error ? null : json?.data ?? [], error }
  },
})

// ── Change notifications (replaces Supabase Realtime with polling) ───────────
type ChangeCallback = (payload: { eventType: '*'; table: string; schema: 'public'; new: Record<string, never>; old: Record<string, never> }) => void

const POLL_MS = 15_000
const listeners = new Set<Channel>()
const lastVersions = new Map<string, number>()
let pollTimer: ReturnType<typeof setInterval> | null = null

async function pollOnce() {
  if (!authToken || listeners.size === 0) return
  if (typeof document !== 'undefined' && document.hidden) return
  const tables = Array.from(new Set(Array.from(listeners).flatMap((l) => l.tables())))
  const { json, error } = await post<{ versions: Record<string, number> }>('versions', { tables })
  if (error || !json) return
  const changed = new Set<string>()
  for (const [table, version] of Object.entries(json.versions)) {
    const prev = lastVersions.get(table)
    if (prev !== undefined && prev !== version) changed.add(table)
    lastVersions.set(table, version)
  }
  if (changed.size === 0) return
  for (const l of Array.from(listeners)) l.notify(changed)
}

function ensurePolling() {
  if (pollTimer || typeof window === 'undefined') return
  pollTimer = setInterval(() => void pollOnce(), POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollOnce()
  })
}

class Channel {
  private handlers: Array<{ table: string; cb: ChangeCallback }> = []
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  on(_type: string, filter: { event?: string; schema?: string; table?: string; filter?: string }, cb: ChangeCallback) {
    if (filter?.table) this.handlers.push({ table: filter.table, cb })
    return this
  }

  subscribe(cb?: (status: string) => void) {
    listeners.add(this)
    ensurePolling()
    void pollOnce()
    cb?.('SUBSCRIBED')
    return this
  }

  unsubscribe() {
    listeners.delete(this)
    return Promise.resolve('ok')
  }

  tables() {
    return this.handlers.map((h) => h.table)
  }

  notify(changed: Set<string>) {
    for (const h of this.handlers) {
      if (changed.has(h.table)) {
        try {
          h.cb({ eventType: '*', table: h.table, schema: 'public', new: {}, old: {} })
        } catch (err) {
          console.error('[db] change handler failed', err)
        }
      }
    }
  }
}

// ── Public client ────────────────────────────────────────────────────────────
export const db = {
  from: <T = Any[]>(table: string) => new QueryBuilder<T>(table),
  rpc: <T = Any>(fn: string, args: Record<string, unknown> = {}) => new RpcBuilder<T>(fn, args),
  storage: { from: storageBucket },
  channel: (name: string) => new Channel(name),
  removeChannel: (channel: Channel) => channel.unsubscribe(),
}

/** Signs in a portal user on the server and returns the role and session token. */
export async function loginPortal(id: string, password: string) {
  const { json, error } = await post<{ role: 'admin' | 'staff'; token: string }>('auth', { id, password })
  if (error || !json) return { role: null, token: null, error }
  return { role: json.role, token: json.token, error: null }
}

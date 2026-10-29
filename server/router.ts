/**
 * Single entry point for /api/* — used by the Vercel function (api/[route].ts) and by the
 * Vite dev server middleware, so local development and production run the same code.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ConfigError, query } from './db.js'
import { changePassword, checkCredentials, createToken, verifyToken, type Role, type Session } from './auth.js'
import { ApiError, runDbRequest, splitTopLevel, type DbRequest, type Filter } from './query.js'
import { runRpc } from './rpc.js'
import { getObject, putObject, removeObjects } from './storage.js'

type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> }

const MAX_BODY = 5 * 1024 * 1024

async function readBody(req: Req): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) return req.body
  let raw: string
  if (typeof req.body === 'string') raw = req.body
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8')
  else {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) throw new ApiError('Request body too large', '413', 413)
      chunks.push(chunk as Buffer)
    }
    raw = Buffer.concat(chunks).toString('utf8')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApiError('Invalid JSON body', 'PGRST102', 400)
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function sessionFrom(req: Req): Session | null {
  const h = req.headers.authorization || ''
  return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null)
}

// ── Authorization ───────────────────────────────────────────────────────────
// Signed-in staff/admin may read and write the shop data (the same access the app had
// through Supabase). Without a session only the public invoice page and the shop
// branding can be read, and only by exact invoice/order identifiers.
const PUBLIC_LOOKUPS: Record<string, string[]> = {
  store_settings: [],
  orders: ['id', 'invoice_no'],
  order_items: ['order_id'],
  advance_orders: ['id', 'invoice_number', 'deposit_id'],
  advance_order_payments: ['advance_order_id'],
  advance_order_timeline: ['advance_order_id'],
}
const PUBLIC_RPCS = new Set(['get_public_invoice_by_number'])

// Shop-only fields: never sent to someone who is not signed in (e.g. a customer opening an invoice link)
const INTERNAL_FIELDS = ['remarks', 'reference_number']
function stripInternal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternal)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!INTERNAL_FIELDS.includes(k)) out[k] = stripInternal(v)
    }
    return out
  }
  return value
}
const ADMIN_ONLY_WRITES = new Set(['store_settings', 'profiles'])

const isKeyLookup = (f: Filter, keys: string[]): boolean => {
  if (f.negate) return false
  if (f.op === 'or') {
    const items = splitTopLevel(String(f.value ?? ''))
    return items.length > 0 && items.every((item) => {
      const m = /^([A-Za-z_]\w*)\.(eq|in)\./.exec(item)
      return !!m && keys.includes(m[1])
    })
  }
  return (f.op === 'eq' || f.op === 'in') && !!f.column && keys.includes(f.column)
}

function authorizeDb(session: Session | null, req: DbRequest) {
  if (req.action !== 'select') {
    if (!session) throw new ApiError('Sign in to continue', '42501', 401)
    if (ADMIN_ONLY_WRITES.has(req.table) && session.role !== 'admin') {
      throw new ApiError('Only the admin can change this', '42501', 403)
    }
    return
  }
  if (session) return
  const keys = PUBLIC_LOOKUPS[req.table]
  if (!keys) throw new ApiError('Sign in to continue', '42501', 401)
  if (keys.length === 0) return
  if (/\(/.test(req.select || '')) throw new ApiError('Sign in to continue', '42501', 401)
  if (!(req.filters || []).some((f) => isKeyLookup(f, keys))) throw new ApiError('Sign in to continue', '42501', 401)
}

// ── Table change versions (replaces Supabase Realtime) ──────────────────────
async function getVersions(tables: string[]) {
  const names = tables.filter((t) => /^[a-z_]+$/.test(t)).slice(0, 20)
  if (names.length === 0) return {}
  const r = await query<{ table_name: string; version: number }>(
    'SELECT table_name, version FROM public.table_versions WHERE table_name = ANY($1::text[])',
    [names],
  )
  const out: Record<string, number> = {}
  for (const n of names) out[n] = 0
  for (const row of r.rows) out[row.table_name] = Number(row.version)
  return out
}

const errorBody = (e: ApiError) => ({ message: e.message, code: e.code, details: e.details, hint: e.hint })

export async function route(req: Req, res: ServerResponse, routeName?: string) {
  const url = new URL(req.url || '/', 'http://localhost')
  const name = routeName || url.pathname.replace(/^\/api\/?/, '').split('/')[0]
  try {
    if (name === 'health') {
      await query('SELECT 1')
      return send(res, 200, { ok: true })
    }

    if (name === 'files' && req.method === 'GET') {
      const bucket = url.searchParams.get('b') || ''
      const path = url.searchParams.get('p') || ''
      const obj = await getObject(bucket, path)
      if (!obj) return send(res, 404, { message: 'Object not found', code: '404' })
      res.statusCode = 200
      res.setHeader('Content-Type', obj.content_type)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.end(obj.data)
    }

    // Current shop logo for link previews (WhatsApp, etc.); falls back to the bundled logo
    if (name === 'logo' && (req.method === 'GET' || req.method === 'HEAD')) {
      let logo = ''
      try {
        const r = await query<{ logo_data: string | null }>('SELECT logo_data FROM public.store_settings WHERE id = 1')
        logo = r.rows[0]?.logo_data || ''
      } catch {
        // Database unavailable: use the default logo
      }
      const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(logo)
      if (!m) {
        res.statusCode = 302
        res.setHeader('Location', '/naayan-logo.png')
        res.setHeader('Cache-Control', 'public, max-age=300')
        return res.end()
      }
      const data = Buffer.from(m[2], 'base64')
      res.statusCode = 200
      res.setHeader('Content-Type', m[1].toLowerCase())
      res.setHeader('Content-Length', String(data.length))
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.end(req.method === 'HEAD' ? undefined : data)
    }

    if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed', code: '405' })
    const body = (await readBody(req)) as Record<string, unknown>
    const session = sessionFrom(req)

    switch (name) {
      case 'auth': {
        const role = await checkCredentials(String(body.id || ''), String(body.password || ''))
        if (!role) return send(res, 401, { message: 'Invalid Admin or Staff credentials', code: '401' })
        return send(res, 200, { role, token: createToken(role, String(body.id || role).trim()) })
      }
      case 'change-password': {
        if (!session) throw new ApiError('Sign in to continue', '42501', 401)
        const target: Role = body.target === 'staff' ? 'staff' : session.role
        try {
          await changePassword(session, target, String(body.currentPassword || ''), String(body.newPassword || ''))
        } catch (err) {
          throw new ApiError(err instanceof Error ? err.message : 'Could not change the password', '400', 400)
        }
        return send(res, 200, { ok: true })
      }
      case 'db': {
        const dbReq = body as unknown as DbRequest
        authorizeDb(session, dbReq)
        const result = await runDbRequest(dbReq)
        return send(res, 200, session ? result : stripInternal(result))
      }
      case 'rpc': {
        const fn = String(body.fn || '')
        if (!session && !PUBLIC_RPCS.has(fn)) throw new ApiError('Sign in to continue', '42501', 401)
        const data = await runRpc(fn, (body.args || {}) as Record<string, unknown>)
        return send(res, 200, { data: session ? data : stripInternal(data) })
      }
      case 'versions': {
        if (!session) throw new ApiError('Sign in to continue', '42501', 401)
        return send(res, 200, { versions: await getVersions((body.tables as string[]) || []) })
      }
      case 'storage': {
        if (!session) throw new ApiError('Sign in to continue', '42501', 401)
        if (body.action === 'remove') {
          return send(res, 200, { data: await removeObjects(String(body.bucket), (body.paths as string[]) || []) })
        }
        const data = await putObject(
          String(body.bucket || ''),
          String(body.path || ''),
          String(body.contentType || ''),
          String(body.base64 || ''),
          body.upsert === true,
        )
        return send(res, 200, { data })
      }
      default:
        return send(res, 404, { message: 'Not found', code: '404' })
    }
  } catch (err) {
    if (err instanceof ApiError) return send(res, err.status, errorBody(err))
    if (err instanceof ConfigError) return send(res, 503, { message: err.message, code: 'CONFIG', details: null, hint: null })
    const e = err as { message?: string; code?: string; detail?: string; hint?: string }
    const status = e.code && /^(22|23|42|P0)/.test(e.code) ? 400 : 500
    if (status === 500) console.error('[api]', err)
    return send(res, status, {
      message: status === 500 ? 'Database error' : e.message || 'Database error',
      code: e.code || '500',
      details: status === 500 ? null : e.detail || null,
      hint: status === 500 ? null : e.hint || null,
    })
  }
}

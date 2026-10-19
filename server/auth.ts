import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

export type Role = 'admin' | 'staff'
export interface Session { role: Role; id: string; exp: number }

const SESSION_HOURS = 16

const secret = () => {
  const s = process.env.SESSION_SECRET || ''
  if (s) return s
  // Fallback keeps tokens valid across function instances when SESSION_SECRET is unset
  return createHash('sha256').update(`naayan:${process.env.DATABASE_URL || ''}`).digest('hex')
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function createToken(role: Role, id: string): string {
  const payload = b64url(JSON.stringify({ role, id, exp: Date.now() + SESSION_HOURS * 3600_000 } satisfies Session))
  return `${payload}.${sign(payload)}`
}

export function verifyToken(token: string | undefined | null): Session | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    if (!session.exp || session.exp < Date.now()) return null
    if (session.role !== 'admin' && session.role !== 'staff') return null
    return session
  } catch {
    return null
  }
}

const env = (...keys: string[]) => {
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.trim()) return v.trim()
  }
  return ''
}

const safeEqual = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

/** Checks portal credentials against server-side env (VITE_* names accepted for older deployments). */
export function checkCredentials(id: string, password: string): Role | null {
  const adminId = env('ADMIN_ID', 'VITE_ADMIN_ID', 'VITE_PORTAL_ID') || 'admin'
  const adminPass = env('ADMIN_PASSWORD', 'VITE_ADMIN_PASSWORD', 'VITE_PORTAL_PASSWORD') || 'admin123'
  const staffId = env('STAFF_ID', 'VITE_STAFF_ID') || 'staff'
  const staffPass = env('STAFF_PASSWORD', 'VITE_STAFF_PASSWORD') || 'staff123'
  const i = id.trim()
  const p = password.trim()
  if (safeEqual(i, adminId) && safeEqual(p, adminPass)) return 'admin'
  if (safeEqual(i, staffId) && safeEqual(p, staffPass)) return 'staff'
  return null
}

import { createHmac, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { query } from './db.js'

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

/**
 * Checks portal credentials against server-side env (VITE_* names accepted for older deployments).
 * The login screen sends only a passcode: the admin passcode signs in as admin, the staff
 * passcode as staff. An ID, when sent, must also match.
 */
export async function checkCredentials(id: string, password: string): Promise<Role | null> {
  const adminId = env('ADMIN_ID', 'VITE_ADMIN_ID', 'VITE_PORTAL_ID') || 'admin'
  const staffId = env('STAFF_ID', 'VITE_STAFF_ID') || 'staff'
  const i = id.trim()
  const p = password.trim()
  if (!p) return null
  const idOk = (expected: string) => !i || safeEqual(i, expected)
  if ((await passwordMatches('admin', p)) && idOk(adminId)) return 'admin'
  if ((await passwordMatches('staff', p)) && idOk(staffId)) return 'staff'
  return null
}

// ── Passwords changed from Settings ──────────────────────────────────────────
// The env values are the starting passwords. Once a password is changed in the app, its salted
// hash is kept in portal_credentials and takes over; the env value then no longer signs in.
const envPassword = (role: Role) =>
  role === 'admin'
    ? env('ADMIN_PASSWORD', 'VITE_ADMIN_PASSWORD', 'VITE_PORTAL_PASSWORD') || 'admin123'
    : env('STAFF_PASSWORD', 'VITE_STAFF_PASSWORD') || 'staff123'

let tableReady = false
async function ensureCredentialsTable() {
  if (tableReady) return
  await query(`CREATE TABLE IF NOT EXISTS public.portal_credentials (
    role text PRIMARY KEY CHECK (role IN ('admin', 'staff')),
    salt text NOT NULL,
    password_hash text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  tableReady = true
}

const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex')

async function storedCredential(role: Role): Promise<{ salt: string; password_hash: string } | null> {
  try {
    await ensureCredentialsTable()
    const r = await query<{ salt: string; password_hash: string }>('SELECT salt, password_hash FROM public.portal_credentials WHERE role = $1', [role])
    return r.rows[0] || null
  } catch {
    // Database unreachable: fall back to the env password so the owner can still sign in
    return null
  }
}

export async function passwordMatches(role: Role, password: string): Promise<boolean> {
  const stored = await storedCredential(role)
  if (!stored) return safeEqual(password, envPassword(role))
  return safeEqual(hashPassword(password, stored.salt), stored.password_hash)
}

export const MIN_PASSWORD_LENGTH = 6

/**
 * Changes a role's password. The login screen tells admin and staff apart by password alone,
 * so a new password may not equal the other role's password.
 */
export async function changePassword(session: Session, target: Role, currentPassword: string, newPassword: string): Promise<void> {
  if (target !== session.role && session.role !== 'admin') throw new Error('Only the admin can change the staff password')
  const next = newPassword.trim()
  if (next.length < MIN_PASSWORD_LENGTH) throw new Error(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  // whoever is changing it proves who they are with their own current password
  if (!(await passwordMatches(session.role, currentPassword.trim()))) throw new Error('Current password is incorrect')
  const other: Role = target === 'admin' ? 'staff' : 'admin'
  if (await passwordMatches(other, next)) throw new Error('Choose a different password: it is already used by the other login')
  await ensureCredentialsTable()
  const salt = randomBytes(16).toString('hex')
  await query(
    `INSERT INTO public.portal_credentials (role, salt, password_hash, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (role) DO UPDATE SET salt = EXCLUDED.salt, password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [target, salt, hashPassword(next, salt)],
  )
}

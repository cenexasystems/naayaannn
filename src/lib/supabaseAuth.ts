import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Optional Supabase Auth, kept only for the customer sign-in page (/login: email OTP and
 * Google). The shop's data lives in Neon and is reached through src/lib/db.ts; admin and
 * staff sign in through the server API. Leave VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * unset to switch customer sign-in off.
 */

// Vercel environment values can accidentally contain the next variable when
// several KEY=VALUE lines are pasted into one field. Keep the first non-empty
// line so a valid key still works, while preventing a newline from reaching
// the browser's Headers implementation.
const cleanEnvValue = (value: unknown) => {
  if (typeof value !== 'string') return ''
  const firstLine = value.split(/\r?\n/).map(line => line.trim()).find(Boolean) || ''
  return firstLine.replace(/^['"]|['"]$/g, '').trim()
}

const supabaseUrl = cleanEnvValue(
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined)
)

const supabaseAnonKey = cleanEnvValue(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined)
)

export const isSupabaseAuthConfigured = !!supabaseUrl && !!supabaseAnonKey

const notConfigured = { message: 'Customer sign-in is not configured.', name: 'AuthConfigError', status: 400 }
const noop = () => {}

/** Stand-in used when Supabase Auth is not configured: no session, every sign-in fails cleanly. */
const disabledAuth = {
  getSession: async () => ({ data: { session: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { id: 'disabled', callback: noop, unsubscribe: noop } } }),
  signOut: async () => ({ error: null }),
  signUp: async () => ({ data: { user: null, session: null }, error: notConfigured }),
  signInWithPassword: async () => ({ data: { user: null, session: null }, error: notConfigured }),
  signInWithOtp: async () => ({ data: { user: null, session: null }, error: notConfigured }),
  signInWithOAuth: async () => ({ data: { provider: null, url: null }, error: notConfigured }),
  verifyOtp: async () => ({ data: { user: null, session: null }, error: notConfigured }),
}

export const supabaseAuth: SupabaseClient['auth'] = isSupabaseAuthConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    }).auth
  : (disabledAuth as unknown as SupabaseClient['auth'])

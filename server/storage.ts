import { query } from './db.js'
import { ApiError } from './query.js'

/** Buckets carried over from Supabase Storage; all were public-read there. */
export const BUCKETS = new Set(['product-images', 'invoices', 'avatars', 'branding'])
const MAX_BYTES = 3 * 1024 * 1024

// Any printable path (Supabase allowed spaces etc.); values are always bound as parameters
const isValidPath = (path: string) =>
  path.length > 0 &&
  path.length <= 500 &&
  !path.includes('..') &&
  !/[\\?#]/.test(path) &&
  Array.from(path).every((ch) => ch.charCodeAt(0) >= 32)

const check = (bucket: string, path: string) => {
  if (!BUCKETS.has(bucket)) throw new ApiError('Bucket not found', '404', 404)
  if (!isValidPath(path)) throw new ApiError('Invalid object path', '400', 400)
}

export async function putObject(bucket: string, path: string, contentType: string, base64: string, upsert: boolean) {
  check(bucket, path)
  const data = Buffer.from(base64, 'base64')
  if (data.length === 0) throw new ApiError('Empty file', '400', 400)
  if (data.length > MAX_BYTES) throw new ApiError('File is larger than 3 MB', '413', 413)
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(contentType) ? contentType : 'application/octet-stream'
  const sql = upsert
    ? `INSERT INTO public.storage_files (bucket, path, content_type, size, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bucket, path) DO UPDATE SET content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data, updated_at = NOW()`
    : `INSERT INTO public.storage_files (bucket, path, content_type, size, data) VALUES ($1, $2, $3, $4, $5)`
  try {
    await query(sql, [bucket, path, type, data.length, data])
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ApiError('The resource already exists', '409', 409)
    throw err
  }
  return { path, fullPath: `${bucket}/${path}` }
}

export async function getObject(bucket: string, path: string) {
  check(bucket, path)
  const r = await query<{ content_type: string; data: Buffer; updated_at: string }>(
    'SELECT content_type, data, updated_at FROM public.storage_files WHERE bucket = $1 AND path = $2',
    [bucket, path],
  )
  return r.rows[0] || null
}

export async function removeObjects(bucket: string, paths: string[]) {
  paths.forEach((p) => check(bucket, p))
  if (paths.length === 0) return []
  const r = await query<{ path: string }>(
    'DELETE FROM public.storage_files WHERE bucket = $1 AND path = ANY($2::text[]) RETURNING path',
    [bucket, paths],
  )
  return r.rows.map((row) => ({ name: row.path }))
}

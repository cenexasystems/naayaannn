import type { IncomingMessage, ServerResponse } from 'node:http'
import { route } from '../server/router.js'

// Vercel Node function serving /api/db, /api/rpc, /api/auth, /api/storage, /api/files, /api/versions, /api/health
export default function handler(req: IncomingMessage & { query?: Record<string, string | string[]> }, res: ServerResponse) {
  const name = req.query?.route
  return route(req, res, typeof name === 'string' ? name : undefined)
}

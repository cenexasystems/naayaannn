import { getSchema, RPC_ALLOWLIST, type FunctionInfo } from './schema.js'
import { query } from './db.js'
import { ApiError } from './query.js'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Picks the overload whose named arguments match the call, like PostgREST does. */
function pickOverload(overloads: FunctionInfo[], argNames: string[]): FunctionInfo | null {
  const candidates = overloads.filter((fn) => {
    const names = new Set(fn.args.map((a) => a.name))
    if (!argNames.every((n) => names.has(n))) return false
    return fn.args.every((a) => a.hasDefault || argNames.includes(a.name))
  })
  // Prefer the overload with the fewest unused parameters
  candidates.sort((a, b) => a.args.length - b.args.length)
  return candidates[0] || null
}

const toArg = (type: string, value: unknown) => {
  if (value === null || value === undefined) return null
  if (type === 'json' || type === 'jsonb') return JSON.stringify(value)
  if (type.endsWith('[]')) return value
  if (typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value)
  return value
}

export async function runRpc(fnName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!IDENT.test(fnName) || !RPC_ALLOWLIST.has(fnName)) {
    throw new ApiError(`Could not find the function public.${fnName} in the schema cache`, 'PGRST202', 404)
  }
  const schema = await getSchema()
  const overloads = schema.functions.get(fnName)
  const names = Object.keys(args || {}).filter((k) => args[k] !== undefined)
  const fn = overloads && pickOverload(overloads, names)
  if (!fn) {
    throw new ApiError(
      `Could not find the function public.${fnName}(${names.join(', ')}) in the schema cache`,
      'PGRST202',
      404,
    )
  }
  const params: unknown[] = []
  const callArgs = names.map((n) => {
    const arg = fn.args.find((a) => a.name === n)!
    if (!IDENT.test(n)) throw new ApiError(`Invalid argument name "${n}"`, 'PGRST100')
    params.push(toArg(arg.type, args[n]))
    return `"${n}" => $${params.length}::${arg.type}`
  })
  const call = `public."${fnName}"(${callArgs.join(', ')})`

  if (fn.returnsSet || fn.returnsComposite) {
    const r = await query(`SELECT * FROM ${call}`, params)
    return fn.returnsSet ? r.rows : r.rows[0] ?? null
  }
  const r = await query<{ v: unknown }>(`SELECT ${call} AS v`, params)
  return r.rows[0]?.v ?? null
}

import { db } from './db'

const PAGE = 1000
const ID_CHUNK = 1000
// Safety stop so a runaway loop can never hammer the database (this many bills is far beyond any shop)
const MAX_PAGES = 500

type Row = Record<string, unknown>

/**
 * Every bill, newest first, fetched a page at a time. A single request is capped at 1000 rows, so
 * analytics built from one request silently dropped everything past the 1000th bill.
 */
export async function fetchAllOrders(columns: string): Promise<{ data: Row[]; error: { message: string } | null }> {
  const data: Row[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data: rows, error } = await db
      .from('orders')
      .select(columns)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { data, error }
    const batch = (rows || []) as Row[]
    data.push(...batch)
    if (batch.length < PAGE) break
  }
  return { data, error: null }
}

/** Line items for the given bills, fetched in chunks of ids so large histories stay within request limits. */
export async function fetchOrderItemsFor(orderIds: string[], columns: string, fallbackColumns: string): Promise<Row[]> {
  const chunks: string[][] = []
  for (let i = 0; i < orderIds.length; i += ID_CHUNK) chunks.push(orderIds.slice(i, i + ID_CHUNK))
  const results = await Promise.all(chunks.map(async (ids) => {
    const res = await db.from('order_items').select(columns).in('order_id', ids)
    if (!res.error) return (res.data || []) as Row[]
    const fallback = await db.from('order_items').select(fallbackColumns).in('order_id', ids)
    return (fallback.data || []) as Row[]
  }))
  return results.flat()
}

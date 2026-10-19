// Shared helpers for split payments (cash / QR / card) used by POS, advance orders and analytics.

export type SplitDetails = { cash: number; qr: number; card: number }
export type PaymentBreakdown = SplitDetails & { other: number }

export const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export const emptySplit = (): SplitDetails => ({ cash: 0, qr: 0, card: 0 })

/** String values held by the split-entry form inputs. */
export type SplitInputValue = { cash: string; qr: string; card: string }
export const emptySplitInput = (): SplitInputValue => ({ cash: '', qr: '', card: '' })

/** Reads {cash, qr|upi, card} from any JSON-ish value. Missing / invalid parts become 0. */
export function parseSplit(raw: unknown): SplitDetails {
  let source: unknown = raw
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = null }
  }
  const obj = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
  const num = (v: unknown) => Math.max(0, round2(Number(v) || 0))
  return { cash: num(obj.cash), qr: num(obj.qr ?? obj.upi), card: num(obj.card) }
}

export const splitTotal = (split: SplitDetails) => round2(split.cash + split.qr + split.card)
export const splitInputToDetails = (value: SplitInputValue) => parseSplit(value)

/** Normalizes a stored payment mode (upi = qr) to one of the known buckets. */
export function normalizePaymentMode(mode: unknown): 'cash' | 'qr' | 'card' | 'split' | 'other' {
  const m = String(mode || '').trim().toLowerCase()
  if (m === 'cash') return 'cash'
  if (m === 'qr' || m === 'upi') return 'qr'
  if (m === 'card') return 'card'
  if (m === 'split') return 'split'
  return 'other'
}

/** Amount collected through each channel for one bill / payment of `amount`. */
export function paymentBreakdown(mode: unknown, splitRaw: unknown, amount: number): PaymentBreakdown {
  const result: PaymentBreakdown = { cash: 0, qr: 0, card: 0, other: 0 }
  const normalized = normalizePaymentMode(mode)
  const split = parseSplit(splitRaw)
  if (splitTotal(split) > 0) {
    // Whenever split details exist they are the source of truth.
    result.cash = split.cash; result.qr = split.qr; result.card = split.card
    return result
  }
  const value = round2(amount)
  if (normalized === 'cash') result.cash = value
  else if (normalized === 'qr') result.qr = value
  else if (normalized === 'card') result.card = value
  else result.other = value
  return result
}

const inr = (n: number) => `₹${round2(n).toFixed(2)}`

/** Human readable label, e.g. "Cash", "QR", or "Split (Cash ₹500.00 + QR ₹300.00)". */
export function formatPaymentLabel(mode: unknown, splitRaw?: unknown): string {
  const normalized = normalizePaymentMode(mode)
  if (normalized === 'split') {
    const s = parseSplit(splitRaw)
    const parts: string[] = []
    if (s.cash > 0) parts.push(`Cash ${inr(s.cash)}`)
    if (s.qr > 0) parts.push(`QR ${inr(s.qr)}`)
    if (s.card > 0) parts.push(`Card ${inr(s.card)}`)
    return parts.length ? `Split (${parts.join(' + ')})` : 'Split'
  }
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'qr') return 'QR'
  if (normalized === 'card') return 'Card'
  const raw = String(mode || '').trim()
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ''
}

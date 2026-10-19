// Shared price / payment breakdown for advance orders, used by the create form,
// the eye (details) drawer, the PDF, the thermal receipt and the WhatsApp message.
import { parseSplit, round2, splitTotal, type SplitDetails } from './payments'
import type { AdvanceOrder, AdvancePayment } from '../services/advanceOrderService'

export type AdvanceTotals = {
  subtotal: number
  deliveryCharge: number
  discount: number
  gstRate: number
  cgst: number
  sgst: number
  gstTotal: number
  total: number
}

/** subtotal + delivery + GST - discount. GST is charged on (subtotal - discount) and split evenly into CGST / SGST. */
export function computeAdvanceTotals(input: { subtotal: number; deliveryCharge?: number; discount?: number; gstRate?: number }): AdvanceTotals {
  const subtotal = Math.max(0, round2(input.subtotal))
  const deliveryCharge = Math.max(0, round2(input.deliveryCharge || 0))
  const discount = Math.min(subtotal, Math.max(0, round2(input.discount || 0)))
  const gstRate = Math.max(0, Number(input.gstRate) || 0)
  const gstTotal = round2(((subtotal - discount) * gstRate) / 100)
  const cgst = round2(gstTotal / 2)
  const sgst = round2(gstTotal - cgst)
  return { subtotal, deliveryCharge, discount, gstRate, cgst, sgst, gstTotal, total: round2(subtotal - discount + gstTotal + deliveryCharge) }
}

/** Breakdown of a stored order. Older orders (no stored breakdown) fall back to subtotal = total. */
export function advanceBreakdown(order: AdvanceOrder): AdvanceTotals {
  const deliveryCharge = Number(order.delivery_charge || 0)
  const discount = Number(order.discount_amount || 0)
  const cgst = Number(order.cgst_amount || 0)
  const sgst = Number(order.sgst_amount || 0)
  const stored = Number(order.subtotal_amount || 0)
  const subtotal = stored > 0 ? stored : round2(order.total_amount - deliveryCharge - cgst - sgst + discount)
  return {
    subtotal,
    deliveryCharge,
    discount,
    gstRate: Number(order.gst_rate || 0),
    cgst,
    sgst,
    gstTotal: round2(cgst + sgst),
    total: order.total_amount,
  }
}

export type AdvanceBreakdownRow = { label: string; value: number; kind: 'plain' | 'minus' | 'free' | 'total' }

/** Ordered rows to show in the financial breakdown (zero-value optional rows are omitted, delivery shows FREE). */
export function advanceBreakdownRows(order: AdvanceOrder): AdvanceBreakdownRow[] {
  const b = advanceBreakdown(order)
  const rows: AdvanceBreakdownRow[] = [{ label: 'Subtotal', value: b.subtotal, kind: 'plain' }]
  rows.push({ label: 'Delivery Charges', value: b.deliveryCharge, kind: b.deliveryCharge > 0 ? 'plain' : 'free' })
  if (b.discount > 0) rows.push({ label: 'Discount', value: b.discount, kind: 'minus' })
  if (b.gstTotal > 0) {
    const half = b.gstRate > 0 ? ` (${+(b.gstRate / 2).toFixed(2)}%)` : ''
    rows.push({ label: `CGST${half}`, value: b.cgst, kind: 'plain' })
    rows.push({ label: `SGST${half}`, value: b.sgst, kind: 'plain' })
  }
  rows.push({ label: 'Total Amount', value: b.total, kind: 'total' })
  return rows
}

export type AdvancePaymentSummary = {
  deposit: number
  finalPaid: number
  remaining: number
  settled: boolean
  /** Per-channel totals actually collected (deposit + final), when known. */
  channels: SplitDetails
}

/** Deposit / final / remaining plus the cash / QR / card split of everything collected. */
export function advancePaymentSummary(order: AdvanceOrder, payments: AdvancePayment[] = []): AdvancePaymentSummary {
  const settled = order.status === 'completed'
  const deposit = order.deposit_amount
  const finalPaid = settled ? round2(order.total_amount - order.deposit_amount) : 0
  const channels = settled && splitTotal(parseSplit(order.split_details)) > 0 ? parseSplit(order.split_details) : sumChannels(payments)
  return { deposit, finalPaid, remaining: settled ? 0 : order.remaining_balance, settled, channels }
}

function sumChannels(payments: AdvancePayment[]): SplitDetails {
  const out: SplitDetails = { cash: 0, qr: 0, card: 0 }
  for (const p of payments) {
    const method = String(p.payment_method || '').toLowerCase()
    const split = parseSplit(p.split_details)
    if (splitTotal(split) > 0) { out.cash += split.cash; out.qr += split.qr; out.card += split.card; continue }
    const amount = Number(p.amount) || 0
    if (method === 'cash') out.cash += amount
    else if (method === 'upi' || method === 'qr') out.qr += amount
    else if (method === 'card') out.card += amount
  }
  return { cash: round2(out.cash), qr: round2(out.qr), card: round2(out.card) }
}

/** "Cash ₹500.00 + QR ₹300.00" style lines for one payment (used under deposit / final rows). */
export function channelLines(split: SplitDetails): Array<[string, number]> {
  const lines: Array<[string, number]> = []
  if (split.cash > 0) lines.push(['Cash', split.cash])
  if (split.qr > 0) lines.push(['QR', split.qr])
  if (split.card > 0) lines.push(['Card', split.card])
  return lines
}

/** Per-channel split of one payment record (deposit or remaining). */
export function paymentChannels(payment: AdvancePayment): SplitDetails {
  const split = parseSplit(payment.split_details)
  if (splitTotal(split) > 0) return split
  const method = String(payment.payment_method || '').toLowerCase()
  const amount = round2(Number(payment.amount) || 0)
  return { cash: method === 'cash' ? amount : 0, qr: method === 'upi' || method === 'qr' ? amount : 0, card: method === 'card' ? amount : 0 }
}

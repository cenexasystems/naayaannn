// Payment lines shown under the total on advance order receipts and invoices
import type { AdvanceOrder, AdvancePayment } from '../services/advanceOrderService'
import { channelLines, paymentChannels } from './advanceBreakdown'
import { normalizePaymentMode, round2 } from './payments'

export type PaymentLine = { label: string; value: number; sub?: boolean; accent?: boolean }

const methodName = (method: string) => { const m = normalizePaymentMode(method); return m === 'qr' ? 'QR' : m === 'other' ? method : m.charAt(0).toUpperCase() + m.slice(1) }

/** Deposit / final / remaining lines with the cash-QR-card split spelled out for split payments. */
export function paymentLines(order: AdvanceOrder, payments: AdvancePayment[]): PaymentLine[] {
  const deposit = payments.find(p => p.payment_type === 'deposit')
  const final = payments.find(p => p.payment_type === 'remaining')
  const out: PaymentLine[] = []
  const add = (label: string, value: number, payment?: AdvancePayment) => {
    const split = payment && normalizePaymentMode(payment.payment_method) === 'split'
    out.push({ label: payment && !split ? `${label} (${methodName(payment.payment_method)})` : label, value })
    if (split) channelLines(paymentChannels(payment)).forEach(([name, amount]) => out.push({ label: name, value: amount, sub: true }))
  }
  add('Deposit Paid', order.deposit_amount, deposit)
  if (order.status === 'completed') add('Final Balance Paid', round2(order.total_amount - order.deposit_amount), final)
  out.push({ label: order.status === 'completed' ? 'Remaining Balance (Fully Settled)' : 'Balance Due', value: order.status === 'completed' ? 0 : order.remaining_balance, accent: true })
  return out
}

export function downloadFile(file: File) { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500) }


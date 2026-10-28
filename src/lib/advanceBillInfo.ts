// Links a final bill (orders row) back to the advance order it completed, so the bill can show
// the deposit ID and the deposit / balance payment lines wherever it is viewed or downloaded.
import { db } from './db'
import { paymentLines, type PaymentLine } from './advanceReceipt'
import type { AdvanceOrder, AdvancePayment } from '../services/advanceOrderService'

export type AdvanceBillInfo = { depositId: string; paymentRows: PaymentLine[] }

/** Looks up advance-order details by the bill's order id or by its invoice number. */
export async function loadAdvanceBillInfo(by: { orderIds: string[] } | { invoiceNo: string }): Promise<Record<string, AdvanceBillInfo>> {
  let query = db
    .from('advance_orders')
    .select('id, deposit_id, completed_order_id, invoice_number, status, total_amount, deposit_amount, remaining_balance')
  query = 'orderIds' in by ? query.in('completed_order_id', by.orderIds) : query.eq('invoice_number', by.invoiceNo)
  const { data: advances } = await query
  if (!advances || advances.length === 0) return {}

  const { data: payments } = await db
    .from('advance_order_payments')
    .select('advance_order_id, payment_type, amount, payment_method, split_details')
    .in('advance_order_id', advances.map((a) => a.id))

  const out: Record<string, AdvanceBillInfo> = {}
  for (const a of advances) {
    const key = 'orderIds' in by ? String(a.completed_order_id || '') : String(a.invoice_number || '')
    if (!key) continue
    const own = (payments || []).filter((p) => p.advance_order_id === a.id) as unknown as AdvancePayment[]
    const order = {
      status: a.status,
      total_amount: Number(a.total_amount) || 0,
      deposit_amount: Number(a.deposit_amount) || 0,
      remaining_balance: Number(a.remaining_balance) || 0,
    } as unknown as AdvanceOrder
    out[key] = { depositId: String(a.deposit_id || ''), paymentRows: paymentLines(order, own) }
  }
  return out
}

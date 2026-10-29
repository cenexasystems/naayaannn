// Advance orders → the shared invoice layout (A4 / A5 sheet, thermal roll, preview and PDF).
import type { InvoiceItem, InvoiceProps } from '../components/Invoice'
import type { AdvanceOrder, AdvancePayment } from '../services/advanceOrderService'
import { advanceBreakdown, advancePaymentSummary } from './advanceBreakdown'
import { paymentLines } from './advanceReceipt'
import { formatPaymentLabel } from './payments'

const STATUS_LABEL: Record<AdvanceOrder['status'], string> = {
  pending_deposit: 'Deposit Pending',
  waiting_final_payment: 'Balance Due',
  ready_for_delivery: 'Ready for Delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const deliveryDate = (order: AdvanceOrder) => {
  const d = new Date(`${order.expected_delivery_date}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function orderItems(order: AdvanceOrder): InvoiceItem[] {
  const b = advanceBreakdown(order)
  const rows = order.products.length
    ? order.products
    : [{ name: order.product_name, quantity: 1, base_price: b.subtotal, line_total: b.subtotal, unit: 'piece', unit_type: 'unit' }]
  return rows.map((row, i) => ({
    id: String(row.product_id ?? row.id ?? i),
    name: String(row.name || order.product_name || 'Item'),
    qty: Number(row.quantity ?? row.qty ?? 1),
    price: Number(row.base_price ?? row.price ?? 0),
    ...row,
  })) as InvoiceItem[]
}

function totalsFor(order: AdvanceOrder) {
  const b = advanceBreakdown(order)
  return {
    subtotal: b.subtotal,
    shipping: b.deliveryCharge,
    deliveryCharge: b.deliveryCharge,
    manualDiscountAmount: b.discount,
    cgstAmount: b.cgst,
    sgstAmount: b.sgst,
    gstAmount: b.gstTotal,
    total: order.total_amount,
  }
}

/** Deposit receipt: what was paid up front and the balance still due. */
export function advanceReceiptProps(order: AdvanceOrder, payments: AdvancePayment[] = []): InvoiceProps {
  const deposit = payments.find(p => p.payment_type === 'deposit')
  return {
    invoiceNo: order.deposit_id,
    date: order.created_at,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address,
    items: orderItems(order),
    ...totalsFor(order),
    status: STATUS_LABEL[order.status] || order.status,
    paymentMode: deposit ? formatPaymentLabel(deposit.payment_method, deposit.split_details) : 'Cash',
    channel: 'advance order',
    amountReceived: order.deposit_amount,
    paymentRows: paymentLines(order, payments),
    documentTitle: 'ADVANCE RECEIPT',
    extraMeta: [['Delivery', deliveryDate(order)]],
    wordsAmount: order.deposit_amount,
    wordsLabel: 'Advance Received in Words',
    // Remarks and the reference number are internal: never printed for the customer
    notes: 'Advance payment only — this is not a final tax invoice.',
  }
}

/** Final invoice once the balance is collected. */
export function advanceFinalInvoiceProps(order: AdvanceOrder, payments: AdvancePayment[] = []): InvoiceProps {
  return {
    invoiceNo: order.invoice_number || order.deposit_id,
    date: order.completed_at || new Date().toISOString(),
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address,
    items: orderItems(order),
    ...totalsFor(order),
    status: 'completed',
    documentTitle: 'TAX INVOICE',
    // Everything collected (deposit + balance), so a cash deposit and card balance reads as a split
    paymentMode: order.final_payment_method ? formatPaymentLabel(order.final_payment_method, advancePaymentSummary(order, payments).channels) : 'Paid',
    channel: 'advance order',
    amountReceived: order.total_amount,
    paymentRows: paymentLines(order, payments),
    extraMeta: [['Advance Order', order.deposit_id]],
  }
}

export const advanceDocumentProps = (order: AdvanceOrder, payments: AdvancePayment[] = []) =>
  order.status === 'completed' ? advanceFinalInvoiceProps(order, payments) : advanceReceiptProps(order, payments)

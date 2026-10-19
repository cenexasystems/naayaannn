import { jsPDF } from 'jspdf'
import { BRAND_ADDRESS, BRAND_PHONE_DISPLAY, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { BRAND_PRINT_LOGO } from './brand'
import { formatCurrency } from './retail'
import { formatPaymentLabel } from './payments'
import type { AdvanceOrder, AdvancePayment } from '../services/advanceOrderService'
import { advanceBreakdownRows, channelLines, paymentChannels } from './advanceBreakdown'
import { normalizePaymentMode, round2 } from './payments'
import { formatPhoneDisplay } from './phone'
import { printHtmlDocument } from './printHtml'

const esc = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))

// jsPDF's built-in Helvetica font does not include the ₹ Unicode glyph (U+20B9).
// Using the Intl formatter directly causes the ₹ character to render as "1" or a
// replacement box in PDF viewers. This PDF-safe formatter outputs "Rs." instead.
const pdfMoney = (value: number): string => {
  const formatted = formatCurrency(value)
  // Replace leading ₹ (with optional non-breaking space) with "Rs. "
  return formatted.replace(/^[₹\u20b9]\s*/, 'Rs. ')
}

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

export function advanceReceiptPdf(order: AdvanceOrder, payments: AdvancePayment[] = []) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFillColor('#111111'); doc.rect(0, 0, 210, 5, 'F')
  try { doc.addImage(BRAND_PRINT_LOGO, 'PNG', 16, 9, 16, 16) } catch (_err) { /* ignore missing logo */ }
  doc.setTextColor('#6B7280'); doc.setFontSize(8); doc.text('ADVANCE RECEIPT - NOT A TAX INVOICE', 38, 26)

  doc.setFont('helvetica', 'normal'); doc.text(BRAND_ADDRESS, 194, 20, { align: 'right', maxWidth: 76 }); doc.text(BRAND_PRIMARY_PHONE_DISPLAY, 194, 30, { align: 'right' })
  doc.setDrawColor('#A1A1AA'); doc.line(16, 38, 194, 38)
  doc.setTextColor('#1F1F1F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(order.deposit_id, 16, 51)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor('#6B7280'); doc.text(`Created: ${new Date(order.created_at).toLocaleString('en-IN')}`, 194, 51, { align: 'right' })
  const rows = [
    ['Customer', order.customer_name], ['Phone', formatPhoneDisplay(order.phone)], ['Address', order.address || '-'], ['Product', order.product_name],
    ['Category', order.category || '-'], ['Expected delivery', new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')],
  ]
  let y = 66
  rows.forEach(([label, value]) => { doc.setFont('helvetica', 'bold'); doc.setTextColor('#6B7280'); doc.text(label.toUpperCase(), 16, y); doc.setFont('helvetica', 'normal'); doc.setTextColor('#1F1F1F'); doc.text(String(value), 64, y, { maxWidth: 126 }); y += 10 })
  y += 4
  const rowsBreakdown = advanceBreakdownRows(order)
  const lines = paymentLines(order, payments)
  const boxHeight = 8 + rowsBreakdown.length * 8 + 5 + lines.reduce((sum, line) => sum + (line.sub ? 6 : 8), 0) + 4
  doc.setFillColor('#FAFAFA'); doc.roundedRect(16, y, 178, boxHeight, 3, 3, 'F')
  let rowY = y + 9
  doc.setFontSize(9)
  rowsBreakdown.forEach(row => {
    const total = row.kind === 'total'
    doc.setFont('helvetica', total ? 'bold' : 'normal'); doc.setTextColor(total ? '#111111' : '#374151')
    doc.text(row.label, 22, rowY)
    doc.text(row.kind === 'free' ? 'FREE' : `${row.kind === 'minus' ? '-' : ''}${pdfMoney(row.value)}`, 188, rowY, { align: 'right' })
    rowY += 8
    if (total) { doc.setDrawColor('#A1A1AA'); doc.line(22, rowY - 5, 188, rowY - 5); rowY += 2 }
  })
  lines.forEach(line => {
    doc.setFont('helvetica', line.sub ? 'normal' : 'bold')
    doc.setFontSize(line.sub ? 8 : 9)
    doc.setTextColor(line.accent ? '#52525B' : line.sub ? '#6B7280' : '#374151')
    doc.text(line.sub ? `    ${line.label}` : line.label, 22, rowY)
    doc.text(pdfMoney(line.value), 188, rowY, { align: 'right' })
    rowY += line.sub ? 6 : 8
  })
  y += boxHeight
  doc.setFont('helvetica', 'bold'); doc.setTextColor('#b45309'); doc.setFontSize(9); doc.text('This receipt records an advance payment only. It is not a final invoice.', 105, y + 13, { align: 'center' })
  return new File([doc.output('blob')], `Advance-Receipt-${order.deposit_id}.pdf`, { type: 'application/pdf' })
}

export function printAdvanceReceipt(order: AdvanceOrder, payments: AdvancePayment[] = []) {
  try {
    const paymentLabel = order.final_payment_method
      ? (order.final_payment_method === 'upi' ? 'UPI / QR' : order.final_payment_method === 'split' ? formatPaymentLabel('split', order.split_details) : order.final_payment_method.toUpperCase())
      : ''
    const depositPayment = (() => {
      return paymentLabel || 'Cash'
    })()

    const html = `<!doctype html><html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false"><head><title>Advance Receipt ${esc(order.deposit_id)}</title>
<meta charset="utf-8">
<meta name="grammarly" content="off">
<meta name="robots" content="noindex,nofollow">
<style>
  @page { size: 80mm auto; margin: 0; }
  @media print { @page { size: 80mm auto; margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 12px;
    width: 72mm;
    padding: 4mm;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 55%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .bold { font-weight: bold; }
  .warn { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
  .label { font-size: 10px; color: #555; }
  .balance-row { font-size: 14px; font-weight: bold; }
</style>
</head><body>
<div class="c" style="margin-bottom: 6px;">
  <img src="${BRAND_PRINT_LOGO}" style="width: 50px; height: 50px; object-fit: contain; margin: 0 auto; display: block;" alt="Logo" />
</div>
<div class="c" style="font-size:10px;color:#555;">${esc(BRAND_ADDRESS)}</div>
<div class="c" style="font-size:10px;color:#555;">${esc(BRAND_PHONE_DISPLAY)}</div>
<div class="line"></div>
<div class="c big">ADVANCE RECEIPT</div>
<div class="c" style="font-size:10px;">Not a final tax invoice</div>
<div class="line"></div>
<div><span class="bold">${esc(order.deposit_id)}</span></div>
<div style="font-size:10px;color:#555;">${new Date(order.created_at).toLocaleString('en-IN')}</div>
<div class="line"></div>
<div class="r"><span class="label">Customer</span><span class="bold">${esc(order.customer_name)}</span></div>
<div class="r"><span class="label">Phone</span><span>${esc(formatPhoneDisplay(order.phone))}</span></div>
${order.address ? `<div class="r"><span class="label">Address</span><span>${esc(order.address)}</span></div>` : ''}
<div class="r"><span class="label">Product</span><span>${esc(order.product_name)}</span></div>
${order.category ? `<div class="r"><span class="label">Category</span><span>${esc(order.category)}</span></div>` : ''}
<div class="r"><span class="label">Delivery</span><span>${esc(new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>
<div class="r"><span class="label">Payment</span><span>${esc(depositPayment)}</span></div>
<div class="line"></div>
${advanceBreakdownRows(order).map(row => `<div class="r${row.kind === 'total' ? ' bold' : ''}"><span>${esc(row.label)}</span><span>${row.kind === 'free' ? 'FREE' : `${row.kind === 'minus' ? '-' : ''}${esc(formatCurrency(row.value))}`}</span></div>`).join('')}
<div class="line"></div>
${paymentLines(order, payments).map(line => `<div class="r${line.accent ? ' balance-row' : ''}"${line.sub ? ' style="font-size:10px;color:#555;padding-left:8px;"' : ''}><span>${esc(line.label)}</span><span class="${line.sub || line.accent ? '' : 'bold'}">${esc(formatCurrency(line.value))}</span></div>`).join('')}
<div class="line"></div>
<div class="warn">ADVANCE PAYMENT ONLY &mdash; NOT A FINAL INVOICE</div>
</body></html>`

    printHtmlDocument(html)
  } catch (err) {
    console.warn('[advanceReceipt] Failed to print advance receipt:', err)
  }
}

export function downloadFile(file: File) { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500) }


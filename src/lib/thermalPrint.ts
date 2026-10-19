import { BRAND_ADDRESS, BRAND_EN, BRAND_GSTIN, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { formatCurrency, formatInvoiceNo } from './retail'
import { printHtmlDocument } from './printHtml'
import { amountInWords } from './amountInWords'
import { loadPrintSettings, type ThermalWidth } from './printSettings'

export interface ThermalReceiptData {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  items: Array<{
    name: string
    qty: number
    unit?: string
    price: number
    line_total?: number
  }>
  subtotal: number
  shipping: number
  couponDiscount?: number
  manualDiscount?: number
  totalGst?: number
  /** When either is set they replace the single GST row. */
  cgst?: number
  sgst?: number
  /** Extra lines under the Total (e.g. deposit paid / balance paid / remaining for advance orders). */
  paymentRows?: Array<{ label: string; value: number; sub?: boolean; accent?: boolean }>
  total: number
  /** e.g. "Cash", "QR", "Split (Cash ₹100.00 + QR ₹50.00)" */
  paymentMode?: string
  /** Heading override, e.g. "ADVANCE RECEIPT" */
  title?: string
  /** Extra lines under the date, e.g. [['Delivery:', '25 Oct 2026']] */
  extraRows?: Array<[string, string]>
  /** Amount spelled out at the bottom (defaults to the total) */
  wordsAmount?: number
  /** Small print above the thank-you line */
  note?: string
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
}

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

const money = (n: number) => formatCurrency(n).replace(/^₹\s*/, '')

const formatCustomerPhone = (phone?: string): string => {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  return phone.trim()
}

const paymentText = (mode?: string) => {
  const m = (mode || 'Cash').trim()
  if (/^(qr|upi)$/i.test(m)) return 'GPay'
  return m
}

/** Builds the thermal-roll receipt as a standalone HTML document (used for printing and on-screen preview). */
export function buildThermalReceiptHtml(data: ThermalReceiptData, width: ThermalWidth = '80'): string {
  const narrow = width === '58'
  const paperMm = narrow ? 58 : 80
  const base = narrow ? 10.5 : 12
  const when = (() => { const d = new Date(data.date); return Number.isNaN(d.getTime()) ? new Date() : d })()
  const dateStr = `${when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${when
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    .toLowerCase()}`
  const name = (data.storeName || BRAND_EN).toUpperCase()
  const cgst = data.cgst ?? ((data.totalGst || 0) > 0 ? Math.round(((data.totalGst || 0) / 2) * 100) / 100 : 0)
  const sgst = data.sgst ?? ((data.totalGst || 0) > 0 ? Math.round(((data.totalGst || 0) - cgst) * 100) / 100 : 0)
  const isGst = cgst + sgst > 0

  const row = (label: string, value: string, style = '') =>
    `<tr style="${style}"><td class="l">${label}</td><td class="r">${value}</td></tr>`

  return `<!DOCTYPE html>
<html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false">
<head>
<meta charset="UTF-8">
<meta name="grammarly" content="off">
<meta name="robots" content="noindex,nofollow">
<title>Receipt - ${esc(formatInvoiceNo(data.invoiceNo))}</title>
<style>
  @page { margin: 0; size: ${paperMm}mm auto; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body {
    font-family: 'Consolas', 'Courier New', Courier, monospace;
    font-size: ${base}px;
    color: #000;
    width: ${paperMm}mm;
    padding: ${narrow ? '3mm 2.5mm' : '4mm 4mm'};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .dash { border-top: 1px dashed #000; margin: 7px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 2px 0; vertical-align: top; }
  .l { text-align: left; }
  .r { text-align: right; white-space: nowrap; }
  .meta td { padding: 1.5px 0; }
  .items th { font-weight: bold; padding: 3px 0; border-bottom: 1px dashed #000; }
  .items td { padding: 4px 0; }
  .muted { color: #333; font-size: ${base - 2}px; }
</style>
</head>
<body>
  <div class="c">
    <div class="b" style="font-size:${narrow ? 15 : 18}px; letter-spacing:1px;">${esc(name)}</div>
    <div style="font-size:${base - 1.5}px; line-height:1.35; margin-top:4px;">${esc(data.storeAddress || BRAND_ADDRESS)}</div>
    ${BRAND_PRIMARY_PHONE_DISPLAY ? `<div style="font-size:${base - 1}px; margin-top:2px;">Ph: ${esc(data.storePhone || BRAND_PRIMARY_PHONE_DISPLAY)}</div>` : ''}
    ${isGst && BRAND_GSTIN ? `<div style="font-size:${base - 1.5}px; margin-top:2px;">GSTIN: ${esc(BRAND_GSTIN)}</div>` : ''}
  </div>

  <div class="dash"></div>
  <table class="meta">
    <tr><td colspan="2" class="c b" style="padding-bottom:4px; font-size:${base + 1}px; letter-spacing:1px;">${esc(data.title || (isGst ? 'TAX INVOICE' : 'INVOICE'))}</td></tr>
    ${row('No:', `<span class="b">#${esc(/^DEP-/i.test(data.invoiceNo) ? data.invoiceNo : formatInvoiceNo(data.invoiceNo))}</span>`)}
    ${row('Date:', esc(dateStr))}
    ${(data.extraRows || []).map(([k, v]) => row(esc(k), esc(v))).join('')}
    ${data.customerName ? row('Customer:', `<span class="b">${esc(data.customerName)}</span>`) : ''}
    ${data.phone ? row('Phone:', esc(formatCustomerPhone(data.phone))) : ''}
  </table>
  <div class="dash"></div>

  <table class="items" style="table-layout:fixed;">
    <thead>
      <tr>
        <th class="l" style="width:${narrow ? 50 : 54}%;">Item</th>
        <th style="width:${narrow ? 16 : 16}%; text-align:center;">Qty</th>
        <th class="r" style="width:${narrow ? 34 : 30}%;">Amt</th>
      </tr>
    </thead>
    <tbody>
      ${data.items.map(item => {
        const lineTotal = item.line_total ?? (item.qty * item.price)
        const unit = item.unit && !['unit', 'piece', 'pc', 'pcs', 'pieces'].includes(item.unit) ? `/${esc(item.unit)}` : ''
        return `<tr>
          <td class="l" style="word-break:break-word; padding-right:3px;">
            <div class="b">${esc(item.name)}</div>
            ${item.qty !== 1 ? `<div class="muted">@ ${esc(money(item.price))}${unit}</div>` : ''}
          </td>
          <td style="text-align:center;">${esc(item.qty)}</td>
          <td class="r">${esc(money(lineTotal))}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>
  <div class="dash" style="margin-top:2px;"></div>

  <table>
    ${row('Subtotal:', esc(money(data.subtotal)))}
    ${(data.couponDiscount || 0) > 0 ? row('Coupon:', `-${esc(money(data.couponDiscount || 0))}`) : ''}
    ${(data.manualDiscount || 0) > 0 ? row('Discount:', `-${esc(money(data.manualDiscount || 0))}`) : ''}
    ${isGst ? row('CGST:', esc(money(cgst))) + row('SGST:', esc(money(sgst))) : ''}
    ${data.shipping > 0 ? row('Delivery:', esc(money(data.shipping))) : ''}
  </table>
  <div class="dash"></div>
  <table>
    ${row('TOTAL:', esc(formatCurrency(data.total)), `font-weight:bold; font-size:${narrow ? 13 : 15}px;`)}
    ${(data.paymentRows || []).map(r => row(
      `${r.sub ? '&nbsp;&nbsp;' : ''}${esc(r.label)}`,
      esc(formatCurrency(r.value)),
      r.sub ? `font-size:${base - 2}px; color:#333;` : r.accent ? 'font-weight:bold;' : '',
    )).join('')}
  </table>
  <div class="dash"></div>

  <div class="c b" style="font-size:${base - 1}px;">${esc(paymentText(data.paymentMode))}</div>
  <div class="dash"></div>
  <div class="c" style="font-size:${base - 2.5}px; color:#333; text-transform:uppercase; letter-spacing:0.3px;">${esc(amountInWords(data.wordsAmount ?? data.total))}</div>
  ${data.note ? `<div class="c" style="margin-top:8px; font-size:${base - 2}px; font-weight:bold;">${esc(data.note)}</div>` : ''}

  <div class="c" style="margin-top:14px; font-style:italic; font-weight:bold;">Thank you for your business!</div>
  <div class="c b" style="margin-top:6px; font-size:${narrow ? 12 : 14}px; letter-spacing:3px;">— ${esc(name)} —</div>
</body>
</html>`
}

/** Prints the thermal receipt; the roll width defaults to the counter's saved print setting. */
export function printThermalReceipt(data: ThermalReceiptData, width?: ThermalWidth) {
  try {
    printHtmlDocument(buildThermalReceiptHtml(data, width || loadPrintSettings().thermalWidth))
  } catch (err) {
    console.warn('[thermalPrint] Failed to print receipt:', err)
  }
}

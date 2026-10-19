import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { BRAND_PRINT_LOGO } from './brand'
import { formatCurrency, formatInvoiceNo } from './retail'
import { printHtmlDocument } from './printHtml'

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
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
}

export function printThermalReceipt(data: ThermalReceiptData) {
  try {
    const dateStr = (() => {
      try { return new Date(data.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
      catch { return new Date().toLocaleString('en-IN') }
    })()

    const formatCustomerPhone = (phone?: string): string => {
      if (!phone) return ''
      const trimmed = phone.trim()
      const digits = trimmed.replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
      }
      if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
      }
      return trimmed
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false">
        <head>
          <meta charset="UTF-8">
          <meta name="grammarly" content="off">
          <meta name="robots" content="noindex,nofollow">
          <title>Receipt - ${data.invoiceNo}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 12px;
            color: #000;
            margin: 0;
            padding: 4mm;
            width: 80mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: bold; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
          .border-top { border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; vertical-align: top; }
          .item-name { font-size: 11px; padding-right: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center mb-2">
          <img src="${BRAND_PRINT_LOGO}" style="width: 48px; height: 48px; object-fit: contain; margin: 0 auto 6px auto; display: block;" alt="Logo" />
          <div style="font-size: 9.5px; margin-top: 2px; line-height: 1.3;">${data.storeAddress || BRAND_ADDRESS}</div>
          ${BRAND_PRIMARY_PHONE_DISPLAY ? `<div class="mt-1" style="font-size: 10px; font-weight: bold;">Ph: ${BRAND_PRIMARY_PHONE_DISPLAY}</div>` : ''}
          <div style="font-size: 9px; color: #333;">${[data.storeEmail || BRAND_EMAIL, BRAND_INSTAGRAM ? `Insta: @${BRAND_INSTAGRAM}` : ''].filter(Boolean).join(' | ')}</div>
        </div>

        <div class="border-bottom border-top" style="font-size: 11px;">
          <div>Inv: #${formatInvoiceNo(data.invoiceNo)}</div>
          <div>Date: ${dateStr}</div>
          ${data.customerName ? `<div>Name: ${data.customerName}</div>` : ''}
          ${data.phone ? `<div>Tel: ${formatCustomerPhone(data.phone)}</div>` : ''}
        </div>

        <table class="border-bottom" style="width: 100%; table-layout: fixed; border-collapse: collapse;">
          <thead>
            <tr style="font-size: 10px; border-bottom: 1px dashed #000;">
              <th style="width: 50%; text-align: left; padding: 4px 0;">Item Name</th>
              <th style="width: 18%; text-align: center; padding: 4px 0;">Qty</th>
              <th style="width: 32%; text-align: right; padding: 4px 0;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => {
              const lineTotal = item.line_total ?? (item.qty * item.price)
              const unit = item.unit && item.unit !== 'unit' && item.unit !== 'piece' ? item.unit : ''
              const rateDisplay = `${formatCurrency(item.price)}${unit ? `/${unit}` : ''}`
              return `
                <tr>
                  <td style="text-align: left; padding: 3px 2px 3px 0; vertical-align: top; word-break: break-word;">
                    <div style="font-size: 11px; font-weight: bold; line-height: 1.25;">${item.name}</div>
                    <div style="font-size: 9px; color: #444; margin-top: 1px;">@ ${rateDisplay}</div>
                  </td>
                  <td style="text-align: center; vertical-align: top; padding: 3px 0; font-size: 11px;">
                    ${item.qty}
                  </td>
                  <td style="text-align: right; vertical-align: top; padding: 3px 0; font-size: 11px; font-weight: bold;">
                    ${formatCurrency(lineTotal)}
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>

        <div class="border-bottom" style="font-size: 12px;">
          <table style="width: 100%;">
            ${data.subtotal !== data.total ? `
              <tr>
                <td class="text-left">Subtotal</td>
                <td class="text-right">${formatCurrency(data.subtotal)}</td>
              </tr>
            ` : ''}
            ${(data.couponDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Coupon</td>
                <td class="text-right">-${formatCurrency(data.couponDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.manualDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Manual Disc.</td>
                <td class="text-right">-${formatCurrency(data.manualDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.cgst || 0) > 0 || (data.sgst || 0) > 0 ? `
              <tr>
                <td class="text-left">CGST</td>
                <td class="text-right">+${formatCurrency(data.cgst || 0)}</td>
              </tr>
              <tr>
                <td class="text-left">SGST</td>
                <td class="text-right">+${formatCurrency(data.sgst || 0)}</td>
              </tr>
            ` : (data.totalGst || 0) > 0 ? `
              <tr>
                <td class="text-left">GST</td>
                <td class="text-right">+${formatCurrency(data.totalGst || 0)}</td>
              </tr>
            ` : ''}
            ${data.shipping > 0 ? `
              <tr>
                <td class="text-left">Delivery</td>
                <td class="text-right">${formatCurrency(data.shipping)}</td>
              </tr>
            ` : ''}
            <tr class="font-bold" style="font-size: 14px;">
              <td class="text-left">Total</td>
              <td class="text-right">${formatCurrency(data.total)}</td>
            </tr>
            ${(data.paymentRows || []).map(row => `
              <tr style="${row.sub ? 'font-size: 10px; color: #444;' : row.accent ? 'font-weight: bold;' : ''}">
                <td class="text-left">${row.sub ? '&nbsp;&nbsp;' : ''}${row.label}</td>
                <td class="text-right">${formatCurrency(row.value)}</td>
              </tr>
            `).join('')}
          </table>
        </div>

        <div class="text-center mt-2" style="font-size: 11px;">
          <div class="font-bold">Thank you for shopping at ${BRAND_EN.toUpperCase()}!</div>
          ${BRAND_INSTAGRAM ? `<div>Follow us on Instagram: @${BRAND_INSTAGRAM}</div>` : ''}
        </div>
      </body>
    </html>
  `

    printHtmlDocument(html)
  } catch (err) {
    console.warn('[thermalPrint] Failed to print receipt:', err)
  }
}

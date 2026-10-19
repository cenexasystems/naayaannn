import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { invoicePdfFileFromElement } from './invoicePdf'
import { Invoice, type InvoiceProps } from '../components/Invoice'
import { normalizeStructuredOrderItem, formatInvoiceNo } from './retail'
import { printHtmlDocument } from './printHtml'
import { buildThermalReceiptHtml, printThermalReceipt, type ThermalReceiptData } from './thermalPrint'
import type { PrintSettings, SheetSize } from './printSettings'

/** Maps the A4 invoice props onto the thermal-roll receipt data so both layouts show the same bill. */
export function invoiceToThermal(props: InvoiceProps): ThermalReceiptData {
  return {
    invoiceNo: props.invoiceNo,
    date: props.date,
    customerName: props.customerName,
    phone: props.phone,
    items: props.items.map(item => {
      const n = normalizeStructuredOrderItem(item as unknown as Record<string, unknown>)
      return { name: n.name, qty: n.quantity, unit: n.unit, price: n.base_price, line_total: n.line_total }
    }),
    subtotal: props.subtotal,
    shipping: props.deliveryCharge || props.shipping || 0,
    couponDiscount: props.discountAmount || 0,
    manualDiscount: props.manualDiscountAmount || 0,
    totalGst: props.gstAmount || 0,
    cgst: props.cgstAmount,
    sgst: props.sgstAmount,
    paymentRows: props.paymentRows,
    total: props.total,
    paymentMode: props.paymentMode,
    title: props.documentTitle,
    extraRows: (props.extraMeta || []).map(([k, v]) => [`${k}:`, v] as [string, string]),
    wordsAmount: props.wordsAmount,
    note: props.documentTitle && props.notes ? props.notes : undefined,
  }
}

export function thermalPreviewHtml(props: InvoiceProps, settings: PrintSettings) {
  return buildThermalReceiptHtml(invoiceToThermal(props), settings.thermalWidth)
}

/** Prints the A4 / A5 sheet invoice using the same layout shown on screen. */
export function printSheetInvoice(props: InvoiceProps, size: SheetSize) {
  const markup = renderToStaticMarkup(createElement(Invoice, props))
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Invoice ${formatInvoiceNo(props.invoiceNo)}</title>
<style>
  @page { size: ${size} portrait; margin: ${size === 'A4' ? '8mm' : '5mm'}; }
  html, body { margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${size === 'A5' ? 'body { zoom: 0.72; }' : ''}
  #invoice-print-root { max-width: none !important; padding: 18px 22px !important; }
  tr { page-break-inside: avoid; }
</style></head><body>${markup}</body></html>`
  printHtmlDocument(html)
}

/** Prints the bill on whichever printer the counter selected. */
export function printBill(props: InvoiceProps, settings: PrintSettings) {
  if (settings.printer === 'sheet') printSheetInvoice(props, settings.sheetSize)
  else printThermalReceipt(invoiceToThermal(props), settings.thermalWidth)
}

/** Renders the invoice off-screen and captures it as a PDF, so downloads match what is printed. */
export async function invoicePdfFromProps(props: InvoiceProps, fileName?: string): Promise<File> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;pointer-events:none;'
  host.setAttribute('aria-hidden', 'true')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(createElement(Invoice, props)))
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r })))
    const file = await invoicePdfFileFromElement(host, props.invoiceNo)
    return fileName ? new File([file], fileName, { type: 'application/pdf' }) : file
  } finally {
    root.unmount()
    host.remove()
  }
}

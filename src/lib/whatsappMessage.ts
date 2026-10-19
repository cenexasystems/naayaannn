import { formatInvoiceNo } from './retail'
import { BRAND_EN, BRAND_ADDRESS, BRAND_PHONE_DISPLAY, BRAND_INSTAGRAM_URL, BRAND_PRODUCTION_DOMAIN } from './brand'

export type WhatsAppLineItem = {
  name: string
  qty: number
  unit: string
  unitType: 'unit' | 'weight' | 'volume' | 'bundle'
  rate: number
  lineTotal: number
}

export type BuildWhatsAppMessageInput = {
  customerName?: string
  phone?: string
  invoiceNumber: string
  invoiceDate?: string
  invoiceUrl?: string
  paymentMode?: string
  items?: WhatsAppLineItem[]
  subtotal?: number
  couponDiscount?: number
  manualDiscountAmount?: number
  shipping?: number
  gstAmount?: number
  total?: number
}

export type AdvanceDepositWhatsAppInput = {
  customerName?: string
  depositId: string
  productName: string
  totalAmount: number
  depositAmount: number
  remainingBalance: number
  expectedDeliveryDate: string
  paymentMethod?: string
  /** Optional price breakdown lines (subtotal / delivery / discount / CGST / SGST). */
  subtotal?: number
  deliveryCharge?: number
  discount?: number
  cgst?: number
  sgst?: number
}

export const publicInvoiceUrl = (invoiceNumber: string) => {
  const formatted = formatInvoiceNo(invoiceNumber)
  const envUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '')
  const origin =
    envUrl ||
    (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.includes('localhost')
      ? window.location.origin
      : BRAND_PRODUCTION_DOMAIN)
  return `${origin}/invoice/${encodeURIComponent(formatted)}`
}

export const buildProfessionalWhatsAppMessage = (input: BuildWhatsAppMessageInput) => {
  const customerName = input.customerName?.trim() || 'Customer'
  const invoiceUrl = input.invoiceUrl || publicInvoiceUrl(input.invoiceNumber)
  const formattedNo = formatInvoiceNo(input.invoiceNumber)
  const itemsText = input.items && input.items.length > 0
    ? input.items.map(item => `• ${item.name} (x${item.qty}) - ₹ ${Number(item.lineTotal || 0).toFixed(2)}`).join('\n')
    : ''

  return `*${BRAND_EN} - Purchase Invoice*
━━━━━━━━━━━━━━━━━━━
Dear ${customerName}, thank you for shopping with us!

🧾 *INVOICE DETAILS*
📌 *Invoice No:* #${formattedNo}
${input.invoiceDate ? `📅 *Date:* ${new Date(input.invoiceDate).toLocaleDateString('en-IN')}\n` : ''}${input.paymentMode ? `💳 *Payment Mode:* ${input.paymentMode}\n` : ''}${input.total !== undefined ? `💰 *Total Amount:* ₹ ${Number(input.total || 0).toFixed(2)}\n` : ''}
${itemsText ? `📦 *ITEMS ORDERED:*\n${itemsText}\n\n` : ''}📄 *View & Download Digital Invoice / PDF:*
👉 ${invoiceUrl}

📍 *Address:* ${BRAND_ADDRESS}
📞 *Contact:* ${BRAND_PHONE_DISPLAY}
📷 *Instagram:* ${BRAND_INSTAGRAM_URL}

Thank you, and visit us again!`
}

export const buildAdvanceDepositWhatsAppMessage = (input: AdvanceDepositWhatsAppInput) => {
  const customerName = input.customerName?.trim() || 'Customer'
  const deliveryDateFormatted = input.expectedDeliveryDate
    ? (() => {
        try {
          return new Date(`${input.expectedDeliveryDate}T00:00:00`).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        } catch {
          return input.expectedDeliveryDate
        }
      })()
    : '-'

  return `*${BRAND_EN} - Advance Order Receipt*
━━━━━━━━━━━━━━━━━━━
Dear ${customerName}, thank you for choosing ${BRAND_EN}!

We have successfully received your initial advance payment:

🧾 *ADVANCE ORDER DETAILS*
📦 *Deposit ID:* #${input.depositId}
👔 *Product:* ${input.productName}
${input.subtotal !== undefined && input.subtotal !== input.totalAmount ? `🧮 *Subtotal:* ₹${input.subtotal}
` : ''}${(input.discount || 0) > 0 ? `🏷️ *Discount:* -₹${input.discount}
` : ''}${(input.cgst || 0) > 0 ? `📊 *CGST:* ₹${input.cgst}
📊 *SGST:* ₹${input.sgst || 0}
` : ''}${input.subtotal !== undefined ? `🚚 *Delivery:* ${(input.deliveryCharge || 0) > 0 ? `₹${input.deliveryCharge}` : 'Free'}
` : ''}💵 *Total Order Amount:* ₹${input.totalAmount}
💰 *Advance Paid:* ₹${input.depositAmount}${input.paymentMethod ? ` (${input.paymentMethod.toLowerCase() === 'upi' ? 'QR' : input.paymentMethod.toUpperCase()})` : ''}
🔴 *Balance to Pay on Delivery:* ₹${input.remainingBalance}
📅 *Expected Delivery Date:* ${deliveryDateFormatted}

Your garments are being prepared with utmost care. We will have everything ready on or before ${deliveryDateFormatted}!

📍 *Address:* ${BRAND_ADDRESS}
📞 *Contact:* ${BRAND_PHONE_DISPLAY}
📷 *Instagram:* ${BRAND_INSTAGRAM_URL}`
}

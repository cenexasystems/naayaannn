import React from 'react'
import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_GSTIN, BRAND_PRIMARY_PHONE_DISPLAY, BRAND_PRINT_LOGO } from '../lib/brand'
import { formatCurrency, formatQuantityDisplay, normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { formatPhoneDisplay } from '../lib/phone'
import { amountInWords } from '../lib/amountInWords'

export interface InvoiceItem {
  id: string | number
  name: string
  nameTa?: string
  qty: number
  quantity?: number
  unit?: string
  unit_type?: 'unit' | 'piece' | 'weight' | 'volume' | 'bundle'
  base_quantity?: number
  base_price?: number
  price: number
  offerPrice?: number | null
  line_total?: number
  lineTotal?: number
  /** HSN / SAC code shown on GST invoices */
  hsn?: string
}

export interface InvoicePaymentRow { label: string; value: number; sub?: boolean; accent?: boolean }

export interface InvoiceProps {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  address?: string
  items: InvoiceItem[]
  subtotal: number
  shipping?: number
  deliveryCharge?: number
  discountAmount?: number
  manualDiscountAmount?: number
  gstAmount?: number
  /** Explicit CGST / SGST split; when omitted the GST amount is halved. */
  cgstAmount?: number
  sgstAmount?: number
  couponCode?: string
  total: number
  status?: string
  userId?: string
  paymentMode?: string
  /** 'offline' (counter) or 'online' */
  channel?: string
  /** Cash handed over by the customer (defaults to the total) */
  amountReceived?: number
  /** Extra rows under the total, e.g. advance deposit / balance paid */
  paymentRows?: InvoicePaymentRow[]
  notes?: string
  /** Overrides the "TAX INVOICE" / "INVOICE" heading, e.g. "ADVANCE RECEIPT" */
  documentTitle?: string
  /** Extra header lines under Date / Time, e.g. [['Order', 'ADV-001'], ['Delivery', '25 Oct 2026']] */
  extraMeta?: Array<[string, string]>
  /** Amount spelled out under "Amount in Words" (defaults to the total) */
  wordsAmount?: number
  wordsLabel?: string
  onPrintReceipt?: () => void
}

/** GST state codes → state names for "Place of Supply". */
const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '36': 'Telangana', '37': 'Andhra Pradesh',
}

/** The shop's state code comes from its GSTIN; the shop is in Tamil Nadu (33) by default. */
function shopStateCode(): string {
  const code = (BRAND_GSTIN || '').slice(0, 2)
  return STATE_NAMES[code] ? code : '33'
}

/** Current theme accent as an rgb() colour (inline styles survive printing / PDF capture). */
function invoiceAccent(): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    const parts = raw.split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n))
    if (parts.length >= 3) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`
  } catch { /* not in a browser */ }
  return '#3F3F46'
}

/** "Split (Cash ₹100.00 + QR ₹50.00)" → "SPLIT" for the compact header line. */
const shortMode = (mode?: string) => {
  const m = (mode || '').trim()
  if (!m) return 'CASH'
  if (/^split/i.test(m)) return 'SPLIT'
  if (/^(qr|upi)$/i.test(m)) return 'GPAY'
  return m.toUpperCase()
}

const MONO = "'Consolas', 'SFMono-Regular', 'Menlo', 'Courier New', monospace"
const MUTED = '#9CA3AF'
const SOFT = '#6B7280'
const LINE = '#E5E7EB'
const money = (n: number) => formatCurrency(n).replace(/^₹\s*/, '')

export const Invoice: React.FC<InvoiceProps> = ({
  invoiceNo,
  date,
  customerName,
  phone,
  address,
  items,
  subtotal,
  shipping = 0,
  deliveryCharge = 0,
  discountAmount = 0,
  manualDiscountAmount = 0,
  gstAmount = 0,
  cgstAmount,
  sgstAmount,
  couponCode,
  total,
  status = 'completed',
  userId: _userId,
  paymentMode,
  channel = 'offline',
  amountReceived,
  paymentRows = [],
  notes,
  documentTitle,
  extraMeta = [],
  wordsAmount,
  wordsLabel = 'Amount in Words',
}) => {
  const accent = invoiceAccent()
  // Advance deposits keep their own DEP-… number
  const formattedInvoiceNo = /^DEP-/i.test(invoiceNo) ? invoiceNo : formatInvoiceNo(invoiceNo)
  const when = (() => { const d = new Date(date); return Number.isNaN(d.getTime()) ? new Date() : d })()
  const dateStr = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

  const effectiveDelivery = deliveryCharge || shipping
  const cgst = cgstAmount ?? (gstAmount > 0 ? Math.round((gstAmount / 2) * 100) / 100 : 0)
  const sgst = sgstAmount ?? (gstAmount > 0 ? Math.round((gstAmount - cgst) * 100) / 100 : 0)
  const isGst = cgst + sgst > 0
  const taxable = Math.max(0, subtotal - discountAmount - manualDiscountAmount)
  const halfRate = (part: number) => {
    if (taxable <= 0) return ''
    const pct = Math.round((part / taxable) * 10000) / 100
    return `${pct}%`
  }
  const stateCode = shopStateCode()
  const mode = shortMode(paymentMode)
  const received = amountReceived && amountReceived > 0 ? amountReceived : total

  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 }
  const th: React.CSSProperties = { ...label, padding: '14px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '14px 8px', fontSize: 13, verticalAlign: 'top', borderBottom: '1px solid #F3F4F6' }
  const metaRow = (name: string, value: React.ReactNode) => (
    <div style={{ fontSize: 12.5, lineHeight: 1.75, color: MUTED }}>
      {name}: <span style={{ color: '#111111', fontWeight: 600 }}>{value}</span>
    </div>
  )
  const sumRow = (name: React.ReactNode, value: string, opts: { small?: boolean; muted?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: opts.small ? '5px 0' : '7px 0' }}>
      <span style={{ fontSize: opts.small ? 10.5 : 13, color: opts.small ? MUTED : '#374151', textTransform: opts.small ? 'uppercase' : undefined, letterSpacing: opts.small ? 0.6 : undefined }}>{name}</span>
      <span style={{ fontFamily: MONO, fontSize: opts.small ? 11 : 13, fontWeight: 600, color: opts.muted ? SOFT : '#111111', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )

  return (
    <div
      id="invoice-print-root"
      style={{
        width: '100%',
        maxWidth: 760,
        margin: '0 auto',
        boxSizing: 'border-box',
        background: '#FFFFFF',
        color: '#111111',
        padding: 'clamp(20px, 5vw, 44px)',
        fontFamily: "'Segoe UI', 'Noto Sans', 'Noto Sans Tamil', Arial, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        overflowWrap: 'anywhere',
      }}
    >
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ display: 'flex', gap: 16, minWidth: 0, flex: '1 1 300px' }}>
          <div style={{ width: 64, height: 64, flexShrink: 0, border: `1px solid ${LINE}`, borderRadius: 6, padding: 2, boxSizing: 'border-box', overflow: 'hidden' }}>
            <img src={BRAND_PRINT_LOGO} alt={BRAND_EN} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, display: 'block' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 23, fontWeight: 800, color: accent, lineHeight: 1.15, letterSpacing: 0.3 }}>{BRAND_EN.toUpperCase()}</div>
            {BRAND_ADDRESS && <div style={{ fontSize: 12.5, color: SOFT, lineHeight: 1.65, marginTop: 6, maxWidth: 320 }}>{BRAND_ADDRESS}</div>}
            <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.65, marginTop: 8 }}>
              {BRAND_PRIMARY_PHONE_DISPLAY && <div>Phone: {BRAND_PRIMARY_PHONE_DISPLAY}</div>}
              {BRAND_EMAIL && <div>Email: {BRAND_EMAIL}</div>}
              {isGst && <div style={{ fontWeight: 700, color: '#111111' }}>GSTIN: {BRAND_GSTIN || '–'} • State Code: {stateCode}</div>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: accent, letterSpacing: 0.4 }}>{documentTitle || (isGst ? 'TAX INVOICE' : 'INVOICE')}</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: SOFT, marginTop: 2, marginBottom: 8 }}>#{formattedInvoiceNo}</div>
          {metaRow('Date', dateStr)}
          {metaRow('Time', timeStr.toLowerCase())}
          {extraMeta.map(([name, value]) => <React.Fragment key={name}>{metaRow(name, value)}</React.Fragment>)}
          {metaRow('Payment', `${mode} • ${String(status || 'completed').toUpperCase()}`)}
          {metaRow('Channel', String(channel || 'offline').toUpperCase())}
        </div>
      </div>

      <div style={{ height: 2, background: accent, margin: '22px 0 20px' }} />

      {/* ── BILLED TO / PLACE OF SUPPLY ───────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, paddingBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>Billed To</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 6 }}>{customerName || 'Walk-in Customer'}</div>
          {phone && <div style={{ fontFamily: MONO, fontSize: 12.5, color: '#374151', marginTop: 4 }}>{formatPhoneDisplay(phone)}</div>}
          {address && address !== 'POS Counter' && <div style={{ fontSize: 12, color: SOFT, marginTop: 4, maxWidth: 360, lineHeight: 1.5 }}>{address}</div>}
        </div>
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={label}>Place of Supply</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{STATE_NAMES[stateCode]} ({stateCode})</div>
        </div>
      </div>

      {/* ── ITEMS ─────────────────────────────────────────────── */}
      <div style={{ width: '100%', overflowX: 'auto', borderTop: `1px solid ${LINE}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28, textAlign: 'center' }}>#</th>
              <th style={th}>Item Description</th>
              {isGst && <th style={{ ...th, textAlign: 'center', width: 70 }}>HSN</th>}
              <th style={{ ...th, textAlign: 'center', width: 60 }}>Qty</th>
              <th style={{ ...th, textAlign: 'right', width: 100 }}>
                Rate (₹){isGst && <div style={{ fontSize: 8.5, textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>excl. GST</div>}
              </th>
              <th style={{ ...th, textAlign: 'right', width: 110 }}>
                Amount (₹){isGst && <div style={{ fontSize: 8.5, textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>excl. GST</div>}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const n = normalizeStructuredOrderItem(item as unknown as Record<string, unknown>)
              const tamil = n.tamil_name || item.nameTa
              return (
                <tr key={idx}>
                  <td style={{ ...td, textAlign: 'center', color: MUTED }}>{idx + 1}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{n.name}</div>
                    {tamil && tamil !== n.name && <div style={{ fontSize: 11, color: SOFT, marginTop: 2 }}>{tamil}</div>}
                    {item.offerPrice && item.price !== item.offerPrice && (
                      <div style={{ fontSize: 10.5, color: MUTED, textDecoration: 'line-through', marginTop: 2 }}>MRP {formatCurrency(item.price)}</div>
                    )}
                  </td>
                  {isGst && <td style={{ ...td, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: '#374151' }}>{item.hsn || '–'}</td>}
                  <td style={{ ...td, textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>{n.unit_type === 'unit' ? n.quantity : formatQuantityDisplay(n.quantity, n.unit, n.unit_type)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, color: '#374151' }}>{money(n.base_price)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{money(n.line_total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── WORDS / TOTALS ────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 28, borderTop: `1px solid ${LINE}`, marginTop: 14, paddingTop: 16 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={label}>{wordsLabel}</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontStyle: 'italic', marginTop: 5 }}>{amountInWords(wordsAmount ?? total)}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 22 }}>
            {mode === 'SPLIT' ? 'Paid' : `${({ CASH: 'Cash', GPAY: 'GPay', CARD: 'Card', ONLINE: 'Online' } as Record<string, string>)[mode] || mode} Received`}:{' '}
            <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>{formatCurrency(received)}</span>
          </div>
          {mode === 'SPLIT' && paymentMode && <div style={{ fontSize: 11.5, color: SOFT, marginTop: 4 }}>{paymentMode}</div>}
          {notes && notes.trim() && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Terms &amp; Notes:</div>
              <div style={{ fontSize: 11.5, color: SOFT, marginTop: 5, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{notes.trim()}</div>
            </div>
          )}
        </div>

        <div style={{ flex: '0 1 300px', minWidth: 240, marginLeft: 'auto' }}>
          {sumRow(<>Subtotal{isGst && <span style={{ fontSize: 9, color: MUTED, marginLeft: 5, letterSpacing: 0.5 }}>EXCL. GST</span>}</>, formatCurrency(subtotal))}
          {discountAmount > 0 && sumRow(`Coupon${couponCode ? ` (${couponCode})` : ''}`, `−${formatCurrency(discountAmount)}`)}
          {manualDiscountAmount > 0 && sumRow('Discount', `−${formatCurrency(manualDiscountAmount)}`)}
          {isGst && (
            <>
              <div style={{ borderTop: `1px dashed ${LINE}`, marginTop: 4 }} />
              {sumRow('Taxable Value', formatCurrency(taxable), { small: true, muted: true })}
              {sumRow(`CGST${halfRate(cgst) ? ` (${halfRate(cgst)})` : ''}`, formatCurrency(cgst))}
              {sumRow(`SGST${halfRate(sgst) ? ` (${halfRate(sgst)})` : ''}`, formatCurrency(sgst))}
            </>
          )}
          {effectiveDelivery > 0 && sumRow('Delivery', formatCurrency(effectiveDelivery))}
          <div style={{ height: 2, background: accent, margin: '8px 0 10px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 14.5, fontWeight: 800, color: accent }}>TOTAL</span>
            <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 800, color: accent, whiteSpace: 'nowrap' }}>{formatCurrency(total)}</span>
          </div>
          {paymentRows.length > 0 && (
            <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
              {paymentRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: row.sub ? '3px 0 3px 10px' : '6px 0' }}>
                  <span style={{ fontSize: row.sub ? 11 : 12.5, color: row.sub ? SOFT : '#374151', fontWeight: row.accent ? 700 : 400 }}>{row.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: row.sub ? 11 : 12.5, fontWeight: row.accent ? 800 : 600 }}>{formatCurrency(row.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      <div
        className="invoice-footer"
        style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 36, paddingTop: 22 }}
      >
        <div style={{ fontSize: 12, color: MUTED }}>Thank you for your visit! • {BRAND_EN.toUpperCase()}</div>
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={{ borderTop: '1px solid #9CA3AF', width: 160, marginLeft: 'auto', paddingTop: 6, fontSize: 12.5, fontWeight: 700, color: '#111111' }}>Authorised Signatory</div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>For {BRAND_EN.toUpperCase()}</div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Invoice, type InvoiceProps } from '../components/Invoice'
import PrintSettingsModal from '../components/print/PrintSettingsModal'
import { printBill, thermalPreviewHtml } from '../lib/billPrint'
import { loadPrintSettings, type PrintSettings } from '../lib/printSettings'
import { Printer, ArrowLeft, MessageCircle, Copy, Check, FileDown } from 'lucide-react'
import { invoicePdfFileFromElement } from '../lib/invoicePdf'
import { uploadInvoicePdf } from '../lib/storage'
import { isUuid, normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { buildProfessionalWhatsAppMessage } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'
import { formatPaymentLabel } from '../lib/payments'
import { db, isDatabaseConfigured } from '../lib/db'

function buildLookupCandidates(id: string): string[] {
  const raw = decodeURIComponent(id || '').trim()
  if (!raw) return []

  const candidates = new Set<string>()

  // 1. Stripped prefix (e.g. "INV00000030" -> "00000030") - highest priority because DB stores 8 digits without prefix
  const stripped = raw.replace(/^(INV|UL)[-_ ]*/i, '').trim()
  if (stripped) candidates.add(stripped)

  // 2. Numeric digits padded to 8 digits
  const digits = raw.replace(/\D/g, '')
  if (digits) {
    candidates.add(digits.padStart(8, '0'))
    candidates.add(digits)
    const unpadded = digits.replace(/^0+/, '')
    if (unpadded) candidates.add(unpadded)
  }

  // 3. Raw and uppercase
  candidates.add(raw)
  candidates.add(raw.toUpperCase())

  // 4. Formatted with INV prefix
  candidates.add(formatInvoiceNo(raw))

  return Array.from(candidates).filter(Boolean)
}

export default function DigitalInvoice() {
  const { id } = useParams()
  const navigate = useNavigate()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const invoiceElementRef = useRef<HTMLDivElement>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hsnByProduct, setHsnByProduct] = useState<Record<string, string>>({})
  // After a thermal print the page shows the receipt as it printed
  const [view, setView] = useState<{ mode: 'sheet' | 'thermal'; settings: PrintSettings }>(() => ({ mode: 'sheet', settings: loadPrintSettings() }))

  const handleBack = () => {
    const currentPath = window.location.pathname
    const hasInternalHistory =
      (window.history.state && typeof window.history.state.idx === 'number' && window.history.state.idx > 0) ||
      (Boolean(document.referrer) && document.referrer.startsWith(window.location.origin))

    if (hasInternalHistory && window.history.length > 1) {
      navigate(-1)
      // Fallback in case navigate(-1) had no effect
      setTimeout(() => {
        if (window.location.pathname === currentPath) {
          navigate('/dashboard')
        }
      }, 200)
    } else {
      navigate('/dashboard')
    }
  }

  useEffect(() => {
    async function loadInvoice() {
      if (!isDatabaseConfigured) {
        setError('Database connection not configured')
        setLoading(false)
        return
      }
      try {
        const rawId = decodeURIComponent(id || '').trim()
        if (!rawId) {
          throw new Error('Invoice not found')
        }

        const candidates = buildLookupCandidates(rawId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let row: any = null

        // 1. Try public RPC with candidates in priority order (00000030 tried first)
        for (const candidate of candidates) {
          try {
            const { data, error: rpcErr } = await db.rpc('get_public_invoice_by_number', { p_invoice_no: candidate })
            if (!rpcErr && data) {
              const matched = Array.isArray(data) ? data[0] : data
              if (matched && typeof matched === 'object' && ('id' in matched || 'invoice_no' in matched)) {
                row = matched
                break
              }
            }
          } catch {
            // continue
          }
        }

        // 2. Direct table query fallback on orders table (supports unauthenticated anon query)
        if (!row) {
          try {
            const { data: tableData } = await db
              .from('orders')
              .select('*')
              .in('invoice_no', candidates)
              .limit(1)

            if (tableData && tableData[0]) {
              row = tableData[0]
            }
          } catch {
            // continue
          }
        }

        // 3. Fallback to UUID lookup if rawId is a valid UUID (e.g. opened from dashboard)
        if (!row && isUuid(rawId)) {
          try {
            const { data: idData } = await db
              .from('orders')
              .select('*')
              .eq('id', rawId)
              .maybeSingle()

            if (idData) {
              row = idData
            }
          } catch {
            // continue
          }
        }

        // 4. Fallback to advance_orders table if referenced by deposit_id or invoice_number
        if (!row) {
          try {
            const { data: advData } = await db
              .from('advance_orders')
              .select('*')
              .or(`invoice_number.in.(${candidates.map(c => `"${c}"`).join(',')}),deposit_id.in.(${candidates.map(c => `"${c}"`).join(',')})`)
              .limit(1)

            if (advData && advData[0]) {
              const adv = advData[0]
              const advItems = Array.isArray(adv.products) && adv.products.length > 0
                ? adv.products
                : [{
                    name: adv.product_name || 'Advance Order Item',
                    quantity: 1,
                    unit: 'piece',
                    unit_type: 'unit',
                    base_price: adv.total_amount,
                    line_total: adv.total_amount,
                  }]
              row = {
                id: adv.completed_order_id || adv.id,
                invoice_no: adv.invoice_number || adv.deposit_id,
                customer_name: adv.customer_name,
                phone: adv.phone,
                address: adv.address || '',
                items: advItems,
                total: adv.total_amount,
                subtotal: adv.total_amount,
                delivery_charge: 0,
                discount_amount: 0,
                manual_discount_amount: 0,
                total_gst: 0,
                gst_amount: 0,
                status: adv.status,
                payment_mode: adv.final_payment_method || 'Advance Payment',
                created_at: adv.completed_at || adv.created_at,
              }
            }
          } catch {
            // continue
          }
        }

        if (!row) throw new Error('Invoice not found')

        setInvoice(row)
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Invoice not found')
        }
      } finally {
        setLoading(false)
      }
    }
    if (id) loadInvoice()
  }, [id])

  useEffect(() => {
    const ids = Array.from(new Set(
      (Array.isArray(invoice?.items) ? invoice.items : [])
        .map((item: Record<string, unknown>) => String(item.product_id ?? item.productId ?? '').trim())
        .filter((v: string) => /^\d+$|^[0-9a-f-]{36}$/i.test(v)),
    )) as string[]
    if (!ids.length || !isDatabaseConfigured) return
    let cancelled = false
    void db.from('products').select('id, hsn_code').in('id', ids).then(({ data }) => {
      if (cancelled || !data) return
      const map: Record<string, string> = {}
      ;(data as Array<{ id: unknown; hsn_code?: string | null }>).forEach(row => { if (row.hsn_code) map[String(row.id)] = String(row.hsn_code) })
      setHsnByProduct(map)
    })
    return () => { cancelled = true }
  }, [invoice])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <span className="w-8 h-8 border-4 border-sand border-t-sageDark rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center text-center p-6">
        <h1 className="text-2xl font-bold text-sageDark mb-2">Invoice Not Found</h1>
        <p className="text-gray-500 mb-6">The requested invoice could not be found.</p>
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-6 py-2 bg-sage text-white rounded-full font-bold hover:bg-sageDark transition cursor-pointer"
        >
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    )
  }

  const invoiceItems = (Array.isArray(invoice.items) ? invoice.items : [])
    .map((item: Record<string, unknown>) => normalizeStructuredOrderItem(item))
  const subtotal = invoiceItems.reduce((sum: number, item: ReturnType<typeof normalizeStructuredOrderItem>) => sum + item.line_total, 0)

  const downloadPdf = async () => {
    if (!invoiceElementRef.current || downloadingPdf) return

    // iOS detection: Safari on iOS requires window.open to be called synchronously inside user gesture
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    let pdfWindow: Window | null = null
    if (isIOS) {
      pdfWindow = window.open('about:blank', '_blank')
      if (pdfWindow) {
        try {
          pdfWindow.document.title = `Invoice #${invoice.invoice_no}`
          pdfWindow.document.body.innerHTML = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAFA;color:#111;">
              <div style="text-align:center;padding:20px;">
                <div style="width:36px;height:36px;border:3px solid #F3F4F6;border-top-color: #111111;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px auto;"></div>
                <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
                <h3 style="margin:0 0 6px 0;font-size:17px;font-weight:700;">Generating PDF Invoice...</h3>
                <p style="margin:0;font-size:13px;color:#666;">Please wait a moment</p>
              </div>
            </div>
          `
        } catch { /* ignore cross-origin */ }
      }
    }

    setDownloadingPdf(true)
    try {
      const file = await invoicePdfFileFromElement(invoiceElementRef.current, invoice.invoice_no)
      const url = URL.createObjectURL(file)

      if (isIOS) {
        if (pdfWindow && !pdfWindow.closed) {
          pdfWindow.location.href = url
        } else {
          window.location.href = url
        }
      } else {
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }

      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      console.error('Failed to download invoice PDF:', err)
      if (pdfWindow && !pdfWindow.closed) {
        pdfWindow.close()
      }
    } finally {
      setDownloadingPdf(false)
    }
  }

  const shareViaWhatsApp = () => {
    // Synchronously prepare message to guarantee execution within user click gesture
    const items = invoiceItems.map((item: ReturnType<typeof normalizeStructuredOrderItem>) => ({
      name: item.name,
      qty: item.quantity,
      unit: item.unit,
      unitType: item.unit_type,
      rate: item.base_price,
      lineTotal: item.line_total,
    }))
    const message = buildProfessionalWhatsAppMessage({
      customerName: invoice.customer_name,
      phone: invoice.phone,
      invoiceNumber: invoice.invoice_no,
      invoiceDate: invoice.created_at,
      items,
      subtotal,
      couponDiscount: invoice.discount_amount,
      manualDiscountAmount: invoice.manual_discount_amount,
      shipping: invoice.delivery_charge,
      gstAmount: invoice.total_gst || invoice.gst_amount || 0,
      total: invoice.total,
      paymentMode: formatPaymentLabel(invoice.payment_mode || invoice.payment_method, invoice.split_details) || invoice.payment_mode || invoice.payment_method,
    })

    const invoiceUrl = window.location.href
    const pdfUrl = invoice.pdf_url || invoice.invoice_pdf_url
    const linkSection = pdfUrl
      ? `\n\n📄 View Invoice: ${invoiceUrl}\n📥 Download PDF: ${pdfUrl}`
      : `\n\n📄 View Invoice: ${invoiceUrl}`

    const whatsappMessage = `${message}${linkSection}`
    const waUrl = toWhatsAppUrl(invoice.phone, whatsappMessage)

    // Open WhatsApp synchronously in user click gesture to avoid iOS Safari popup blocking
    const isMobile =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    if (isMobile) {
      window.location.href = waUrl
    } else {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
    }

    // Proactively upload invoice PDF in background if needed
    if (!pdfUrl && invoiceElementRef.current) {
      void (async () => {
        try {
          const file = await invoicePdfFileFromElement(invoiceElementRef.current!, invoice.invoice_no)
          await uploadInvoicePdf(file, invoice.invoice_no)
        } catch { /* best-effort background upload */ }
      })()
    }
  }

  const gstAmount = invoice.total_gst || invoice.gst_amount || 0
  const billProps: InvoiceProps = {
    invoiceNo: invoice.invoice_no,
    date: invoice.billing_date || invoice.created_at,
    customerName: invoice.customer_name,
    phone: invoice.phone,
    address: invoice.address,
    items: (invoice.items || []).map((item: Record<string, unknown>) => ({
      ...item,
      hsn: hsnByProduct[String(item.product_id ?? item.productId ?? '')] || undefined,
    })),
    subtotal,
    shipping: invoice.delivery_charge || 0,
    discountAmount: invoice.discount_amount || 0,
    manualDiscountAmount: invoice.manual_discount_amount || 0,
    gstAmount,
    couponCode: invoice.coupon_code,
    total: invoice.total > 0 ? invoice.total : (subtotal + (invoice.delivery_charge || 0) + gstAmount - (invoice.discount_amount || 0) - (invoice.manual_discount_amount || 0)),
    status: invoice.status,
    paymentMode: formatPaymentLabel(invoice.payment_mode || invoice.payment_method, invoice.split_details) || invoice.payment_mode || invoice.payment_method,
    channel: invoice.order_mode || 'offline',
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }

  const barBtn = 'inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 sm:px-4 text-[13px] font-semibold text-[#111111] shadow-sm transition-colors hover:bg-gray-50 active:scale-95 cursor-pointer disabled:opacity-60'

  return (
    <div className="digital-invoice-page min-h-[100dvh] bg-[#F7F7F7] font-sans print:bg-white print:overflow-visible print:m-0 print:p-0">
      <div className="mx-auto w-full max-w-[860px] px-2 pb-12 pt-3 sm:px-4 sm:pt-6 print:p-0 print:max-w-full">
        {/* Action bar */}
        <div className="sticky top-2 z-40 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur print:hidden">
          <button onClick={handleBack} className={barBtn}>
            <ArrowLeft size={16} /> <span className="hidden sm:inline">Return to POS</span><span className="sm:hidden">Back</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={shareViaWhatsApp} className={barBtn}>
              <MessageCircle size={16} /> <span className="hidden sm:inline">Share WhatsApp</span><span className="sm:hidden">WhatsApp</span>
            </button>
            <button onClick={() => void copyLink()} className={barBtn}>
              {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />} <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy Link'}</span>
            </button>
            <button onClick={downloadPdf} disabled={downloadingPdf} className={barBtn} title="Download PDF">
              <FileDown size={16} /> <span className="hidden sm:inline">{downloadingPdf ? 'Generating…' : 'PDF'}</span>
            </button>
            <button onClick={() => setPrintOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#111111] px-4 text-[13px] font-bold text-white shadow-sm hover:bg-black active:scale-95 cursor-pointer">
              <Printer size={16} /> Print
            </button>
          </div>
        </div>

        {view.mode === 'thermal' && (
          <div className="mb-3 flex justify-center gap-2 print:hidden">
            <button onClick={() => setView(v => ({ ...v, mode: 'sheet' }))} className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50">
              Show full invoice
            </button>
          </div>
        )}

        {view.mode === 'thermal' ? (
          <div className="flex justify-center print:hidden">
            <iframe
              title="Thermal receipt preview"
              srcDoc={thermalPreviewHtml(billProps, view.settings)}
              className="border-0 bg-white shadow-sm"
              style={{ width: view.settings.thermalWidth === '58' ? 240 : 320, minHeight: 420 }}
              onLoad={(e) => {
                const frame = e.currentTarget
                const h = frame.contentDocument?.documentElement.scrollHeight
                if (h) frame.style.height = `${h + 4}px`
              }}
            />
          </div>
        ) : null}

        {/* The A4 invoice stays mounted (also used for the PDF download) */}
        <div className={view.mode === 'thermal' ? 'fixed -left-[10000px] top-0 w-[760px]' : ''} aria-hidden={view.mode === 'thermal' || undefined}>
          <div ref={invoiceElementRef} className="rounded-lg border border-gray-200 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
            <Invoice {...billProps} />
          </div>
        </div>
      </div>

      <PrintSettingsModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        onPrint={(settings) => {
          setView({ mode: settings.printer === 'thermal' ? 'thermal' : 'sheet', settings })
          printBill(billProps, settings)
        }}
      />
    </div>
  )
}

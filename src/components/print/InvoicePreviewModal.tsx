import { useEffect, type ReactNode } from 'react'
import { ExternalLink, Printer, X } from 'lucide-react'
import { Invoice, type InvoiceProps } from '../Invoice'
import { formatInvoiceNo } from '../../lib/retail'

type Props = {
  invoice: InvoiceProps
  onClose: () => void
  /** Link to the shareable full-page invoice */
  fullPageUrl?: string
  /** Extra header buttons (e.g. Print / Download) */
  actions?: ReactNode
}

/** Dark-header modal showing the A4 invoice exactly as it prints. */
export default function InvoicePreviewModal({ invoice, onClose, fullPageUrl, actions }: Props) {
  const number = /^DEP-/i.test(invoice.invoiceNo) ? invoice.invoiceNo : formatInvoiceNo(invoice.invoiceNo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 p-3 sm:p-6 print:hidden"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label={`Invoice ${number}`} className="flex max-h-full w-full max-w-[900px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#1F1F1F] px-4 py-3.5 text-white sm:px-6">
          <h2 className="flex min-w-0 items-center gap-2.5 text-[12px] font-black uppercase tracking-[0.1em] sm:text-sm">
            <Printer size={17} className="shrink-0" />
            <span className="truncate">Invoice Preview • #{number}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {fullPageUrl && (
              <a
                href={fullPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-bold text-white hover:bg-white/20"
              >
                Open Full Page <ExternalLink size={13} />
              </a>
            )}
            <button type="button" onClick={onClose} aria-label="Close invoice preview" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F3F4F6] p-3 sm:p-6">
          <div className="mx-auto max-w-[760px] rounded-lg border border-gray-200 bg-white shadow-sm">
            <Invoice {...invoice} />
          </div>
        </div>
      </div>
    </div>
  )
}

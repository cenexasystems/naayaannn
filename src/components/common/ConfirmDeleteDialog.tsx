import { useEffect, useRef, useState } from 'react'
import { useConfirmDeleteStore, type ConfirmDeleteOptions, type ImpactTone } from '../../lib/confirmDelete'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'

const toneClass: Record<ImpactTone, string> = {
  default: 'text-[#111111]',
  danger: 'text-[#DC2626]',
  success: 'text-[#047857]',
  warning: 'text-[#B45309]',
}

/** Mount once near the app root. */
export function ConfirmDeleteHost() {
  const { options, close, requestId } = useConfirmDeleteStore()
  if (!options) return null
  // Remounted for every request so the typed text always starts empty
  return <ConfirmDeleteDialog key={requestId} options={options} close={close} />
}

function ConfirmDeleteDialog({ options, close }: { options: ConfirmDeleteOptions; close: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const word = options.confirmText || 'DELETE'
  const ready = typed.trim().toUpperCase() === word

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [close])


  return (
    createPortal(<div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4 print:hidden"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false) }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="w-full max-w-[560px] max-h-[92dvh] overflow-y-auto rounded-xl bg-white shadow-[0_30px_70px_-15px_rgba(0,0,0,0.45)]"
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-gray-200 px-4 py-3.5">
          <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-[#DC2626]">
            <Trash2 size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-delete-title" className="text-base font-black leading-snug text-[#111111] break-words">{options.title}</h2>
            {options.subtitle && <p className="mt-0.5 text-[13px] font-semibold text-gray-500 break-words">{options.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => close(false)}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#111111]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 px-4 py-3.5">
          {/* Warning */}
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[11px] font-semibold leading-relaxed text-[#92400E]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#D97706]" />
            <p>{options.warning}</p>
          </div>

          {/* Impact summary */}
          {options.impact && options.impact.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-[#FAFAFA] px-4 py-4">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-gray-400">Deletion impact summary</p>
              <dl className="space-y-2.5">
                {options.impact.map((row) => (
                  <div key={row.label} className="grid grid-cols-[minmax(110px,40%)_1fr] gap-3 text-[13.5px]">
                    <dt className="font-medium text-gray-600">{row.label}</dt>
                    <dd className={`text-right font-black break-words ${toneClass[row.tone || 'default']}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Type to confirm */}
          <div>
            <label htmlFor="confirm-delete-input" className="mb-2 block text-[13.5px] font-bold text-[#111111]">
              Type <span className="font-black text-[#DC2626]">{word}</span> to confirm:
            </label>
            <input
              id="confirm-delete-input"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready) close(true) }}
              placeholder={word}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-4 text-[14px] font-bold uppercase tracking-wider text-[#111111] placeholder:text-gray-300 focus:border-[#DC2626] focus:outline-none focus:ring-2 focus:ring-red-100"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 rounded-b-[22px] border-t border-gray-100 bg-[#FAFAFA] px-6 py-4">
          <button
            type="button"
            onClick={() => close(false)}
            className="h-9 rounded-xl px-5 text-[14px] font-bold text-[#374151] hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => close(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#DC2626] px-5 text-[14px] font-black text-white shadow-sm transition hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:bg-[#F3A9A9] disabled:shadow-none"
          >
            <Trash2 size={16} /> {options.confirmLabel || 'Permanently Delete'}
          </button>
        </div>
      </div>
    </div>, document.body)
  )
}

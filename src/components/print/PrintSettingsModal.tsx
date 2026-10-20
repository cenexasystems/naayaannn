import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { loadPrintSettings, savePrintSettings, type PrintSettings } from '../../lib/printSettings'

type Props = {
  open: boolean
  onClose: () => void
  /** Called with the chosen settings (already remembered for next time). */
  onPrint: (settings: PrintSettings) => void
}

/** Thermal roll (58 / 80 mm) or sheet (A4 / A5) picker shown before every print. */
export default function PrintSettingsModal({ open, onClose, onPrint }: Props) {
  if (!open) return null
  return <PrintSettingsDialog onClose={onClose} onPrint={onPrint} />
}

function PrintSettingsDialog({ onClose, onPrint }: Omit<Props, 'open'>) {
  const [settings, setSettings] = useState<PrintSettings>(() => loadPrintSettings())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const option = (active: boolean, text: string, onClick: () => void) => (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`h-12 rounded-xl border-2 text-sm font-bold transition-colors ${
        active ? 'border-primary bg-primary-50 text-primary' : 'border-gray-200 bg-white text-[#4B5563] hover:bg-gray-50'
      }`}
    >
      {text}
    </button>
  )

  const heading = 'mb-3 text-[11px] font-black uppercase tracking-[0.12em] text-[#111111]'
  const thermal = settings.printer === 'thermal'

  return createPortal(
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black/60 p-4 print:hidden"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="print-settings-title" className="w-full max-w-[460px] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1F1F1F] px-6 py-4 text-white">
          <h2 id="print-settings-title" className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.12em]">
            <Printer size={18} /> Print Settings
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div>
            <p className={heading}>Printer Type</p>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Printer type">
              {option(thermal, 'Thermal Roll', () => setSettings(s => ({ ...s, printer: 'thermal' })))}
              {option(!thermal, 'Sheet (A4/A5)', () => setSettings(s => ({ ...s, printer: 'sheet' })))}
            </div>
          </div>
          <div>
            <p className={heading}>Paper Size</p>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Paper size">
              {thermal ? (
                <>
                  {option(settings.thermalWidth === '58', '58 mm', () => setSettings(s => ({ ...s, thermalWidth: '58' })))}
                  {option(settings.thermalWidth === '80', '80 mm', () => setSettings(s => ({ ...s, thermalWidth: '80' })))}
                </>
              ) : (
                <>
                  {option(settings.sheetSize === 'A4', 'A4 Sheet', () => setSettings(s => ({ ...s, sheetSize: 'A4' })))}
                  {option(settings.sheetSize === 'A5', 'A5 Sheet', () => setSettings(s => ({ ...s, sheetSize: 'A5' })))}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-[#FAFAFA] px-6 py-4">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-5 text-sm font-black uppercase tracking-wider text-[#4B5563] hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { savePrintSettings(settings); onPrint(settings); onClose() }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-black uppercase tracking-wider text-primary-ink shadow-md hover:bg-primary-hover"
          >
            <Printer size={17} /> Print Now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

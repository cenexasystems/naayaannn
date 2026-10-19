import { useState } from 'react'
import { Check } from 'lucide-react'
import { parseSplit, round2, splitTotal, type SplitInputValue } from '../../lib/payments'

type Props = {
  idPrefix: string
  total: number
  value: SplitInputValue
  onChange: (next: SplitInputValue) => void
  /**
   * Counter sales: the customer may hand over more cash than needed, so show
   * "Total received / Change to return" instead of requiring an exact match.
   */
  allowChange?: boolean
}

type Channel = keyof SplitInputValue

const formatInr = (n: number) => `₹${round2(n).toFixed(2)}`

const CHANNELS: Array<{ key: Channel; chip: string; field: string }> = [
  { key: 'cash', chip: 'Cash', field: 'Cash (₹)' },
  { key: 'qr', chip: 'QR / GPay', field: 'QR / GPay (₹)' },
  { key: 'card', chip: 'Card', field: 'Card (₹)' },
]

/** Channels already holding an amount, topped up to at least two (Cash + QR / GPay by default). */
function initialChannels(value: SplitInputValue): Channel[] {
  const filled = CHANNELS.map(c => c.key).filter(k => Number(value[k]) > 0)
  if (filled.length >= 2) return filled
  const defaults: Channel[] = ['cash', 'qr', 'card']
  return [...filled, ...defaults.filter(k => !filled.includes(k))].slice(0, 2)
}

/** Split a bill across any 2 or 3 of Cash / QR-GPay / Card. */
export default function SplitPaymentInputs({ idPrefix, total, value, onChange, allowChange = false }: Props) {
  const [selected, setSelected] = useState<Channel[]>(() => initialChannels(value))
  const entered = splitTotal(parseSplit(value))
  const remaining = round2(total - entered)
  const matched = Math.abs(remaining) < 0.01 && total > 0
  const change = allowChange && remaining < 0 ? -remaining : 0

  const toggle = (key: Channel) => {
    if (selected.includes(key)) {
      if (selected.length <= 2) return // a split needs at least two methods
      setSelected(selected.filter(k => k !== key))
      onChange({ ...value, [key]: '' })
    } else {
      setSelected(CHANNELS.map(c => c.key).filter(k => k === key || selected.includes(k)))
    }
  }

  const visible = CHANNELS.filter(c => selected.includes(c.key))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#111111]">Split between (pick 2 or 3)</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Split between">
        {CHANNELS.map(c => {
          const on = selected.includes(c.key)
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.key)}
              title={on && selected.length <= 2 ? 'A split needs at least two methods' : undefined}
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                on ? 'border-primary bg-primary-50 text-primary' : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-[#374151]'
              }`}
            >
              {on && <Check size={13} strokeWidth={2.5} />} {c.chip}
            </button>
          )
        })}
      </div>

      <div className={`mt-3 grid gap-3 ${visible.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {visible.map(c => (
          <label key={c.key} htmlFor={`${idPrefix}-${c.key}`} className="block min-w-0">
            <span className="mb-1.5 block text-[11px] font-bold text-[#111111]">{c.field}</span>
            <input
              id={`${idPrefix}-${c.key}`}
              name={`${idPrefix}-${c.key}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              value={value[c.key]}
              onChange={e => onChange({ ...value, [c.key]: e.target.value })}
              placeholder="0.00"
              className="h-12 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-base font-black text-[#111111] placeholder:text-[#111111]/70 focus:border-primary focus:outline-none"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
        <div className="flex items-center justify-between text-[12px] font-black uppercase tracking-wider text-[#111111]">
          <span>Total received</span>
          <span className="text-primary">{formatInr(entered)}</span>
        </div>
        {allowChange ? (
          <div className="flex items-center justify-between text-[12px] font-black uppercase tracking-wider text-[#111111]">
            <span>{remaining > 0.009 ? 'Still due' : 'Change to return'}</span>
            <span className={remaining > 0.009 ? 'text-red-600' : 'text-emerald-600'}>{formatInr(remaining > 0.009 ? remaining : change)}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[12px] font-black uppercase tracking-wider text-[#111111]">
            <span>{matched ? 'Matched' : remaining < 0 ? 'Over by' : 'Remaining'}</span>
            <span className={matched ? 'text-emerald-600' : remaining < 0 ? 'text-red-600' : 'text-[#111111]'}>
              {matched ? '✓' : formatInr(Math.abs(remaining))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

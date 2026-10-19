import { useState } from 'react'
import { parseSplit, round2, splitTotal, type SplitInputValue } from '../../lib/payments'

type Props = {
  idPrefix: string
  total: number
  value: SplitInputValue
  onChange: (next: SplitInputValue) => void
}

type Channel = keyof SplitInputValue

const formatInr = (n: number) => `₹${round2(n).toFixed(2)}`

const CHANNEL_LABEL: Record<Channel, string> = { cash: 'Cash', qr: 'GPay', card: 'Card' }

/** The two channels a bill is split across. Order doesn't matter: Card + Cash is the same split as Cash + Card. */
const PAIRS: Array<[Channel, Channel]> = [
  ['cash', 'qr'],
  ['cash', 'card'],
  ['qr', 'card'],
]

/** Picks the pair matching whatever amounts are already entered (defaults to Cash + GPay). */
function initialPair(value: SplitInputValue): number {
  const filled = (Object.keys(CHANNEL_LABEL) as Channel[]).filter(k => Number(value[k]) > 0)
  const idx = PAIRS.findIndex(pair => filled.every(k => pair.includes(k)))
  return idx >= 0 ? idx : 0
}

/** Two-channel amount entry (any two of Cash / GPay / Card) that must add up to `total`. */
export default function SplitPaymentInputs({ idPrefix, total, value, onChange }: Props) {
  const [pairIdx, setPairIdx] = useState(() => initialPair(value))
  const pair = PAIRS[pairIdx]
  const entered = splitTotal(parseSplit(value))
  const remaining = round2(total - entered)
  const matched = Math.abs(remaining) < 0.01 && total > 0

  const choosePair = (idx: number) => {
    setPairIdx(idx)
    // Clear the channel that is no longer part of the split so it can't sneak into the total
    const next = { ...value }
    ;(Object.keys(CHANNEL_LABEL) as Channel[]).forEach(k => { if (!PAIRS[idx].includes(k)) next[k] = '' })
    onChange(next)
  }

  return (
    <div className="rounded-xl border border-[#F3F4F6] bg-white p-2.5">
      <div className="mb-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Split between">
        {PAIRS.map(([a, b], idx) => (
          <button
            key={`${a}-${b}`}
            type="button"
            role="radio"
            aria-checked={pairIdx === idx}
            onClick={() => choosePair(idx)}
            className={`h-8 rounded-lg border px-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
              pairIdx === idx ? 'border-primary bg-primary text-primary-ink' : 'border-gray-200 bg-white text-[#374151] hover:bg-gray-50'
            }`}
          >
            {CHANNEL_LABEL[a]} + {CHANNEL_LABEL[b]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {pair.map(key => (
          <label key={key} htmlFor={`${idPrefix}-${key}`} className="block">
            <span className="mb-0.5 block text-[10px] font-black uppercase tracking-wider text-[#374151]">{CHANNEL_LABEL[key]} (₹)</span>
            <input
              id={`${idPrefix}-${key}`}
              name={`${idPrefix}-${key}`}
              type="number"
              min="0"
              step="0.01"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              value={value[key]}
              onChange={e => onChange({ ...value, [key]: e.target.value })}
              placeholder="0.00"
              className="h-9 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-2 text-[13px] font-black text-[#111111] focus:border-[#111111] focus:bg-white focus:outline-none"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border border-[#F3F4F6] bg-[#F9FAFB] px-3 py-1.5 text-[11px] font-bold">
        <span className="text-[#374151]">Entered {formatInr(entered)} of {formatInr(total)}</span>
        <span className={matched ? 'text-emerald-700' : remaining < 0 ? 'text-red-600' : 'text-[#111111]'}>
          {matched ? 'Matched ✓' : remaining < 0 ? `Over by ${formatInr(-remaining)}` : `Remaining ${formatInr(remaining)}`}
        </span>
      </div>
    </div>
  )
}

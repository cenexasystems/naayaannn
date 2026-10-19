import { parseSplit, round2, splitTotal, type SplitInputValue } from '../../lib/payments'

type Props = {
  idPrefix: string
  total: number
  value: SplitInputValue
  onChange: (next: SplitInputValue) => void
}

const formatInr = (n: number) => `₹${round2(n).toFixed(2)}`

/** Cash / QR amount entry that must add up to `total`. */
export default function SplitPaymentInputs({ idPrefix, total, value, onChange }: Props) {
  const entered = splitTotal(parseSplit(value))
  const remaining = round2(total - entered)
  const matched = Math.abs(remaining) < 0.01 && total > 0
  const fields: Array<{ key: keyof SplitInputValue; label: string }> = [
    { key: 'cash', label: 'Cash' },
    { key: 'qr', label: 'QR' },
  ]

  return (
    <div className="rounded-xl border border-[#F3F4F6] bg-white p-2.5">
      <div className="grid grid-cols-2 gap-2">
        {fields.map(field => (
          <label key={field.key} htmlFor={`${idPrefix}-${field.key}`} className="block">
            <span className="mb-0.5 block text-[10px] font-black uppercase tracking-wider text-[#374151]">{field.label} (₹)</span>
            <input
              id={`${idPrefix}-${field.key}`}
              name={`${idPrefix}-${field.key}`}
              type="number"
              min="0"
              step="0.01"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              value={value[field.key]}
              onChange={e => onChange({ ...value, [field.key]: e.target.value })}
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

import { useEffect, useState } from 'react'
import { Tag } from 'lucide-react'
import { formatCurrency } from '../../lib/retail'

type Mode = 'percent' | 'amount' | 'price'

type Props = {
  /** Actual selling price (MRP) */
  price: number
  /** Discounted price the customer pays ('' = no offer) */
  offerPrice: string
  onChange: (offerPrice: string) => void
  inputClassName: string
  labelClassName: string
  idPrefix: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const clean = (n: number) => String(round2(n))

/** Offer as a % off, a ₹ amount off or a final price — all three stay in step — plus what the customer pays. */
export default function OfferFields({ price, offerPrice, onChange, inputClassName, labelClassName, idPrefix }: Props) {
  // The field being typed in keeps the user's text; the other two are derived from the offer price
  const [editing, setEditing] = useState<{ mode: Mode; text: string } | null>(null)
  const op = Number(offerPrice)
  const valid = price > 0 && op > 0 && op < price
  const off = valid ? round2(price - op) : 0
  const pct = valid ? round2((off / price) * 100) : 0

  const derive = (mode: Mode, text: string): string => {
    const v = Number(text)
    if (!text.trim() || !(v > 0) || !(price > 0)) return ''
    if (mode === 'percent') return v < 100 ? clean(price * (1 - v / 100)) : ''
    if (mode === 'amount') return v < price ? clean(price - v) : ''
    return text
  }

  // Price changed while a % or ₹ offer was entered: keep that offer and recompute what the customer pays
  useEffect(() => {
    if (editing && editing.mode !== 'price') onChange(derive(editing.mode, editing.text))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price])

  const value = (mode: Mode) => {
    if (editing?.mode === mode) return editing.text
    if (!valid) return mode === 'price' ? offerPrice : ''
    return mode === 'percent' ? String(pct) : mode === 'amount' ? String(off) : offerPrice
  }
  const handle = (mode: Mode) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditing({ mode, text: e.target.value })
    onChange(derive(mode, e.target.value))
  }

  const fields: Array<[Mode, string, string]> = [
    ['percent', 'Offer (%)', 'e.g. 10'],
    ['amount', 'Offer amount (₹ off)', 'e.g. 100'],
    ['price', 'Customer pays (₹)', 'Offer price'],
  ]

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <p className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800">
        <Tag size={16} strokeWidth={1.75} /> Product special offer (automatic on billing)
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {fields.map(([mode, text, placeholder]) => (
          <label key={mode} htmlFor={`${idPrefix}-${mode}`} className="block">
            <span className={labelClassName}>{text}</span>
            <input
              id={`${idPrefix}-${mode}`}
              className={`${inputClassName} !border-amber-200`}
              value={value(mode)}
              onChange={handle(mode)}
              onBlur={() => setEditing(e => (e?.mode === 'price' ? null : e))}
              inputMode="decimal"
              placeholder={placeholder}
            />
          </label>
        ))}
      </div>

      {valid ? (
        <div className="mt-4 grid grid-cols-3 divide-x divide-amber-200 rounded-xl border border-amber-200 bg-white text-center">
          <div className="px-2 py-2.5">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500">Actual rate</p>
            <p className="text-sm font-black text-gray-500 line-through tabular-nums">{formatCurrency(price)}</p>
          </div>
          <div className="px-2 py-2.5">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500">Offer</p>
            <p className="text-sm font-black text-amber-700 tabular-nums">{pct}% · −{formatCurrency(off)}</p>
          </div>
          <div className="px-2 py-2.5">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500">Customer pays</p>
            <p className="text-sm font-black text-emerald-700 tabular-nums">{formatCurrency(op)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] font-medium text-amber-800">
          Enter a % off, an amount off or the final price. The bill and invoice show the actual rate, the offer and the amount to pay.
        </p>
      )}
    </div>
  )
}

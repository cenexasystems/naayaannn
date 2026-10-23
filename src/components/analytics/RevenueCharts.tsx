import type { ReactNode } from 'react'
import { formatCurrency } from '../../lib/retail'

const card = 'rounded-[22px] border border-gray-200 bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]'

/** ₹24.8k style label above a bar */
const compact = (n: number) => (Math.abs(n) >= 1000 ? `₹${(Math.round(n / 100) / 10).toString()}k` : `₹${Math.round(n)}`)

export function YearTrendCard({ year, months }: {
  year: number | string
  months: Array<{ month: string; revenue: number }>
}) {
  const total = months.reduce((s, m) => s + (Number(m.revenue) || 0), 0)
  const max = Math.max(1, ...months.map(m => Number(m.revenue) || 0))
  const avgPerMonth = total / Math.max(1, months.length)
  const BAR_AREA = 150
  return (
    <div className={card}>
      <h3 className="text-[16px] font-semibold text-[#111111]">
        Revenue Trend This Year <span className="ml-1 font-bold text-primary">{year}</span>
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-[26px] font-black leading-none tracking-tight text-[#111111]">{formatCurrency(total)}</p>
        <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-[#111111]">Avg {formatCurrency(Math.round(avgPerMonth * 100) / 100)}/mo</span>
      </div>
      <div className="mt-6 grid items-end gap-1 sm:gap-2" style={{ gridTemplateColumns: `repeat(${months.length || 12}, minmax(0, 1fr))` }}>
        {months.map((m) => {
          const v = Number(m.revenue) || 0
          const h = v > 0 ? Math.max(8, Math.round((v / max) * BAR_AREA)) : 5
          return (
            <div key={m.month} className="flex min-w-0 flex-col items-center justify-end">
              <div className="flex w-full flex-col items-center justify-end" style={{ height: BAR_AREA + 18 }}>
                {v > 0 && <span className="mb-1 whitespace-nowrap text-[9px] font-bold text-primary">{compact(v)}</span>}
                <div
                  className="w-full max-w-[30px] rounded-t-md bg-primary"
                  style={{ height: h }}
                  title={`${m.month}: ${formatCurrency(v)}`}
                />
              </div>
              <span className="mt-3 text-[10px] font-bold uppercase tracking-wide text-[#111111]">{m.month}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OrderSourceCard({ offline, online }: { offline: number; online: number }) {
  const max = Math.max(1, offline, online)
  const row = (label: string, count: number, labelClass: string, barClass: string) => (
    <div className="flex items-center gap-4">
      <span className={`w-16 shrink-0 text-[11px] font-bold uppercase tracking-wide ${labelClass}`}>{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#F3F4F6]">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.round((count / max) * 100)}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-[12px] font-black text-[#111111]">{count}</span>
    </div>
  )
  return (
    <div className={card}>
      <h3 className="text-[16px] font-semibold text-[#111111]">Order Source</h3>
      <div className="mt-5 space-y-4">
        {row('Offline', offline, 'text-[#111111]', 'bg-primary')}
        {row('Online', online, 'text-emerald-600', 'bg-emerald-500')}
      </div>
    </div>
  )
}

export function TopItemsCard({ title, items, extra }: {
  title: string
  items: Array<{ name: string; revenue: number; qty: number }>
  extra?: ReactNode
}) {
  items = [...items].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0)).slice(0, 5)
  const max = Math.max(1, ...items.map(i => Number(i.revenue) || 0))
  return (
    <div className={card}>
      <h3 className="text-[16px] font-semibold text-[#111111]">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-5 text-[13px] font-medium text-gray-400">No sales yet.</p>
      ) : (
        <ol className="mt-5 space-y-4">
          {items.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-start gap-3">
              <span className="mt-[2px] w-3 shrink-0 text-[12px] font-bold text-[#111111]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-[13px] font-semibold leading-snug text-[#111111]">{p.name}</span>
                  <span className="shrink-0 text-[13px] font-bold text-[#111111]">{formatCurrency(p.revenue)}</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round(((Number(p.revenue) || 0) / max) * 100))}%` }} />
                </div>
              </div>
              <span className="mt-[2px] w-11 shrink-0 text-right text-[11px] font-medium text-gray-500">{Math.round(p.qty)} pcs</span>
            </li>
          ))}
        </ol>
      )}
      {extra}
    </div>
  )
}

export function WeekTrendCard({ weekLabel, days, todayIndex }: {
  weekLabel: string
  days: Array<{ day: string; date?: string; revenue: number }>
  todayIndex?: number
}) {
  const total = days.reduce((s, d) => s + (Number(d.revenue) || 0), 0)
  const max = Math.max(1, ...days.map(d => Number(d.revenue) || 0))
  const TRACK = 160
  return (
    <div className={card}>
      <h3 className="text-[16px] font-semibold text-[#111111]">
        Revenue This Week <span className="ml-1 font-bold text-primary">({weekLabel})</span>
      </h3>
      <p className="mt-1 text-[11px] font-medium text-[#111111]">{formatCurrency(total)} total</p>
      <div className="mt-6 grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const v = Number(d.revenue) || 0
          const fill = v > 0 ? Math.max(20, Math.round((v / max) * TRACK)) : 0
          const isMax = v > 0 && v === max
          return (
            <div key={d.day} className="flex min-w-0 flex-col items-center">
              <span className="mb-1.5 h-3 whitespace-nowrap text-[9px] font-bold text-primary">{v > 0 ? compact(v) : ''}</span>
              <div className="relative w-[26px] overflow-hidden rounded-full bg-[#F3F4F6]" style={{ height: TRACK }} title={`${d.day}${d.date ? ` - ${d.date}` : ''}: ${formatCurrency(v)}`}>
                {fill > 0 && (
                  <div
                    className={`absolute inset-x-0 bottom-0 rounded-full ${isMax ? 'bg-primary' : 'bg-primary/60'}`}
                    style={{ height: fill }}
                  />
                )}
              </div>
              <span className={`mt-3 text-[11px] font-bold uppercase tracking-wide ${todayIndex === i ? 'text-primary' : 'text-[#111111]'}`}>{d.day}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Gift, Cake, Trash2, Plus, Pencil, Save, MessageCircle, Download } from 'lucide-react'
import {
  birthdayService, buildBirthdayMessage, birthdayInWindow, birthMonthDay, formatBirthDate, rangeToDates, toMonthDay,
  type BirthdayOffer, type BirthdayRange, type CustomerBirthday,
} from '../../services/birthdayService'
import { toWhatsAppUrl, formatPhoneDisplay } from '../../lib/phone'
import { downloadCsv } from '../../lib/exportCsv'
import { confirmDelete } from '../../lib/confirmDelete'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Feb includes the 29th
const pad2 = (n: number) => String(n).padStart(2, '0')
const RANGES: Array<{ key: BirthdayRange; label: string }> = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All' },
]
const card = 'bg-white rounded-2xl border border-gray-200 shadow-sm'
const input = 'w-full h-10 px-3 bg-white border border-gray-200 rounded-xl text-[13px] font-bold text-[#111111] focus:outline-none focus:border-primary-soft'

const MonthDayPicker: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  const [m, d] = value ? value.split('-').map(Number) : [0, 0]
  const sel = 'h-10 pl-3 pr-1 bg-white border border-gray-200 rounded-xl text-[13px] font-bold text-[#111111] focus:outline-none focus:border-primary-soft min-w-0'
  const setMonthPart = (nm: number) => {
    if (!nm) return onChange('')
    onChange(`${pad2(nm)}-${pad2(Math.min(d || 1, DAYS_IN_MONTH[nm - 1]))}`)
  }
  const setDayPart = (nd: number) => onChange(`${pad2(m || 1)}-${pad2(nd)}`)
  return (
    <div>
      <span className="block text-[10px] font-black text-[#6B7280] mb-1">{label}</span>
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <select aria-label={`${label} month`} className={sel} value={m} onChange={e => setMonthPart(Number(e.target.value))}>
          <option value={0}>Month</option>
          {MONTHS_LONG.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <select aria-label={`${label} day`} className={sel} value={d} disabled={!m} onChange={e => setDayPart(Number(e.target.value))}>
          <option value={0}>Day</option>
          {Array.from({ length: m ? DAYS_IN_MONTH[m - 1] : 0 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
      </div>
    </div>
  )
}

const DateFilter: React.FC<{
  range: BirthdayRange; from: string; to: string
  onRange: (r: BirthdayRange) => void; onFrom: (v: string) => void; onTo: (v: string) => void
}> = ({ range, from, to, onRange, onFrom, onTo }) => (
  <>
    <div className="flex flex-wrap gap-1.5 mb-3">
      {RANGES.map(r => (
        <button key={r.key} type="button" onClick={() => onRange(r.key)}
          className={`px-3 py-1 rounded-lg text-[11px] font-black ${range === r.key ? 'bg-primary text-primary-100' : 'bg-gray-100 text-[#374151] hover:bg-gray-200'}`}>
          {r.label}
        </button>
      ))}
    </div>
    <div className="grid grid-cols-1 gap-3">
      <MonthDayPicker label="FROM" value={from} onChange={onFrom} />
      <MonthDayPicker label="TO" value={to} onChange={onTo} />
    </div>
  </>
)

const PeopleList: React.FC<{
  people: CustomerBirthday[]; loading: boolean
  onSend: (p: CustomerBirthday) => void; onDelete: (p: CustomerBirthday) => void
}> = ({ people, loading, onSend, onDelete }) => {
  if (loading) return <p className="text-[12px] text-gray-500 p-3">Loading…</p>
  if (!people.length) return <p className="text-[12px] text-gray-500 p-3">No birthdays found for this range.</p>
  return (
    <div className="divide-y divide-gray-100">
      {people.map(p => (
        <div key={p.id} className="flex items-center gap-3 py-2.5 px-2">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-black text-[#111111] truncate">{p.name || 'Customer'}</p>
            <p className="text-[11px] text-gray-500">
              {formatPhoneDisplay(p.phone)} · {formatBirthDate(p.birth_date)}
            </p>
          </div>
          <button type="button" onClick={() => onSend(p)} className="flex items-center gap-1 px-3 h-8 rounded-lg bg-[#059669] text-white text-[10px] font-black uppercase"><MessageCircle size={13} /> Send Offer</button>
          <button type="button" aria-label="Delete" onClick={() => onDelete(p)} className="w-8 h-8 border border-red-200 rounded-lg text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  )
}

export const BirthdaysView: React.FC = () => {
  const [tab, setTab] = useState<'calendar' | 'customers'>('calendar')
  const [people, setPeople] = useState<CustomerBirthday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const today = new Date()
  const [month, setMonth] = useState(today.getMonth())
  const [range, setRange] = useState<BirthdayRange>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [offers, setOffers] = useState<BirthdayOffer[]>(() => birthdayService.getOffers())
  const [offerId, setOfferId] = useState(() => birthdayService.getOffers()[0].id)
  const [template, setTemplate] = useState(() => birthdayService.getTemplate())
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    void birthdayService.list().then(list => { if (!cancelled) { setPeople(list); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const offer = offers.find(o => o.id === offerId) || offers[0]
  const applyRange = (r: BirthdayRange) => { const d = rangeToDates(r); setRange(r); setFrom(d.from); setTo(d.to) }
  const setCustomFrom = (v: string) => { setRange('all'); setFrom(v) }
  const setCustomTo = (v: string) => { setRange('all'); setTo(v) }

  const filtered = useMemo(
    () => people.filter(p => birthdayInWindow(p.birth_date, from, to)),
    [people, from, to],
  )

  // "MM-DD" → people with a birthday that day (any birth year)
  const byMonthDay = useMemo(() => {
    const m = new Map<string, CustomerBirthday[]>()
    for (const p of people) {
      const key = birthMonthDay(p.birth_date)
      m.set(key, [...(m.get(key) || []), p])
    }
    return m
  }, [people])

  const monthDays = DAYS_IN_MONTH[month]

  const shiftMonth = (delta: number) => setMonth(m => (m + delta + 12) % 12)

  const previewName = filtered[0]?.name || 'Aarav'
  const preview = buildBirthdayMessage(template, previewName, offer?.label || '')

  const sendOffer = (p: CustomerBirthday) => {
    window.open(toWhatsAppUrl(p.phone, buildBirthdayMessage(template, p.name, offer?.label || '')), '_blank', 'noopener')
  }

  const remove = async (p: CustomerBirthday) => {
    const ok = await confirmDelete({
      title: `Permanently Delete Birthday for ${p.name || p.phone}`,
      subtitle: `Phone: ${formatPhoneDisplay(p.phone)} • Birthday: ${formatBirthDate(p.birth_date)}`,
      warning: 'This customer birthday will be permanently deleted. No more birthday offers will be suggested for them.',
      impact: [
        { label: 'Customer', value: p.name || '—' },
        { label: 'Phone', value: formatPhoneDisplay(p.phone) },
        { label: 'Birthday Offers', value: 'Stopped for this customer', tone: 'danger' },
        { label: 'Past Bills', value: 'Kept unchanged', tone: 'success' },
      ],
    })
    if (!ok) return
    try { await birthdayService.remove(p.id); setPeople(prev => prev.filter(x => x.id !== p.id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete') }
  }

  const addOffer = () => {
    const label = window.prompt('Offer text (e.g. 20% OFF)')?.trim()
    if (!label) return
    const next = [...offers, { id: `o-${Date.now()}`, label }]
    setOffers(next); setOfferId(next[next.length - 1].id); birthdayService.saveOffers(next)
  }
  const editOffer = () => {
    if (!offer) return
    const label = window.prompt('Edit offer text', offer.label)?.trim()
    if (!label) return
    const next = offers.map(o => (o.id === offer.id ? { ...o, label } : o))
    setOffers(next); birthdayService.saveOffers(next)
  }
  const deleteOffer = () => {
    if (!offer || offers.length <= 1) return
    const next = offers.filter(o => o.id !== offer.id)
    setOffers(next); setOfferId(next[0].id); birthdayService.saveOffers(next)
  }
  const saveTemplate = () => { birthdayService.saveTemplate(template); setDirty(false) }

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = [['Customer', 'Mobile', 'Birthday (DD/MM)'], ...filtered.map(p => [p.name, p.phone, formatBirthDate(p.birth_date)])]
    void downloadCsv('birthdays.csv', rows.map(r => r.map(esc).join(',')).join('\n'))
  }

  const todayKey = toMonthDay(today)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center text-primary-hover"><Cake size={22} /></div>
        <div>
          <h2 className="text-xl font-black text-[#111111]">Date of Birth</h2>
          <p className="text-[12px] font-medium text-gray-500">Customer birthdays &amp; one-tap offer sender</p>
        </div>
      </div>

      <div className="flex gap-6 border-b border-gray-200">
        {(['calendar', 'customers'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`pb-2 text-[13px] font-black capitalize border-b-2 -mb-px ${tab === t ? 'border-primary-hover text-primary-hover' : 'border-transparent text-gray-500 hover:text-[#111111]'}`}>
            {t}
          </button>
        ))}
      </div>

      {error && <p className="text-[12px] font-bold text-red-600">{error}</p>}

      {tab === 'calendar' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-4">
            <div className={`${card} p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <select className="h-9 px-2 border border-gray-200 rounded-lg text-[12px] font-bold" value={month} onChange={e => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <div className="ml-auto flex gap-1">
                  <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="w-8 h-8 border border-gray-200 rounded-lg flex items-center justify-center"><ChevronLeft size={14} /></button>
                  <button type="button" onClick={() => setMonth(today.getMonth())} className="px-2 h-8 border border-gray-200 rounded-lg text-[11px] font-bold">Today</button>
                  <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="w-8 h-8 border border-gray-200 rounded-lg flex items-center justify-center"><ChevronRight size={14} /></button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {Array.from({ length: monthDays }, (_, i) => i + 1).map(d => {
                  const md = `${pad2(month + 1)}-${pad2(d)}`
                  const has = byMonthDay.has(md)
                  return (
                    <button key={d} type="button" onClick={() => { setRange('all'); setFrom(md); setTo(md) }}
                      title={has ? byMonthDay.get(md)!.map(p => p.name || p.phone).join(', ') : undefined}
                      className={`h-8 rounded-md border text-[11px] font-bold flex flex-col items-center justify-center leading-none ${md === todayKey ? 'border-primary-soft bg-primary-50' : 'border-gray-200 hover:bg-gray-50'} ${from === md && to === md ? 'ring-2 ring-primary-hover' : ''}`}>
                      {d}
                      {has && <span className="w-1 h-1 rounded-full bg-red-500 mt-0.5" />}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-[10px] text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Dot = birthday</p>
            </div>
            <div className={`${card} p-4`}>
              <p className="text-[12px] font-black text-[#111111] mb-2">Step 1 · Pick a date or range</p>
              <DateFilter range={range} from={from} to={to} onRange={applyRange} onFrom={setCustomFrom} onTo={setCustomTo} />
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${card} p-4 md:p-5`}>
              <h3 className="text-[14px] font-black text-[#111111]">Step 2 · Customers with birthdays ({filtered.length})</h3>
              <p className="text-[11px] text-gray-500 mb-3">Pick a date or range on the left, then tap Send Offer on a customer.</p>
              <PeopleList people={filtered} loading={loading} onSend={sendOffer} onDelete={remove} />
            </div>
            <div className={`${card} p-4 md:p-5`}>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center text-primary-hover"><Gift size={18} /></div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-black text-[#111111]">Step 3 · Customise offer message</h3>
                  <p className="text-[11px] text-gray-500">Sent on WhatsApp when you tap "Send Offer".</p>
                </div>
                <button type="button" onClick={saveTemplate} disabled={!dirty}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-black bg-primary text-primary-100 disabled:bg-gray-200 disabled:text-gray-400">
                  <Save size={14} /> Save
                </button>
              </div>

              <p className="text-[10px] font-black text-[#6B7280] mb-1">SELECT OFFER</p>
              <div className="flex gap-2 mb-2">
                <select className={input} value={offer?.id} onChange={e => setOfferId(e.target.value)}>
                  {offers.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button type="button" aria-label="Edit offer" onClick={editOffer} className="w-10 h-10 shrink-0 border border-gray-200 rounded-xl flex items-center justify-center text-primary-hover"><Pencil size={15} /></button>
                <button type="button" aria-label="Delete offer" onClick={deleteOffer} disabled={offers.length <= 1} className="w-10 h-10 shrink-0 border border-red-200 bg-red-50 rounded-xl flex items-center justify-center text-red-500 disabled:opacity-40"><Trash2 size={15} /></button>
              </div>
              <button type="button" onClick={addOffer} className="w-full h-9 mb-4 border border-dashed border-primary-soft rounded-xl text-[12px] font-black text-primary-hover flex items-center justify-center gap-1"><Plus size={14} /> Add Offer</button>

              <p className="text-[10px] font-black text-[#6B7280] mb-1">CUSTOMIZE MESSAGE</p>
              <textarea rows={6} value={template} onChange={e => { setTemplate(e.target.value); setDirty(true) }}
                className="w-full p-3 border border-gray-200 rounded-xl text-[13px] font-semibold text-[#111111] focus:outline-none focus:border-primary-soft" />
              <p className="text-[10px] text-gray-500 mt-1 mb-4">Use <b>{'{name}'}</b> for the customer's name and <b>{'{offer}'}</b> for the selected offer.</p>

              <div className="rounded-xl bg-[#F3F9F1] border border-green-200 p-4">
                <p className="text-[10px] font-black text-[#6B7280] mb-2">MESSAGE PREVIEW</p>
                <p className="text-[13px] text-[#111111] whitespace-pre-wrap">{preview}</p>
              </div>
            </div>

          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-black text-[#111111]">Filter by upcoming birthday</p>
              <button type="button" onClick={exportCsv} disabled={!filtered.length}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-green-50 text-green-700 text-[11px] font-black disabled:opacity-40"><Download size={13} /> Export CSV</button>
            </div>
            <DateFilter range={range} from={from} to={to} onRange={applyRange} onFrom={setCustomFrom} onTo={setCustomTo} />
          </div>
          <div className={`${card} p-2 md:p-4`}>
            <PeopleList people={filtered} loading={loading} onSend={sendOffer} onDelete={remove} />
          </div>
        </div>
      )}
    </div>
  )
}

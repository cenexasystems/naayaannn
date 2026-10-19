import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, CalendarDays, Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db } from '../../lib/db'
import { downloadCsv } from '../../lib/exportCsv'
import { formatCurrency } from '../../lib/retail'
import { confirmDelete } from '../../lib/confirmDelete'
import { BRAND_EN } from '../../lib/brand'

type Status = 'present' | 'absent' | 'half_day' | 'leave'

interface Staff {
  id: number
  name: string
  role: string
  phone: string
  base_salary: number
  is_active: boolean
}

interface AttendanceRow {
  id: number
  staff_id: number
  attendance_date: string
  status: Status
  clock_in: string | null
  clock_out: string | null
}

const STATUS_LABEL: Record<Status, string> = { present: 'Present', absent: 'Absent', half_day: 'Half Day', leave: 'Leave' }
const STATUS_ACTIVE: Record<Status, string> = {
  present: 'bg-emerald-600 text-white border-emerald-600',
  absent: 'bg-[#DC2626] text-white border-[#DC2626]',
  half_day: 'bg-orange-500 text-white border-orange-500',
  leave: 'bg-blue-600 text-white border-blue-600',
}

const pad = (n: number) => String(n).padStart(2, '0')
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const monthKey = () => todayKey().slice(0, 7)
const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` }
}
const toDisplayDate = (key: string) => (key ? key.split('-').reverse().join('-') : '')
const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm'
const th = 'px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-[#111111]'
const input = 'h-9 w-full rounded-xl border border-gray-200 bg-white px-3.5 text-[14px] font-semibold text-[#111111] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15'

const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span className="flex h-9 w-11 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-[13px] font-black text-primary">
    {(name.trim()[0] || '?').toUpperCase()}
  </span>
)

// ── Today's attendance ──────────────────────────────────────────────────────
const TodayTab: React.FC<{ staff: Staff[] }> = ({ staff }) => {
  const [date, setDate] = useState(todayKey())
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const active = staff.filter((s) => s.is_active)

  const fetchRows = useCallback(
    () => db.from('attendance').select('*').eq('attendance_date', date),
    [date],
  )
  const load = useCallback(async () => {
    const { data, error: e } = await fetchRows()
    if (e) setError(e.message)
    else setRows((data || []) as AttendanceRow[])
  }, [fetchRows])

  useEffect(() => {
    let cancelled = false
    void fetchRows().then(({ data, error: e }) => {
      if (cancelled) return
      if (e) setError(e.message)
      else setRows((data || []) as AttendanceRow[])
    })
    return () => { cancelled = true }
  }, [fetchRows])

  const byStaff = new Map(rows.map((r) => [r.staff_id, r]))
  const count = (s: Status) => rows.filter((r) => r.status === s && active.some((a) => a.id === r.staff_id)).length

  const mark = async (person: Staff, status: Status) => {
    setBusy(person.id)
    setError('')
    const existing = byStaff.get(person.id)
    const isToday = date === todayKey()
    const now = new Date().toISOString()
    const values: Record<string, unknown> = {
      staff_id: person.id,
      attendance_date: date,
      status,
      updated_at: now,
      clock_in: status === 'present' || status === 'half_day' ? existing?.clock_in || (isToday ? now : null) : null,
      clock_out: existing?.clock_out ?? null,
    }
    const { error: e } = await db.from('attendance').upsert(values, { onConflict: 'staff_id,attendance_date' })
    if (e) setError(e.message)
    await load()
    setBusy(null)
  }

  const clockOut = async (person: Staff) => {
    const existing = byStaff.get(person.id)
    if (!existing) return
    setBusy(person.id)
    const { error: e } = await db.from('attendance').update({ clock_out: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (e) setError(e.message)
    await load()
    setBusy(null)
  }

  return (
    <div className="space-y-6">
      <div className={`${card} flex flex-col gap-5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-4">
          <span className="flex h-10 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary"><CalendarDays size={24} /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Select date</p>
            <input
              type="date"
              value={date}
              max={todayKey()}
              onChange={(e) => setDate(e.target.value || todayKey())}
              className="bg-transparent text-[22px] font-black text-[#111111] outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-6 text-center sm:gap-10">
          {[
            { label: 'Total', value: active.length, cls: 'text-[#111111]' },
            { label: 'Present', value: count('present'), cls: 'text-emerald-700' },
            { label: 'Absent', value: count('absent'), cls: 'text-[#DC2626]' },
            { label: 'Leave/Half', value: count('leave') + count('half_day'), cls: 'text-orange-500' },
          ].map((k) => (
            <div key={k.label}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{k.label}</p>
              <p className={`text-[28px] font-black leading-tight ${k.cls}`}>{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-[#B91C1C]">{error}</p>}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-[#FAFAFA]">
            <tr>
              <th className={th}>Staff member</th>
              <th className={th}>Role</th>
              <th className={`${th} !text-emerald-700`}>Clock in</th>
              <th className={`${th} !text-[#DC2626]`}>Clock out</th>
              <th className={th}>Override status</th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-10 text-center text-[14px] font-semibold text-gray-400">No active staff. Add staff in Staff Management.</td></tr>
            )}
            {active.map((p) => {
              const r = byStaff.get(p.id)
              return (
                <tr key={p.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4"><Avatar name={p.name} /><span className="text-sm font-black text-[#111111]">{p.name}</span></div>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-600">{p.role}</td>
                  <td className="px-6 py-4 text-[14px] font-bold text-[#111111]">{timeOf(r?.clock_in ?? null)}</td>
                  <td className="px-6 py-4 text-[14px] font-bold text-[#111111]">
                    {r?.clock_out ? timeOf(r.clock_out) : r?.clock_in && date === todayKey() ? (
                      <button type="button" disabled={busy === p.id} onClick={() => void clockOut(p)} className="rounded-lg border border-red-200 px-3 py-1.5 text-[10px] font-bold uppercase text-[#DC2626] hover:bg-red-50">
                        Clock out
                      </button>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={busy === p.id}
                          onClick={() => void mark(p, s)}
                          className={`rounded-lg border px-3.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 ${
                            r?.status === s ? STATUS_ACTIVE[s] : 'border-gray-200 bg-white text-[#374151] hover:bg-gray-50'
                          }`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Monthly report ──────────────────────────────────────────────────────────
const ReportTab: React.FC<{ staff: Staff[] }> = ({ staff }) => {
  const [month, setMonth] = useState(monthKey())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState(() => monthRange(monthKey()))
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    void db.from('attendance').select('staff_id, status, attendance_date')
      .gte('attendance_date', applied.from).lte('attendance_date', applied.to)
      .then(({ data }) => setRows((data || []) as AttendanceRow[]))
  }, [applied])

  const apply = () => setApplied(from && to ? { from, to } : monthRange(month))
  const reset = () => { setMonth(monthKey()); setFrom(''); setTo(''); setApplied(monthRange(monthKey())) }

  const report = useMemo(() => {
    const list = staff.map((s) => {
      const mine = rows.filter((r) => r.staff_id === s.id)
      const c = (st: Status) => mine.filter((r) => r.status === st).length
      return { ...s, present: c('present'), half_day: c('half_day'), absent: c('absent'), leave: c('leave') }
    })
    return list.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * a.name.localeCompare(b.name))
  }, [staff, rows, sortDir])

  const exportCsv = () => {
    const header = ['Staff Member', 'Role', 'Present', 'Half Day', 'Absent', 'Leave']
    const lines = report.map((r) => [r.name, r.role, r.present, r.half_day, r.absent, r.leave].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    void downloadCsv(`${BRAND_EN.replace(/\s+/g, '')}_Attendance_${applied.from}_to_${applied.to}.csv`, [header.join(','), ...lines].join('\n'))
  }

  const field = 'flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 h-10'
  return (
    <div className="space-y-5">
      <div className={`${card} flex flex-wrap items-center gap-3 px-5 py-4`}>
        <label className={field}>
          <CalendarDays size={16} className="text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Month:</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-transparent text-sm font-bold text-[#111111] outline-none" />
        </label>
        <label className={field}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-sm font-bold text-[#111111] outline-none" />
        </label>
        <label className={field}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-sm font-bold text-[#111111] outline-none" />
        </label>
        <div className="ml-auto flex flex-wrap gap-2.5">
          <button type="button" onClick={apply} className="h-9 rounded-xl bg-primary px-5 text-[14px] font-black text-primary-ink hover:bg-primary-hover">Apply Filter</button>
          <button type="button" onClick={reset} className="h-9 rounded-xl border border-gray-200 px-5 text-[14px] font-black text-[#111111] hover:bg-gray-50">Reset</button>
          <button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-2 rounded-xl border-2 border-primary px-5 text-[14px] font-black text-[#111111] hover:bg-primary-50">
            <Download size={16} /> Export to Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[14px] text-[#374151]">
        <p>Showing records from: <b className="text-[#111111]">{toDisplayDate(applied.from)}</b> to <b className="text-[#111111]">{toDisplayDate(applied.to)}</b></p>
        <p>Staff: <b className="text-[#111111]">{report.length}</b> · Sorted by: <b className="text-[#111111]">NAME ({sortDir.toUpperCase()})</b></p>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-[#FAFAFA]">
            <tr>
              <th className={th}>
                <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="inline-flex items-center gap-1.5 uppercase">
                  Staff member {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </button>
              </th>
              <th className={th}>Role</th>
              <th className={`${th} text-center !text-emerald-700`}>Present</th>
              <th className={`${th} text-center !text-orange-500`}>Half day</th>
              <th className={`${th} text-center !text-[#DC2626]`}>Absent</th>
              <th className={`${th} text-center !text-blue-600`}>Leave</th>
            </tr>
          </thead>
          <tbody>
            {report.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-[14px] font-semibold text-gray-400">No staff yet.</td></tr>}
            {report.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0">
                <td className="px-6 py-4"><div className="flex items-center gap-4"><Avatar name={r.name} /><span className="text-sm font-black text-[#111111]">{r.name}</span></div></td>
                <td className="px-6 py-4 text-sm font-semibold text-gray-600">{r.role}</td>
                <td className="px-6 py-4 text-center text-base font-black text-emerald-700">{r.present}</td>
                <td className="px-6 py-4 text-center text-base font-black text-orange-500">{r.half_day}</td>
                <td className="px-6 py-4 text-center text-base font-black text-[#DC2626]">{r.absent}</td>
                <td className="px-6 py-4 text-center text-base font-black text-blue-600">{r.leave}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Staff management ────────────────────────────────────────────────────────
const emptyStaff = { name: '', role: 'staff', phone: '', base_salary: '', is_active: true }

const StaffTab: React.FC<{ staff: Staff[]; reload: () => Promise<void> }> = ({ staff, reload }) => {
  const [editing, setEditing] = useState<Staff | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyStaff)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const openNew = () => { setEditing(null); setForm(emptyStaff); setError(''); setOpen(true) }
  const openEdit = (s: Staff) => {
    setEditing(s)
    setForm({ name: s.name, role: s.role, phone: s.phone, base_salary: String(s.base_salary ?? ''), is_active: s.is_active })
    setError('')
    setOpen(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    const salary = Number(form.base_salary || 0)
    if (!Number.isFinite(salary) || salary < 0) { setError('Enter a valid salary.'); return }
    setSaving(true)
    const values = { name: form.name.trim(), role: form.role.trim() || 'staff', phone: form.phone.replace(/\D/g, ''), base_salary: salary, is_active: form.is_active, updated_at: new Date().toISOString() }
    const { error: err } = editing
      ? await db.from('staff').update(values).eq('id', editing.id)
      : await db.from('staff').insert(values)
    setSaving(false)
    if (err) { setError(err.message); return }
    setOpen(false)
    await reload()
  }

  const remove = async (s: Staff) => {
    const ok = await confirmDelete({
      title: `Permanently Delete Staff “${s.name}”`,
      subtitle: `${s.role}${s.phone ? ` • ${s.phone}` : ''}`,
      warning: 'This staff member and all of their attendance records will be permanently deleted from the Neon database.',
      impact: [
        { label: 'Staff Member', value: s.name },
        { label: 'Base Salary', value: formatCurrency(Number(s.base_salary) || 0) },
        { label: 'Attendance Records', value: 'Permanently purged', tone: 'danger' },
      ],
    })
    if (!ok) return
    const { error: err } = await db.from('staff').delete().eq('id', s.id)
    if (err) { setError(err.message); return }
    await reload()
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" onClick={openNew} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-black text-primary-ink shadow-md hover:bg-primary-hover">
          <Plus size={18} /> Add Staff
        </button>
      </div>
      {error && !open && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-[#B91C1C]">{error}</p>}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-200 bg-[#FAFAFA]">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Role</th>
              <th className={th}>Phone</th>
              <th className={th}>Base salary</th>
              <th className={th}>Status</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-[14px] font-semibold text-gray-400">No staff yet. Click “Add Staff”.</td></tr>}
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3.5 text-sm font-black text-[#111111]">{s.name}</td>
                <td className="px-4 py-3.5 text-sm font-semibold text-gray-600">{s.role}</td>
                <td className="px-4 py-3.5 font-mono text-[14px] text-gray-600">{s.phone || '—'}</td>
                <td className="px-4 py-3.5 text-sm font-black text-[#111111]">{formatCurrency(Number(s.base_salary) || 0)}</td>
                <td className="px-4 py-3.5">
                  <span className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${s.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-[#111111] hover:bg-gray-100"><Pencil size={16} /></button>
                    <button type="button" onClick={() => void remove(s)} aria-label={`Delete ${s.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-[#DC2626] hover:bg-red-100"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <form onSubmit={save} className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3.5">
              <h3 className="text-base font-black text-[#111111]">{editing ? 'Edit Staff' : 'Add Staff'}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:text-[#111111]"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-4 py-3.5">
              <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Name *</span>
                <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus maxLength={60} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Role</span>
                  <input className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} maxLength={40} /></label>
                <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Phone</span>
                  <input className={input} value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={15} /></label>
              </div>
              <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Base salary (₹ / month)</span>
                <input className={input} value={form.base_salary} inputMode="decimal" onChange={(e) => setForm({ ...form, base_salary: e.target.value })} placeholder="0.00" /></label>
              <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-[14px] font-bold text-[#111111]">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-5 w-5 accent-[rgb(var(--primary))]" />
                Active (shown in today's attendance)
              </label>
              {error && <p className="text-[13px] font-bold text-[#B91C1C]">{error}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-xl px-5 text-[14px] font-bold text-[#374151] hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={saving} className="h-9 rounded-xl bg-primary px-6 text-[14px] font-black text-primary-ink hover:bg-primary-hover disabled:opacity-60">{saving ? 'Saving…' : 'Save Staff'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────
type Tab = 'today' | 'report' | 'staff'

export const AttendanceView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('today')
  const [staff, setStaff] = useState<Staff[]>([])
  const [error, setError] = useState('')

  const applyStaff = useCallback((data: unknown, e: { message: string } | null) => {
    if (e) setError(e.message)
    else setStaff(((data || []) as Staff[]).map((s) => ({ ...s, base_salary: Number(s.base_salary) || 0 })))
  }, [])
  const loadStaff = useCallback(async () => {
    const { data, error: e } = await db.from('staff').select('*').order('name', { ascending: true })
    applyStaff(data, e)
  }, [applyStaff])

  useEffect(() => {
    let cancelled = false
    void db.from('staff').select('*').order('name', { ascending: true }).then(({ data, error: e }) => {
      if (!cancelled) applyStaff(data, e)
    })
    return () => { cancelled = true }
  }, [applyStaff])

  return (
    <div className="space-y-6">
      <h2 className="border-l-[6px] border-primary pl-5 text-[28px] font-black leading-tight tracking-tight text-[#111111]">Attendance &amp; Staff</h2>
      <div className="flex flex-wrap gap-2.5">
        {([['today', "Today's Attendance"], ['report', 'Monthly Report'], ['staff', 'Staff Management']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`h-9 rounded-xl border px-6 text-sm font-black transition-colors ${tab === id ? 'border-primary bg-primary text-primary-ink' : 'border-gray-200 bg-white text-[#111111] hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-[#B91C1C]">{error}</p>}
      {tab === 'today' && <TodayTab staff={staff} />}
      {tab === 'report' && <ReportTab staff={staff} />}
      {tab === 'staff' && <StaffTab staff={staff} reload={loadStaff} />}
    </div>
  )
}

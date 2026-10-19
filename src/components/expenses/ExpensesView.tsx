import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Wallet, Receipt as ReceiptIcon, Tag, Plus, List, Search, Pencil, Trash2, ChevronDown, Banknote, Settings2, Download } from 'lucide-react'
import { expenseService, exportExpensesToCSV, type ExpenseCategory, type ExpenseRecord } from '../../services/expenseService'
import { RecordExpenseModal } from './RecordExpenseModal'
import { ExpenseCategoriesView } from './ExpenseCategoriesView'
import { confirmDelete } from '../../lib/confirmDelete'
import { formatCurrency } from '../../lib/retail'
import { useAdminAuthStore } from '../../store/store'

type Period = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom'

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const rangeFor = (period: Period, from: string, to: string): { from: string; to: string } => {
  const now = new Date()
  const today = keyOf(now)
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') {
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    return { from: keyOf(monday), to: keyOf(sunday) }
  }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: keyOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
  if (period === 'custom') return { from, to }
  return { from: '', to: '' }
}

const PERIOD_LABEL: Record<Period, string> = { today: 'Today', week: 'Week', month: 'Month', year: 'Year', all: 'All', custom: 'Custom' }
const PAY_MODES = [['cash', 'Cash'], ['upi', 'UPI / GPay'], ['card', 'Card'], ['bank', 'Bank Transfer']] as const

/** First line = what the money was for, following lines = notes. */
const splitDescription = (d: string) => {
  const [title, ...rest] = (d || '').split('\n')
  return { title: title.trim(), notes: rest.join(' ').trim() }
}

const card = 'rounded-[22px] border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
const label = 'mb-2 block text-[13px] font-black uppercase tracking-wide text-[#111111]'
const field = 'h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-[15px] font-medium text-[#111111] placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15'

export const ExpensesView: React.FC = () => {
  const role = useAdminAuthStore((s) => s.role)
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCategories, setShowCategories] = useState(false)
  const [editing, setEditing] = useState<ExpenseRecord | null>(null)
  const [logCategory, setLogCategory] = useState('all')
  const [logSearch, setLogSearch] = useState('')

  const [form, setForm] = useState({ whatFor: '', amount: '', date: keyOf(new Date()), category: '', payMode: 'cash', notes: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const range = rangeFor(period, customFrom, customTo)

  const loadCategories = useCallback(async () => {
    try {
      const list = await expenseService.getCategories()
      setCategories(list)
      setForm((f) => (f.category ? f : { ...f, category: list.find((c) => c.is_active)?.name || '' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load categories')
    }
  }, [])

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    try {
      setExpenses(await expenseService.getExpenses({ fromDate: range.from || undefined, toDate: range.to || undefined }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load expenses')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { void loadCategories() }, [loadCategories])
  useEffect(() => { void loadExpenses() }, [loadExpenses])

  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of expenses) map.set(e.category_name || 'Uncategorised', (map.get(e.category_name || 'Uncategorised') || 0) + (Number(e.amount) || 0))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [expenses])
  const topCategory = byCategory[0]?.[0]

  const logRows = useMemo(() => {
    const q = logSearch.trim().toLowerCase()
    return expenses
      .filter((e) => logCategory === 'all' || e.category_name === logCategory)
      .filter((e) => !q || [e.description, e.category_name, e.payment_mode, e.recorded_by_name, String(e.amount)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.expense_date + b.created_at).localeCompare(a.expense_date + a.created_at))
  }, [expenses, logCategory, logSearch])
  const logTotal = logRows.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.whatFor.trim()) { setFormError('Enter what the expense was for.'); return }
    if (!amount || amount <= 0) { setFormError('Enter an amount greater than 0.'); return }
    if (!form.category) { setFormError('Pick a category.'); return }
    setSaving(true)
    setFormError('')
    try {
      const cat = categories.find((c) => c.name === form.category)
      await expenseService.createExpense({
        expense_date: form.date || keyOf(new Date()),
        category_id: cat?.id ?? null,
        category_name: form.category,
        amount,
        description: form.notes.trim() ? `${form.whatFor.trim()}\n${form.notes.trim()}` : form.whatFor.trim(),
        payment_mode: form.payMode,
        recorded_by_name: role === 'admin' ? 'Admin' : 'Staff',
      })
      setForm((f) => ({ ...f, whatFor: '', amount: '', notes: '' }))
      await loadExpenses()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the expense')
    } finally {
      setSaving(false)
    }
  }

  const removeExpense = async (exp: ExpenseRecord) => {
    const { title, notes } = splitDescription(exp.description)
    const ok = await confirmDelete({
      title: 'Permanently Delete Expense',
      subtitle: `${title || exp.category_name} • Date: ${new Date(exp.expense_date).toLocaleDateString('en-GB')}`,
      warning: 'This expense will be permanently deleted from the Neon database.',
      impact: [
        { label: 'Expense', value: title || '—' },
        ...(notes ? [{ label: 'Notes', value: notes }] : []),
        { label: 'Category', value: exp.category_name || '—' },
        { label: 'Amount', value: formatCurrency(exp.amount || 0), tone: 'danger' as const },
        { label: 'Net Profit', value: `+${formatCurrency(exp.amount || 0)} (expense no longer counted)`, tone: 'success' as const },
      ],
    })
    if (!ok) return
    try {
      await expenseService.deleteExpense(exp.id)
      setExpenses((prev) => prev.filter((x) => x.id !== exp.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the expense')
    }
  }

  const activeCategories = categories.filter((c) => c.is_active)

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex flex-col gap-5 min-[1750px]:flex-row min-[1750px]:items-start min-[1750px]:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-[32px] sm:text-[36px] font-black leading-tight tracking-tight text-[#111111]">
            <Wallet size={36} strokeWidth={1.75} /> Expense Tracker
          </h2>
          <p className="mt-1 text-[14.5px] font-medium text-[#111111]">Record what the shop spends. Expenses are offset against sales to show your real Net Profit on the dashboard.</p>
        </div>
        <div className="flex flex-col gap-2 min-[1750px]:items-end">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            {(['today', 'week', 'month', 'year', 'all', 'custom'] as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={`rounded-xl px-4 py-2 text-[13px] font-black uppercase tracking-wide transition-colors cursor-pointer ${period === p ? 'bg-primary text-primary-ink' : 'text-[#111111] hover:bg-gray-50'}`}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="inline-flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-2.5">
              <label className="flex items-center gap-2"><span className="text-[11px] font-black uppercase tracking-widest text-[#111111]">From:</span>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-transparent text-[14px] font-black text-[#111111] outline-none" /></label>
              <label className="flex items-center gap-2"><span className="text-[11px] font-black uppercase tracking-widest text-[#111111]">To:</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-transparent text-[14px] font-black text-[#111111] outline-none" /></label>
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-[#B91C1C]">{error}</p>}

      {/* Summary */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div className="relative overflow-hidden rounded-[22px] bg-primary bg-gradient-to-br from-primary to-[rgb(var(--primary-hover))] p-6 text-primary-ink shadow-md">
          <div className="flex items-start justify-between">
            <p className="text-[13.5px] font-black uppercase tracking-wide">Total Expenses</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><Banknote size={18} /></span>
          </div>
          <p className="mt-6 text-[30px] font-black leading-none">{formatCurrency(total)}</p>
          <p className="mt-3 text-[11.5px] font-black uppercase tracking-wider opacity-80">{PERIOD_LABEL[period]} period</p>
        </div>
        <div className={`${card} p-6`}>
          <div className="flex items-start justify-between">
            <p className="text-[13.5px] font-black uppercase tracking-wide text-[#111111]">Entries</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500"><ReceiptIcon size={18} /></span>
          </div>
          <p className="mt-6 text-[30px] font-black leading-none text-[#111111]">{expenses.length}</p>
          <p className="mt-3 text-[11.5px] font-semibold text-[#111111]">Expenses recorded</p>
        </div>
        <div className={`${card} p-6`}>
          <div className="flex items-start justify-between">
            <p className="text-[13.5px] font-black uppercase tracking-wide text-[#111111]">Top Category</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500"><Tag size={18} /></span>
          </div>
          <p className="mt-6 truncate text-[24px] font-black leading-none text-[#111111]">{topCategory || '—'}</p>
          <p className="mt-3 text-[11.5px] font-semibold text-[#111111]">Highest spend</p>
        </div>
      </div>

      {/* Add expense + spend by category */}
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <form onSubmit={addExpense} className={`${card} space-y-5 p-6 sm:p-7`}>
          <h3 className="border-l-[5px] border-primary pl-4 text-[18px] font-black uppercase tracking-wide text-[#111111]">Add Expense</h3>
          <label className="block"><span className={label}>What for?</span>
            <input className={field} value={form.whatFor} onChange={(e) => setForm({ ...form, whatFor: e.target.value })} placeholder="e.g. October shop rent" maxLength={120} /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className={label}>Amount (₹)</span>
              <input className={field} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
            <label className="block"><span className={label}>Date</span>
              <input type="date" className={`${field} !bg-white`} value={form.date} max={keyOf(new Date())} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          <label className="block"><span className={label}>Category</span>
            <span className="relative block">
              <select className={`${field} !bg-white appearance-none pr-10 cursor-pointer`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {activeCategories.length === 0 && <option value="">No categories yet</option>}
                {activeCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#111111]" />
            </span></label>
          <label className="block"><span className={label}>Paid via</span>
            <span className="relative block">
              <select className={`${field} !bg-white appearance-none pr-10 uppercase cursor-pointer`} value={form.payMode} onChange={(e) => setForm({ ...form, payMode: e.target.value })}>
                {PAY_MODES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#111111]" />
            </span></label>
          <label className="block"><span className={label}>Notes (optional)</span>
            <input className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reference / supplier / bill no." maxLength={200} /></label>
          {formError && <p className="text-[13px] font-bold text-[#B91C1C]">{formError}</p>}
          <button type="submit" disabled={saving} className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-black uppercase tracking-[0.14em] text-primary-ink shadow-md hover:bg-primary-hover disabled:opacity-60 cursor-pointer">
            <Plus size={18} /> {saving ? 'Saving…' : 'Add Expense'}
          </button>
        </form>

        <div className={`${card} p-6 sm:p-7`}>
          <div className="mb-6 flex items-center justify-between gap-3">
            <h3 className="border-l-[5px] border-primary pl-4 text-[18px] font-black uppercase tracking-wide text-[#111111]">Spend by Category</h3>
            <button type="button" onClick={() => setShowCategories((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11.5px] font-black uppercase tracking-wide text-[#111111] hover:bg-gray-50 cursor-pointer">
              <Settings2 size={14} /> {showCategories ? 'Close' : 'Manage'}
            </button>
          </div>
          {showCategories ? (
            <ExpenseCategoriesView
              categories={categories}
              onCategoriesUpdated={() => { void loadCategories(); void loadExpenses() }}
            />
          ) : byCategory.length === 0 ? (
            <p className="py-10 text-center text-[14px] font-medium text-gray-400">No expenses in this period.</p>
          ) : (
            <ul className="space-y-5">
              {byCategory.map(([name, amount]) => {
                const pct = total > 0 ? Math.round((amount / total) * 100) : 0
                return (
                  <li key={name}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-[15px]">
                      <span className="flex items-center gap-2 font-black text-[#111111]"><Tag size={15} className="text-gray-400" /> {name}</span>
                      <span className="font-black text-[#111111]">{formatCurrency(amount)} <span className="ml-1 text-[12px] font-bold text-gray-400">{pct}%</span></span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Expense log */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <h3 className="flex items-center gap-3 text-[18px] font-black uppercase tracking-wide text-[#111111]"><List size={20} /> Expense Log</h3>
          <div className="flex flex-wrap gap-2.5">
            <span className="relative">
              <select value={logCategory} onChange={(e) => setLogCategory(e.target.value)} aria-label="Filter by category" className="h-11 appearance-none rounded-xl border border-gray-200 bg-white pl-4 pr-10 text-[14px] font-black text-[#111111] focus:border-primary focus:outline-none cursor-pointer">
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#111111]" />
            </span>
            <span className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Search expenses..." aria-label="Search expenses" className="h-11 w-56 rounded-xl border border-gray-200 pl-10 pr-3 text-[14px] text-[#111111] placeholder:text-gray-400 focus:border-primary focus:outline-none" />
            </span>
            <button type="button" onClick={() => void exportExpensesToCSV(logRows)} disabled={logRows.length === 0} className="inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 text-[13px] font-black uppercase text-[#111111] hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
              <Download size={15} /> CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                {['Date', 'Expense', 'Category', 'Paid via'].map((h) => <th key={h} className="px-5 py-4 text-[13px] font-black uppercase tracking-wide text-[#111111]">{h}</th>)}
                <th className="px-5 py-4 text-right text-[13px] font-black uppercase tracking-wide text-[#111111]">Amount</th>
                <th className="px-5 py-4 text-center text-[13px] font-black uppercase tracking-wide text-[#111111]">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[14px] text-gray-400">Loading expenses…</td></tr>
              ) : logRows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[14px] text-gray-400">No expense records found matching the filters.</td></tr>
              ) : logRows.map((exp) => {
                const { title, notes } = splitDescription(exp.description)
                return (
                  <tr key={exp.id} className="border-b border-gray-100 even:bg-gray-50/60">
                    <td className="whitespace-nowrap px-5 py-4 text-[15px] text-[#111111]">{new Date(exp.expense_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="px-5 py-4">
                      <p className="text-[16px] font-black text-[#111111]">{title || exp.category_name}</p>
                      {notes && <p className="text-[12.5px] text-gray-500">{notes}</p>}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-[12px] font-black uppercase tracking-wide text-[#111111]"><Tag size={13} /> {exp.category_name || '—'}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-[13px] font-black uppercase text-[#374151]"><Banknote size={14} className="mr-1.5 inline text-gray-500" />{exp.payment_mode || 'cash'}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-[17px] font-black text-[#DC2626]">− {formatCurrency(exp.amount || 0)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => setEditing(exp)} aria-label="Edit expense" className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-[#111111] hover:bg-gray-200 cursor-pointer"><Pencil size={16} /></button>
                        {role === 'admin' && (
                          <button type="button" onClick={() => void removeExpense(exp)} aria-label="Delete expense" className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-[#DC2626] hover:bg-red-100 cursor-pointer"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {logRows.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-5 py-4 text-right text-[14px] font-black uppercase tracking-wide text-[#111111]">Total ({PERIOD_LABEL[period]})</td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-[17px] font-black text-[#DC2626]">− {formatCurrency(logTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {editing && (
        <RecordExpenseModal
          isOpen
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); void loadExpenses() }}
          categories={categories}
          expenseToEdit={editing}
        />
      )}
    </div>
  )
}

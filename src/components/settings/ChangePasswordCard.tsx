import React, { useState, type FormEvent } from 'react'
import { KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'
import { changePortalPassword } from '../../lib/db'

const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6'
const label = 'block text-[11px] font-black uppercase tracking-[0.12em] text-[#4B5563] mb-2'
const input =
  'w-full h-10 bg-white border border-gray-200 rounded-xl px-3.5 text-sm font-semibold text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition'

/** Lets the signed-in admin or staff user change their own password (the admin can also reset the staff one). */
export const ChangePasswordCard: React.FC<{ role: 'admin' | 'staff' }> = ({ role }) => {
  const [target, setTarget] = useState<'admin' | 'staff'>(role)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMessage(null)
    if (next.trim().length < 6) return setMessage({ type: 'error', text: 'The new password must be at least 6 characters.' })
    if (next !== confirm) return setMessage({ type: 'error', text: 'The new password and confirmation do not match.' })
    setSaving(true)
    const { error } = await changePortalPassword({ currentPassword: current, newPassword: next, target })
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error })
    setCurrent(''); setNext(''); setConfirm('')
    setMessage({ type: 'ok', text: `${target === 'staff' ? 'Staff' : 'Admin'} password changed. Use it the next time you sign in.` })
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-4`} autoComplete="off">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-ink"><KeyRound size={18} /></span>
        <div>
          <h3 className="text-sm font-black uppercase tracking-wide text-[#111111]">Change Password</h3>
          <p className="text-[12px] font-medium text-gray-500">
            {role === 'admin' ? 'Change the admin password, or reset the staff password.' : 'Change the password you sign in with.'}
          </p>
        </div>
      </div>

      {role === 'admin' && (
        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-gray-200 p-1.5 sm:max-w-xs" role="tablist" aria-label="Whose password">
          {(['admin', 'staff'] as const).map(t => (
            <button key={t} type="button" role="tab" aria-selected={target === t} onClick={() => setTarget(t)}
              className={`h-9 rounded-lg text-[10px] font-bold uppercase tracking-wider ${target === t ? 'bg-primary text-primary-ink' : 'text-[#111111] hover:bg-gray-50'}`}>
              {t === 'admin' ? 'Admin' : 'Staff'} password
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className={label}>{role === 'admin' ? 'Your current admin password' : 'Current password'}</span>
          <input type="password" className={input} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
        <label className="block"><span className={label}>New password</span>
          <input type="password" className={input} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
        <label className="block"><span className={label}>Confirm new password</span>
          <input type="password" className={input} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
      </div>

      {message && (
        <p className={`flex items-center gap-2 text-[13px] font-bold ${message.type === 'ok' ? 'text-emerald-700' : 'text-[#B91C1C]'}`}>
          {message.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {message.text}
        </p>
      )}

      <button type="submit" disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[11px] font-black uppercase tracking-wider text-primary-ink shadow-md hover:bg-primary-hover disabled:opacity-60 cursor-pointer">
        <KeyRound size={15} /> {saving ? 'Saving…' : 'Change Password'}
      </button>
    </form>
  )
}

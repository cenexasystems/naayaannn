import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Lock, Eye, EyeOff, AlertCircle, User, ChevronRight } from 'lucide-react'
import { useAdminAuthStore } from '../store/store'
import { BRAND_EN, BRAND_TAGLINE, BRAND_LOGO } from '../lib/brand'
import { useLangStore } from '../store/langStore'
import { alarmSound } from '../lib/alarmAudio'

const fieldWrap =
  'flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 h-[60px] transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15'
const fieldInput =
  'min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#111111] outline-none placeholder:text-gray-300 placeholder:tracking-normal'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { lang } = useLangStore()
  const l = (en: string, ta: string) => lang === 'ta' ? ta : en
  const login = useAdminAuthStore((state) => state.login)

  const [portalId, setPortalId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: Location })?.from?.pathname || '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Pre-unlock iOS audio context synchronously on user submit gesture
    void alarmSound.unlock()
    setError('')
    setLoading(true)
    const role = await login(portalId.trim(), password)
    setLoading(false)
    if (role === 'admin') {
      const destination = from === '/pos' ? '/dashboard' : from
      navigate(destination, { replace: true })
    } else if (role === 'staff') {
      navigate('/dashboard', { replace: true })
    } else {
      setError(l('Invalid Admin or Staff credentials', 'தவறான நிர்வாகி அல்லது பணியாளர் விவரங்கள்'))
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-y-auto bg-gradient-to-br from-white via-[#FAFAFA] to-primary-50 px-4 py-8 font-sans flex flex-col items-center justify-center">
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-[40px] border border-gray-300 bg-white shadow-[0_30px_70px_-20px_rgba(0,0,0,0.18)]">
        <div className="h-2 w-full bg-primary" />
        <div className="px-6 pb-9 pt-9 sm:px-12">
          {/* Brand */}
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 -m-3 rounded-[32px] bg-primary/30 blur-xl" aria-hidden />
              <div className="relative flex h-[118px] w-[118px] items-center justify-center overflow-hidden rounded-[28px] bg-primary p-2 shadow-lg">
                <img src={BRAND_LOGO} alt={BRAND_EN} className="h-full w-full object-contain rounded-[22px]" />
              </div>
            </div>
            <h1 className="font-serif text-[34px] sm:text-[38px] leading-tight text-primary" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              {BRAND_EN}
            </h1>
            <p className="mt-3 max-w-[440px] text-[13px] sm:text-[14px] font-bold uppercase leading-relaxed tracking-[0.22em] text-gray-500">
              {BRAND_TAGLINE ? `POS Terminal • ${BRAND_TAGLINE}` : l('Retail POS Terminal • Billing • Inventory', 'சில்லறை POS • பில்லிங் • சரக்கு')}
            </p>
          </div>

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-semibold text-red-600">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            <div>
              <label htmlFor="admin-portal-id" className="mb-2 ml-1 block text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                {l('Portal ID', 'நுழைவு அடையாளம்')}
              </label>
              <div className={fieldWrap}>
                <User size={19} className="shrink-0 text-primary" />
                <input
                  id="admin-portal-id"
                  name="portalId"
                  type="text"
                  autoComplete="username"
                  placeholder={l('Enter portal ID', 'அடையாளத்தை உள்ளிடவும்')}
                  className={fieldInput}
                  value={portalId}
                  onChange={(e) => { setPortalId(e.target.value); setError('') }}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-portal-password" className="mb-2 ml-1 block text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                {l('Security Passcode', 'பாதுகாப்பு கடவுச்சொல்')}
              </label>
              <div className={fieldWrap}>
                <Lock size={19} className="shrink-0 text-primary" />
                <input
                  id="admin-portal-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`${fieldInput} ${showPassword ? '' : 'tracking-[0.3em]'}`}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#111111] cursor-pointer"
                  aria-label={showPassword ? l('Hide password', 'கடவுச்சொல்லை மறை') : l('Show password', 'கடவுச்சொல்லை காட்டு')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="!mt-8 flex h-[62px] w-full items-center justify-center gap-3 rounded-2xl bg-primary text-[15px] font-black uppercase tracking-[0.2em] text-primary-ink shadow-[0_14px_30px_-10px_rgb(var(--primary)/0.6)] transition-all hover:bg-primary-hover active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {l('Verifying…', 'சரிபார்க்கிறது…')}
                </>
              ) : (
                <>
                  {l('Authenticate', 'உள்நுழை')}
                  <ChevronRight size={19} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-[10.5px] font-black uppercase tracking-[0.14em] text-primary">
              <span className="h-2 w-2 rounded-full bg-primary-soft" />
              System online • Encrypted
            </span>
          </div>
        </div>
      </div>
      <p className="mt-8 text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">{BRAND_EN} Terminal v1.0</p>
    </div>
  )
}

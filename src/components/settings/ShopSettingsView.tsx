import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Save, Store, User, Phone, Mail, MapPin, AtSign, Upload, Trash2, CheckCircle2, AlertCircle,
  Settings2, Palette, Image as ImageIcon, Languages, BellRing, Volume2, VolumeX, MessageCircle, Clock, Hash,
} from 'lucide-react'
import {
  BRAND_SETTINGS, DEFAULT_ACCENT, DEFAULT_LOGO, applyAccentColor, isValidAccent, toE164, type BrandSettings,
} from '../../lib/brand'
import { saveBrandSettings } from '../../services/brandSettingsService'
import { useStockAlertPrefs } from '../../store/stockAlertPrefs'
import { alarmSound } from '../../lib/alarmAudio'

const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6'
const label = 'block text-[11px] font-black uppercase tracking-[0.12em] text-[#4B5563] mb-2'
const inputBase =
  'w-full h-10 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition'
const LOGO_MAX_PX = 512

/** Grey shades, darkest first. All keep white text readable. */
const GREY_SWATCHES = [
  '#0A0A0A', '#18181B', '#1C1917', '#1E293B', '#262626', '#27272A', '#292524', '#334155',
  '#374151', '#3F3F46', '#404040', '#44403C', '#475569', '#4B5563', '#52525B', '#57534E',
  '#525252', '#64748B', '#6B7280', '#71717A',
]
const ACCENT_SWATCHES = [
  '#31042F', '#7F1D3A', '#9F1239', '#B91C1C', '#C2410C', '#A16207', '#15803D', '#047857',
  '#0F766E', '#0E7490', '#1D4ED8', '#4338CA', '#6D28D9', '#7E22CE', '#A21CAF', '#BE185D',
]

/** Reads an image file and returns it as a PNG data URL no larger than LOGO_MAX_PX. */
const fileToPngDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('This file is not a supported image.'))
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Could not process the image.'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })

/** Ready-made logo options shown under Shop logo (the default NAAYAN logo stays as the first choice). */
const LOGO_OPTIONS = Array.from({ length: 20 }, (_, i) => `/logos/logo-${String(i + 1).padStart(2, '0')}.png`)

const urlToDataUrl = async (url: string): Promise<string> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not load this logo.')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read this logo.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; action?: React.ReactNode }> = ({ icon, title, action }) => (
  <div className="flex items-center justify-between gap-3 mb-1">
    <h3 className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-[#111111]">
      <span className="text-primary">{icon}</span>
      {title}
    </h3>
    {action}
  </div>
)

const IconInput: React.FC<{
  icon?: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  required?: boolean
  maxLength?: number
}> = ({ icon, value, onChange, placeholder, type = 'text', inputMode, required, maxLength }) => (
  <div className="relative">
    {icon && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>}
    <input
      className={`${inputBase} ${icon ? 'pl-11' : 'pl-4'} pr-4`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      required={required}
      maxLength={maxLength}
    />
  </div>
)

const isPhoneOk = (v: string) => !v.trim() || toE164(v).length >= 10

export const ShopSettingsView: React.FC = () => {
  const [form, setForm] = useState<BrandSettings>({ ...BRAND_SETTINGS })
  const [hexDraft, setHexDraft] = useState(BRAND_SETTINGS.accentColor)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = useRef(false)

  const { notify: stockNotify, sound: stockSound, setNotify: setStockNotify, setSound: setStockSound } = useStockAlertPrefs()

  const set = (key: keyof BrandSettings) => (v: string) => setForm((f) => ({ ...f, [key]: v }))

  // Live preview of the accent colour; undo it if the page is left without saving
  useEffect(() => { applyAccentColor(form.accentColor) }, [form.accentColor])
  useEffect(() => () => { if (!saved.current) applyAccentColor(BRAND_SETTINGS.accentColor) }, [])

  const pickAccent = (hex: string) => {
    setHexDraft(hex)
    setForm((f) => ({ ...f, accentColor: hex }))
  }

  const handleHexInput = (v: string) => {
    const hex = v.startsWith('#') ? v : `#${v}`
    setHexDraft(hex)
    if (isValidAccent(hex)) setForm((f) => ({ ...f, accentColor: hex.toUpperCase() }))
  }

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const logo = await fileToPngDataUrl(file)
      setForm((f) => ({ ...f, logo }))
      setMessage(null)
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not use this image.' })
    }
  }

  /** Picks a ready-made logo (or '' for the default) and applies it everywhere right away. */
  const applyPresetLogo = async (url: string) => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const logo = url ? await urlToDataUrl(url) : ''
      // Only the logo changes; any half-typed edits in the form are not saved with it
      const result = await saveBrandSettings({ ...BRAND_SETTINGS, logo })
      saved.current = true
      if (result.error) {
        setMessage({ type: 'warn', text: result.error })
        setSaving(false)
        return
      }
      setMessage({ type: 'ok', text: 'Logo changed. Reloading to show it everywhere…' })
      setTimeout(() => window.location.reload(), 700)
    } catch (err) {
      setSaving(false)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not change the logo.' })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Shop name is required.' })
      return
    }
    const badPhone = [
      ['Contact number', form.shopPhone],
      ['Owner phone number', form.ownerPhone],
      ['WhatsApp number', form.whatsapp],
    ].find(([, v]) => !isPhoneOk(v))
    if (badPhone) {
      setMessage({ type: 'error', text: `${badPhone[0]} looks incomplete. Enter a 10-digit mobile number.` })
      return
    }

    setSaving(true)
    const result = await saveBrandSettings(form)
    setSaving(false)
    saved.current = true
    if (result.error) {
      setMessage({ type: 'warn', text: result.error })
      return
    }
    setMessage({ type: 'ok', text: 'Saved. Reloading to show the new details everywhere…' })
    setTimeout(() => window.location.reload(), 900)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`${card} !py-5 flex items-center gap-4`}>
        <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <Settings2 size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-tight text-[#111111]">Shop Settings</h2>
          <p className="text-[13px] font-medium text-[#4B5563]">
            Update the shop profile, logo, colours and stock alerts used across the POS and invoices.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Left column */}
        <div className="space-y-6">
          <section className={card}>
            <SectionTitle icon={<Palette size={18} />} title="Appearance" />
            <p className="text-[13px] font-medium text-[#4B5563] mb-5">
              One accent colour drives the whole app — POS, storefront, invoice headers and the installed app.
            </p>
            {([['Greys', GREY_SWATCHES], ['Colours', ACCENT_SWATCHES]] as const).map(([group, swatches]) => (
              <div key={group} className="mb-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">{group}</p>
                <div className="flex flex-wrap gap-2.5">
                  {swatches.map((hex) => {
                    const active = form.accentColor.toUpperCase() === hex
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => pickAccent(hex)}
                        title={hex}
                        aria-label={`Accent colour ${hex}`}
                        aria-pressed={active}
                        className={`h-9 w-9 rounded-lg transition-transform hover:scale-110 ${active ? 'ring-2 ring-offset-2 ring-[#111111]' : ''}`}
                        style={{ background: hex }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <label className="relative h-10 w-14 rounded-xl overflow-hidden cursor-pointer border border-gray-200" style={{ background: form.accentColor }}>
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) => pickAccent(e.target.value.toUpperCase())}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Custom accent colour"
                />
              </label>
              <input
                className={`${inputBase} !w-40 px-4 font-black uppercase tracking-wider`}
                value={hexDraft}
                onChange={(e) => handleHexInput(e.target.value)}
                maxLength={7}
                aria-label="Accent colour hex code"
              />
              <button type="button" onClick={() => pickAccent(DEFAULT_ACCENT)} className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563] underline underline-offset-4 hover:text-[#111111]">
                Reset
              </button>
            </div>
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <div className="bg-primary text-primary-ink text-center px-4 py-5">
                <p className="text-sm font-black uppercase tracking-tight">Card Preview</p>
                <p className="text-[12px] font-semibold opacity-80">Buttons, links, totals and invoice headers use this colour.</p>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-white">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-primary px-4 py-2 text-[10px] font-bold uppercase text-primary-ink">Button</span>
                  <span className="text-[13px] font-bold text-primary">Accent link</span>
                </div>
                <span className="rounded-lg bg-primary-100 px-3 py-1.5 text-[12px] font-black text-primary">Total ₹1,250</span>
              </div>
            </div>
          </section>

          <section className={card}>
            <SectionTitle icon={<BellRing size={18} />} title="Stock Alerts" />
            <p className="text-[13px] font-medium text-[#4B5563] mb-5">
              Choose how this device warns you when products run low or go out of stock.
            </p>
            <div className="space-y-3">
              <ToggleRow
                icon={<BellRing size={18} />}
                title="Low-stock notification"
                text="Show a popup when items reach their low-stock alert level."
                checked={stockNotify}
                onChange={setStockNotify}
              />
              <ToggleRow
                icon={stockSound ? <Volume2 size={18} /> : <VolumeX size={18} />}
                title="Alert sound"
                text="Play the alarm sound with the popup."
                checked={stockSound}
                disabled={!stockNotify}
                onChange={setStockSound}
              />
            </div>
            <button
              type="button"
              onClick={() => { alarmSound.startAlert(); setTimeout(() => alarmSound.stopAlert(), 1600) }}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-gray-200 px-4 text-[10px] font-bold uppercase tracking-wider text-[#374151] hover:bg-gray-50"
            >
              <Volume2 size={15} /> Test sound
            </button>
          </section>
        </div>

        {/* Right column */}
        <form onSubmit={handleSubmit} className={card}>
          <SectionTitle icon={<Store size={18} />} title="Shop Profile" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5 mt-5">
            <div>
              <span className={label}>Shop owner name</span>
              <IconInput icon={<User size={17} />} value={form.ownerName} onChange={set('ownerName')} maxLength={60} />
            </div>
            <div>
              <span className={label}>Shop name</span>
              <IconInput icon={<Store size={17} />} value={form.name} onChange={set('name')} required maxLength={60} />
            </div>
            <div>
              <span className={label}>Contact number</span>
              <IconInput icon={<Phone size={17} />} value={form.shopPhone} onChange={set('shopPhone')} inputMode="tel" placeholder="98765 43210" />
            </div>
            <div>
              <span className={label}>Email ID</span>
              <IconInput icon={<Mail size={17} />} type="email" value={form.email} onChange={set('email')} placeholder="shop@example.com" />
            </div>
            <div>
              <span className={label}>Owner phone number</span>
              <IconInput icon={<Phone size={17} />} value={form.ownerPhone} onChange={set('ownerPhone')} inputMode="tel" placeholder="98765 43210" />
            </div>
            <div>
              <span className={label}>WhatsApp number</span>
              <IconInput icon={<MessageCircle size={17} />} value={form.whatsapp} onChange={set('whatsapp')} inputMode="tel" placeholder="Same as contact number" />
            </div>
            <div className="sm:col-span-2">
              <span className={label}>Shop address</span>
              <div className="relative">
                <MapPin size={17} className="pointer-events-none absolute left-4 top-4 text-gray-400" />
                <textarea
                  className={`${inputBase} h-auto min-h-[76px] pl-11 pr-4 py-3 resize-y`}
                  value={form.address}
                  onChange={(e) => set('address')(e.target.value)}
                  rows={2}
                  maxLength={240}
                />
              </div>
            </div>
            <div>
              <span className={label}>City / location</span>
              <IconInput icon={<MapPin size={17} />} value={form.city} onChange={set('city')} maxLength={80} placeholder="e.g. Aruppukottai, Tamil Nadu" />
            </div>
            <div>
              <span className={label}>Business hours</span>
              <IconInput icon={<Clock size={17} />} value={form.businessHours} onChange={set('businessHours')} maxLength={80} placeholder="e.g. Open Daily, 10 AM – 9 PM" />
            </div>
            <div>
              <span className={label}>Shop name (Tamil)</span>
              <IconInput icon={<Languages size={17} />} value={form.nameTa} onChange={set('nameTa')} maxLength={60} />
            </div>
            <div>
              <span className={label}>Instagram ID</span>
              <IconInput icon={<AtSign size={17} />} value={form.instagram} onChange={set('instagram')} placeholder="naayan.official" />
            </div>
            <div>
              <span className={label}>GSTIN (on GST invoices)</span>
              <IconInput icon={<Hash size={17} />} value={form.gstin} onChange={(v) => set('gstin')(v.toUpperCase())} maxLength={15} placeholder="Optional" />
            </div>
          </div>

          <div className="border-t border-gray-200 my-7" />

          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#374151] mb-3">
            <ImageIcon size={16} /> Shop logo
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
              <img src={form.logo || DEFAULT_LOGO} alt="Shop logo" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2.5 mb-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-ink text-[10px] font-bold uppercase tracking-wide hover:bg-primary-hover"
                >
                  <Upload size={15} /> Upload logo
                </button>
                {form.logo && (
                  <button
                    type="button"
                    onClick={() => set('logo')('')}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-gray-100 text-[#111111] text-[10px] font-bold uppercase tracking-wide hover:bg-gray-200"
                  >
                    <Trash2 size={15} /> Reset logo
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogo} />
              </div>
              <p className="text-[12px] font-medium text-gray-500">
                PNG or JPG, auto-resized to 512px. Used on the store page, invoices, receipts and the sidebar.
              </p>
            </div>
          </div>

          <p className="mt-6 mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Or choose a ready-made logo</p>
          <p className="mb-3 text-[12px] font-medium text-gray-500">Tap one to use it everywhere — sidebar, login, invoices, receipts and the browser tab. Your uploaded logo can be changed any time.</p>
          <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
            {[{ url: '', label: 'Default NAAYAN logo' }, ...LOGO_OPTIONS.map((url, i) => ({ url, label: `Logo option ${i + 1}` }))].map(({ url, label: text }) => {
              const active = !url && !form.logo
              return (
                <button
                  key={url || 'default'}
                  type="button"
                  disabled={saving}
                  onClick={() => void applyPresetLogo(url)}
                  title={text}
                  aria-label={text}
                  className={`relative aspect-square overflow-hidden rounded-xl border bg-white transition-transform hover:scale-[1.04] disabled:opacity-60 ${active ? 'border-primary ring-2 ring-primary' : 'border-gray-200'}`}
                >
                  <img src={url || DEFAULT_LOGO} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {!url && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[8px] font-bold uppercase tracking-wider text-white">Default</span>}
                </button>
              )
            })}
          </div>

          <div className="border-t border-gray-200 my-7" />

          {message && (
            <div
              className={`mb-4 flex items-start gap-2 rounded-xl px-3.5 py-3 text-[13px] font-bold ${
                message.type === 'ok' ? 'bg-[#ECFDF5] text-[#047857]' : message.type === 'warn' ? 'bg-[#FFFBEB] text-[#92400E]' : 'bg-[#FEF2F2] text-[#991B1B]'
              }`}
            >
              {message.type === 'ok' ? <CheckCircle2 size={17} className="shrink-0" /> : <AlertCircle size={17} className="shrink-0" />}
              {message.text}
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-[#111111] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-black disabled:opacity-60"
          >
            <Save size={17} /> {saving ? 'Saving…' : 'Save shop details'}
          </button>
        </form>
      </div>

    </div>
  )
}

function ToggleRow({ icon, title, text, checked, disabled = false, onChange }: {
  icon: React.ReactNode
  title: string
  text: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[#111111]">{icon}</span>
        <div className="min-w-0">
          <p className="text-[14px] font-black text-[#111111]">{title}</p>
          <p className="text-[12px] font-medium text-gray-500">{text}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${checked ? 'bg-primary' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  )
}

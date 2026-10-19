import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Save, Store, User, Phone, Mail, MapPin, AtSign, Upload, Trash2, CheckCircle2, AlertCircle,
  Settings2, Palette, Image as ImageIcon, Package, Plus, Languages, Sparkles, MessageCircle,
} from 'lucide-react'
import {
  BRAND_SETTINGS, DEFAULT_ACCENT, DEFAULT_LOGO, applyAccentColor, isValidAccent, toE164, type BrandSettings,
} from '../../lib/brand'
import { saveBrandSettings } from '../../services/brandSettingsService'
import { inventoryService, type CategoryRecord } from '../../services/inventoryService'
import { useProductStore } from '../../store/store'
import { formatCurrency } from '../../lib/retail'
import AddProductModal from '../AddProductModal'

const card = 'bg-white rounded-[22px] border border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] p-5 sm:p-7'
const label = 'block text-[11px] font-black uppercase tracking-[0.12em] text-[#4B5563] mb-2'
const inputBase =
  'w-full h-12 bg-white border border-gray-200 rounded-xl text-[15px] font-semibold text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition'
const LOGO_MAX_PX = 512

const ACCENT_SWATCHES = [
  '#3F3F46', '#31042F', '#7F1D3A', '#9F1239', '#B91C1C', '#C2410C', '#A16207', '#15803D', '#047857',
  '#0F766E', '#0E7490', '#1D4ED8', '#4338CA', '#6D28D9', '#7E22CE', '#A21CAF', '#BE185D', '#475569', '#1C1917',
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

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; action?: React.ReactNode }> = ({ icon, title, action }) => (
  <div className="flex items-center justify-between gap-3 mb-1">
    <h3 className="flex items-center gap-2.5 text-[14px] font-black uppercase tracking-[0.16em] text-[#111111]">
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

export const ShopSettingsView: React.FC<{ onOpenInventory?: () => void }> = ({ onOpenInventory }) => {
  const [form, setForm] = useState<BrandSettings>({ ...BRAND_SETTINGS })
  const [hexDraft, setHexDraft] = useState(BRAND_SETTINGS.accentColor)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = useRef(false)

  const { products, fetchProducts } = useProductStore()
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const set = (key: keyof BrandSettings) => (v: string) => setForm((f) => ({ ...f, [key]: v }))

  // Live preview of the accent colour; undo it if the page is left without saving
  useEffect(() => { applyAccentColor(form.accentColor) }, [form.accentColor])
  useEffect(() => () => { if (!saved.current) applyAccentColor(BRAND_SETTINGS.accentColor) }, [])

  const loadCategories = () =>
    inventoryService.fetchCategories().then(setCategories).catch((err) => {
      setCatalogError(err instanceof Error ? err.message : 'Could not load categories.')
    })

  useEffect(() => {
    void loadCategories()
    if (products.length === 0) void fetchProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleAddCategory = async () => {
    const name = newCategory.trim()
    if (!name) return
    setCatalogError('')
    try {
      await inventoryService.createCategory({ name_en: name, is_active: true })
      setNewCategory('')
      await loadCategories()
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Could not add the category.')
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

  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className={`${card} !py-5 flex items-center gap-4`}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <Settings2 size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[18px] font-black uppercase tracking-tight text-[#111111]">Shop Settings</h2>
          <p className="text-[13px] font-medium text-[#4B5563]">
            Update the shop profile, logo and product catalogue used across the POS, invoices and the public store page.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-7 items-start">
        {/* Left column */}
        <div className="space-y-7">
          <section className={card}>
            <SectionTitle icon={<Palette size={18} />} title="Appearance" />
            <p className="text-[13px] font-medium text-[#4B5563] mb-5">
              One accent colour drives the whole app — POS, storefront, invoice headers and the installed app.
            </p>
            <div className="flex flex-wrap gap-2.5 mb-5">
              {ACCENT_SWATCHES.map((hex) => {
                const active = form.accentColor.toUpperCase() === hex
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => pickAccent(hex)}
                    title={hex}
                    aria-label={`Accent colour ${hex}`}
                    className={`h-9 w-9 rounded-lg transition-transform hover:scale-110 ${active ? 'ring-2 ring-offset-2 ring-[#111111]' : ''}`}
                    style={{ background: hex }}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <label className="relative h-12 w-14 rounded-xl overflow-hidden cursor-pointer border border-gray-200" style={{ background: form.accentColor }}>
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
              <button type="button" onClick={() => pickAccent(DEFAULT_ACCENT)} className="text-[12px] font-black uppercase tracking-wider text-[#4B5563] underline underline-offset-4 hover:text-[#111111]">
                Reset
              </button>
            </div>
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <div className="bg-primary text-primary-ink text-center px-4 py-5">
                <p className="text-[16px] font-black uppercase tracking-tight">Card Preview</p>
                <p className="text-[12px] font-semibold opacity-80">Buttons, links, totals and invoice headers use this colour.</p>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-white">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-primary px-4 py-2 text-[12px] font-black uppercase text-primary-ink">Button</span>
                  <span className="text-[13px] font-bold text-primary">Accent link</span>
                </div>
                <span className="rounded-lg bg-primary-100 px-3 py-1.5 text-[12px] font-black text-primary">Total ₹1,250</span>
              </div>
            </div>
          </section>

          <section className={card}>
            <SectionTitle
              icon={<Package size={18} />}
              title="Product Catalogue"
              action={onOpenInventory && (
                <button type="button" onClick={onOpenInventory} className="text-[11px] font-black uppercase tracking-[0.14em] text-[#111111] hover:text-primary">
                  Full inventory view
                </button>
              )}
            />
            <p className={`${label} mt-5`}>Categories</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {categories.length === 0 && <span className="text-[13px] font-medium text-gray-400">No categories yet.</span>}
              {categories.map((c) => (
                <span key={c.id} className="rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-[12px] font-black uppercase tracking-wide text-primary">
                  {c.name_en}
                </span>
              ))}
            </div>
            <div className="flex gap-3 mb-2">
              <input
                className={`${inputBase} px-4`}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCategory() } }}
                placeholder="e.g. Shirts"
              />
              <button type="button" onClick={() => void handleAddCategory()} className="inline-flex shrink-0 items-center gap-1.5 h-12 px-5 rounded-xl bg-[#111111] text-white text-[13px] font-black uppercase hover:bg-black">
                <Plus size={16} /> Add
              </button>
            </div>
            {catalogError && <p className="text-[12px] font-bold text-[#B91C1C] mb-2">{catalogError}</p>}

            <div className="border-t border-gray-200 my-6" />
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-primary text-primary-ink text-[13px] font-black uppercase tracking-wide shadow-md hover:bg-primary-hover"
            >
              <Plus size={17} /> Add to catalogue
            </button>
            <div className="mt-5 max-h-[420px] overflow-y-auto pr-1 space-y-2.5">
              {sortedProducts.length === 0 && (
                <p className="text-center text-[13px] font-medium text-gray-400 py-6">No products yet.</p>
              )}
              {sortedProducts.map((p) => (
                <div key={String(p.id)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-black text-[#111111]">{p.name}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {p.category || 'Uncategorised'} • Stock {p.stockQuantity ?? p.stock ?? 0}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[13px] font-black text-[#111111]">{formatCurrency(p.offerPrice || p.price)}</span>
                    {p.isActive && <CheckCircle2 size={16} className="text-[#10B981]" aria-label="Active" />}
                  </div>
                </div>
              ))}
            </div>
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
            <div className="sm:col-span-2">
              <span className={label}>Tagline / sub-heading</span>
              <IconInput icon={<Sparkles size={17} />} value={form.tagline} onChange={set('tagline')} maxLength={90} placeholder="e.g. Mens Wear • Womens Wear • Kids Wear" />
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
              <span className={label}>Shop name (Tamil)</span>
              <IconInput icon={<Languages size={17} />} value={form.nameTa} onChange={set('nameTa')} maxLength={60} />
            </div>
            <div>
              <span className={label}>Instagram ID</span>
              <IconInput icon={<AtSign size={17} />} value={form.instagram} onChange={set('instagram')} placeholder="naayan.official" />
            </div>
          </div>

          <div className="border-t border-gray-200 my-7" />

          <p className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.14em] text-[#374151] mb-3">
            <ImageIcon size={16} /> Shop logo
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <div className="h-24 w-24 shrink-0 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
              <img src={form.logo || DEFAULT_LOGO} alt="Shop logo" className="h-full w-full object-contain rounded-xl" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2.5 mb-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-ink text-[12px] font-black uppercase tracking-wide hover:bg-primary-hover"
                >
                  <Upload size={15} /> Upload logo
                </button>
                {form.logo && (
                  <button
                    type="button"
                    onClick={() => set('logo')('')}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-gray-100 text-[#111111] text-[12px] font-black uppercase tracking-wide hover:bg-gray-200"
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
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-[#111111] text-white text-[13px] font-black uppercase tracking-wide hover:bg-black disabled:opacity-60"
          >
            <Save size={17} /> {saving ? 'Saving…' : 'Save shop details'}
          </button>
        </form>
      </div>

      <AddProductModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => { setAddOpen(false); void fetchProducts(); void loadCategories() }}
      />
    </div>
  )
}

import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Save, Store, User, Phone, Mail, MapPin, AtSign, Upload, Trash2, CheckCircle2, AlertCircle,
  Settings2, Palette, Image as ImageIcon, Package, Plus, Languages, Sparkles, MessageCircle, Clock, Scissors, Hash, Check, Pencil,
} from 'lucide-react'
import {
  BRAND_SETTINGS, DEFAULT_ACCENT, DEFAULT_LOGO, applyAccentColor, isValidAccent, toE164, type BrandSettings,
} from '../../lib/brand'
import { saveBrandSettings } from '../../services/brandSettingsService'
import { inventoryService, type CategoryRecord } from '../../services/inventoryService'
import { useProductStore } from '../../store/store'
import { formatCurrency } from '../../lib/retail'
import AddProductModal from '../AddProductModal'
import { db } from '../../lib/db'
import { confirmDelete } from '../../lib/confirmDelete'

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
  const [quick, setQuick] = useState({ type: 'product' as 'product' | 'service', name: '', category: '', price: '', cost: '', stock: '', alert: '', offer: '' })
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickError, setQuickError] = useState('')

  const quickAdd = async () => {
    const price = Number(quick.price)
    if (!quick.name.trim()) { setQuickError('Enter an item name.'); return }
    if (!price || price <= 0) { setQuickError('Enter a price greater than 0.'); return }
    const offerPct = Number(quick.offer)
    setQuickSaving(true)
    setQuickError('')
    try {
      const categoryName = quick.category.trim() || (quick.type === 'service' ? 'Services' : 'General')
      let categoryId: number | null = categories.find((c) => c.name_en.toLowerCase() === categoryName.toLowerCase())?.id ?? null
      if (categoryId === null) categoryId = (await inventoryService.createCategory({ name_en: categoryName, is_active: true })).id
      const stock = quick.type === 'service' ? 0 : Math.max(0, parseInt(quick.stock) || 0)
      const { error: err } = await db.from('products').insert({
        name: quick.name.trim(),
        category: categoryName,
        category_id: categoryId,
        item_type: quick.type,
        price,
        offer_price: offerPct > 0 && offerPct < 100 ? Math.round(price * (1 - offerPct / 100) * 100) / 100 : null,
        purchase_price: Number(quick.cost) || 0,
        stock,
        stock_quantity: stock,
        low_stock_alert: quick.type === 'service' ? 0 : Math.max(0, parseInt(quick.alert) || 5),
        is_active: true,
        unit: quick.type === 'service' ? 'service' : '1pc',
        base_quantity: 1,
        unit_type: 'unit',
        unit_label: quick.type === 'service' ? 'service' : 'pc',
      })
      if (err) throw new Error(err.message)
      setQuick((q) => ({ ...q, name: '', price: '', cost: '', stock: '', alert: '', offer: '' }))
      await Promise.all([fetchProducts(true), loadCategories()])
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : 'Could not add the item.')
    } finally {
      setQuickSaving(false)
    }
  }

  const toggleActive = async (id: string | number, active: boolean) => {
    const { error: err } = await db.from('products').update({ is_active: active }).eq('id', id)
    if (err) setCatalogError(err.message)
    else void fetchProducts(true)
  }

  const removeItem = async (id: string | number, name: string) => {
    const ok = await confirmDelete({
      title: `Permanently Delete “${name}”`,
      warning: 'This catalogue item will be deleted from the catalogue and inventory in the Neon database.',
      impact: [
        { label: 'Item', value: name },
        { label: 'Billing Panel', value: 'Removed immediately', tone: 'danger' },
        { label: 'Past Bills', value: 'Kept unchanged', tone: 'success' },
      ],
    })
    if (!ok) return
    try {
      await inventoryService.deleteInventoryItem(Number(id), null)
      void fetchProducts(true)
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : 'Could not delete the item.')
    }
  }

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
    <div className="space-y-6">
      {/* Header */}
      <div className={`${card} !py-5 flex items-center gap-4`}>
        <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <Settings2 size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-tight text-[#111111]">Shop Settings</h2>
          <p className="text-[13px] font-medium text-[#4B5563]">
            Update the shop profile, logo and product catalogue used across the POS, invoices and the public store page.
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
                <span key={c.id} className="rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
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
              <button type="button" onClick={() => void handleAddCategory()} className="inline-flex shrink-0 items-center gap-1.5 h-10 px-5 rounded-xl bg-[#111111] text-white text-[10px] font-bold uppercase hover:bg-black">
                <Plus size={16} /> Add
              </button>
            </div>
            {catalogError && <p className="text-[12px] font-bold text-[#B91C1C] mb-2">{catalogError}</p>}

            <div className="border-t border-gray-200 my-6" />
            <p className={label}>Add catalogue item</p>
            <form onSubmit={(e) => { e.preventDefault(); void quickAdd() }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {(['product', 'service'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setQuick((q) => ({ ...q, type: t }))}
                    className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors ${quick.type === t ? 'border-primary bg-primary text-primary-ink' : 'border-gray-200 bg-white text-[#374151] hover:bg-gray-50'}`}>
                    {t === 'product' ? <Package size={16} /> : <Scissors size={16} />} {t}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-[1.4fr_1.4fr_1fr_1fr] gap-3">
                <input className={`${inputBase} px-4`} value={quick.name} onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))} placeholder="Item name" aria-label="Item name" />
                <input className={`${inputBase} px-4`} value={quick.category} onChange={(e) => setQuick((q) => ({ ...q, category: e.target.value }))} placeholder="Category" aria-label="Category" list="settings-categories" />
                <input className={`${inputBase} px-4`} value={quick.price} onChange={(e) => setQuick((q) => ({ ...q, price: e.target.value }))} placeholder="Price" aria-label="Price" inputMode="decimal" />
                <input className={`${inputBase} px-4`} value={quick.cost} onChange={(e) => setQuick((q) => ({ ...q, cost: e.target.value }))} placeholder="Cost" aria-label="Cost price" inputMode="decimal" />
              </div>
              <datalist id="settings-categories">{categories.map((c) => <option key={c.id} value={c.name_en} />)}</datalist>
              <div className="grid grid-cols-3 gap-3 sm:w-2/3">
                {quick.type === 'product' && (
                  <>
                    <label className="block"><span className="sr-only">Stock</span>
                      <input className={`${inputBase} px-4`} value={quick.stock} onChange={(e) => setQuick((q) => ({ ...q, stock: e.target.value }))} placeholder="Stock" title="Opening stock" inputMode="numeric" /></label>
                    <label className="block"><span className="sr-only">Low stock alert</span>
                      <input className={`${inputBase} px-4`} value={quick.alert} onChange={(e) => setQuick((q) => ({ ...q, alert: e.target.value }))} placeholder="Alert at" title="Low stock alert" inputMode="numeric" /></label>
                  </>
                )}
                <label className="block"><span className="sr-only">Offer %</span>
                  <input className={`${inputBase} px-4`} value={quick.offer} onChange={(e) => setQuick((q) => ({ ...q, offer: e.target.value }))} placeholder="Offer %" inputMode="decimal" /></label>
              </div>
              {quickError && <p className="text-[12px] font-bold text-[#B91C1C]">{quickError}</p>}
              <button type="submit" disabled={quickSaving} className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-ink text-[10px] font-bold uppercase tracking-wider shadow-md hover:bg-primary-hover disabled:opacity-60">
                <Plus size={17} /> {quickSaving ? 'Adding…' : 'Add to catalogue'}
              </button>
              <button type="button" onClick={() => setAddOpen(true)} className="w-full text-center text-[10px] font-bold uppercase tracking-wide text-gray-500 hover:text-[#111111]">
                More fields (GST, HSN, description) →
              </button>
            </form>

            <div className="border-t border-gray-200 my-6" />
            <div className="max-h-[460px] overflow-y-auto pr-1 space-y-2.5">
              {sortedProducts.length === 0 && (
                <p className="text-center text-[13px] font-medium text-gray-400 py-6">No products yet.</p>
              )}
              {sortedProducts.map((p) => (
                <div key={String(p.id)} className={`flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 ${p.isActive ? '' : 'opacity-60'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-black text-[#111111]">{p.name}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {p.category || 'Uncategorised'} • {p.itemType === 'service' ? 'Service' : `Stock ${p.stockQuantity ?? p.stock ?? 0} (alert < ${p.lowStockAlert ?? 5})`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="mr-1 font-mono text-[13px] font-black text-[#111111]">{formatCurrency(p.offerPrice || p.price)}</span>
                    <button type="button" onClick={() => void toggleActive(p.id, !p.isActive)} title={p.isActive ? 'Active — click to hide from billing' : 'Hidden — click to activate'} aria-label={p.isActive ? 'Deactivate' : 'Activate'}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 ${p.isActive ? 'text-[#10B981]' : 'text-gray-300'}`}>
                      <Check size={17} strokeWidth={2.5} />
                    </button>
                    {onOpenInventory && (
                      <button type="button" onClick={onOpenInventory} title="Edit in inventory" aria-label="Edit in inventory" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#111111]">
                        <Pencil size={15} />
                      </button>
                    )}
                    <button type="button" onClick={() => void removeItem(p.id, p.name)} title="Delete" aria-label={`Delete ${p.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-[#DC2626]">
                      <Trash2 size={15} />
                    </button>
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
            <div className="sm:col-span-2">
              <span className={label}>Catalogue headline / services</span>
              <div className="relative">
                <Scissors size={17} className="pointer-events-none absolute left-4 top-4 text-gray-400" />
                <textarea
                  className={`${inputBase} h-auto min-h-[76px] pl-11 pr-4 py-3 resize-y`}
                  value={form.catalogueHeadline}
                  onChange={(e) => set('catalogueHeadline')(e.target.value)}
                  rows={2}
                  maxLength={240}
                  placeholder="e.g. Mens Wear • Womens Wear • Kids Wear • Alterations"
                />
              </div>
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

      <AddProductModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => { setAddOpen(false); void fetchProducts(); void loadCategories() }}
      />
    </div>
  )
}

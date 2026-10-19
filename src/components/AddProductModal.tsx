import React, { useEffect, useState } from 'react'
import { X, Package, Scissors, PackagePlus, Tag } from 'lucide-react'
import { useProductStore } from '../store/store'
import { db } from '../lib/db'

type ItemType = 'product' | 'service'

interface AddProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  /** Which tab the dialog opens on */
  initialType?: ItemType
}

const emptyForm = {
  name: '',
  description: '',
  category: '',
  lowStockAlert: '0',
  price: '',
  cost: '',
  stock: '0',
  gst: '5',
  hsn: '',
  offerPercent: '',
  offerPrice: '',
  active: true,
}

const label = 'mb-2 block text-[12.5px] font-black uppercase tracking-[0.1em] text-[#374151]'
const input =
  'h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-[15px] font-semibold text-[#111111] placeholder:font-medium placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15'
const help = 'mt-1.5 text-[11.5px] font-medium leading-snug text-gray-400'

const round2 = (n: number) => Math.round(n * 100) / 100

export default function AddProductModal({ isOpen, onClose, onSuccess, initialType = 'product' }: AddProductModalProps) {
  const { fetchProducts, products } = useProductStore()
  const [itemType, setItemType] = useState<ItemType>(initialType)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const isService = itemType === 'service'

  const existingCategories = categoryOptions.length > 0
    ? categoryOptions
    : Array.from(new Set(products.filter(p => p.category).map(p => p.category))).filter(Boolean).sort()

  useEffect(() => {
    if (!isOpen) return
    setItemType(initialType)
    setForm(emptyForm)
    setError('')
    let cancelled = false
    void db.from('categories').select('name_en').eq('is_active', true).order('sort_order').then(({ data }) => {
      if (!cancelled) setCategoryOptions((data || []).map(row => String(row.name_en || '')).filter(Boolean))
    })
    return () => { cancelled = true }
  }, [isOpen, initialType])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const set = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  // Offer % and offer price stay in step with each other and with the price
  const setOfferPercent = (v: string) => {
    const price = Number(form.price) || 0
    const pct = Number(v)
    setForm(f => ({ ...f, offerPercent: v, offerPrice: v && price > 0 && pct > 0 && pct < 100 ? String(round2(price * (1 - pct / 100))) : '' }))
  }
  const setOfferPrice = (v: string) => {
    const price = Number(form.price) || 0
    const op = Number(v)
    setForm(f => ({ ...f, offerPrice: v, offerPercent: v && price > 0 && op > 0 && op < price ? String(round2((1 - op / price) * 100)) : '' }))
  }
  const setPrice = (v: string) => {
    const price = Number(v) || 0
    const pct = Number(form.offerPercent)
    setForm(f => ({ ...f, price: v, offerPrice: price > 0 && pct > 0 && pct < 100 ? String(round2(price * (1 - pct / 100))) : f.offerPrice }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const price = Number(form.price)
    if (!form.name.trim()) return setError(`${isService ? 'Service' : 'Product'} name is required`)
    if (!price || price <= 0) return setError('Price must be greater than 0')
    const offerPrice = Number(form.offerPrice)
    if (form.offerPrice && (offerPrice <= 0 || offerPrice >= price)) return setError('Offer price must be lower than the price')
    const gst = Number(form.gst || 0)
    if (gst < 0 || gst > 28) return setError('GST rate must be between 0 and 28%')

    setLoading(true)
    setError('')
    try {
      const categoryName = form.category.trim()
      let categoryId: string | number | null = null
      if (categoryName) {
        const { data: existingCategory, error: lookupError } = await db
          .from('categories').select('id').ilike('name_en', categoryName).maybeSingle()
        if (lookupError) throw lookupError
        categoryId = existingCategory?.id ?? null
        if (!existingCategory) {
          const { data: inserted, error: insertError } = await db
            .from('categories').insert({ name_en: categoryName, name_ta: '', is_active: true }).select('id').single()
          if (insertError) throw insertError
          categoryId = inserted?.id ?? null
        }
      }

      const stockNum = isService ? 0 : Math.max(0, parseInt(form.stock) || 0)
      const { data: newProd, error: dbErr } = await db
        .from('products')
        .insert({
          name: form.name.trim(),
          description: form.description.trim(),
          category: categoryName || (isService ? 'Services' : 'General'),
          category_id: categoryId,
          item_type: itemType,
          price,
          offer_price: form.offerPrice ? offerPrice : null,
          purchase_price: Number(form.cost) || 0,
          gst_percent: gst,
          hsn_code: form.hsn.trim(),
          stock: stockNum,
          stock_quantity: stockNum,
          low_stock_alert: isService ? 0 : Math.max(0, parseInt(form.lowStockAlert) || 0),
          is_active: form.active,
          unit: isService ? 'service' : '1pc',
          base_quantity: 1,
          unit_type: 'unit',
          unit_label: isService ? 'service' : 'pc',
        })
        .select('id')
        .single()
      if (dbErr) throw dbErr

      if (newProd && stockNum > 0) {
        await db.from('inventory_movements').insert({
          product_id: newProd.id,
          variant_id: null,
          movement_type: 'RESTOCK',
          quantity_delta: stockNum,
          quantity_before: 0,
          quantity_after: stockNum,
          reference_type: 'PRODUCT_CREATION',
          note: 'Initial received stock on product creation',
          created_by_name: 'Admin',
        })
      }

      await fetchProducts(true)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to add ${itemType}`)
    } finally {
      setLoading(false)
    }
  }

  const typeBtn = (type: ItemType, icon: React.ReactNode, text: string) => (
    <button
      type="button"
      onClick={() => setItemType(type)}
      aria-pressed={itemType === type}
      className={`inline-flex h-[52px] items-center justify-center gap-3 rounded-2xl border text-[15px] font-black uppercase tracking-[0.12em] transition-colors ${
        itemType === type ? 'border-primary bg-primary text-primary-ink' : 'border-gray-200 bg-white text-[#374151] hover:bg-gray-50'
      }`}
    >
      {icon} {text}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-title"
        className="flex max-h-[94dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl"
      >
        <div className="flex items-center gap-4 border-b border-gray-200 px-7 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><PackagePlus size={24} strokeWidth={1.75} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="add-item-title" className="text-[19px] font-black text-[#111111]">{isService ? 'Add New Service' : 'Add New Product'}</h2>
            <p className="text-[13px] font-medium text-gray-500">{isService ? 'Register a chargeable service' : 'Set pricing, stock and category for this item'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:text-[#111111]"><X size={20} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-7 py-6">
          <div>
            <p className={label}>Item type</p>
            <div className="grid grid-cols-2 gap-3">
              {typeBtn('product', <Package size={19} strokeWidth={1.75} />, 'Product')}
              {typeBtn('service', <Scissors size={19} strokeWidth={1.75} />, 'Service')}
            </div>
            <p className={help}>
              {isService
                ? 'Services = delivery, packing, add-ons and other chargeable work. No stock is tracked.'
                : 'Products = physical items sold. Stock and low-stock alerts are tracked.'}
            </p>
          </div>

          <label className="block">
            <span className={label}>{isService ? 'Service name' : 'Product name'} <span className="text-[#DC2626]">*</span></span>
            <input className={input} value={form.name} onChange={set('name')} autoFocus maxLength={120}
              placeholder={isService ? 'e.g., Alteration Charges / Delivery' : 'e.g., Cotton Shirt / Silk Saree'} />
          </label>

          <label className="block">
            <span className={label}>Description / notes (optional)</span>
            <input className={input} value={form.description} onChange={set('description')} maxLength={300}
              placeholder={isService ? 'e.g., Includes stitching and finishing' : 'e.g., Pure cotton, size 40, navy blue'} />
          </label>

          <div className={`grid gap-4 ${isService ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
            <label className="block">
              <span className={label}>Category</span>
              <input className={input} value={form.category} onChange={set('category')} list="add-item-categories" placeholder="e.g., Shirts, Sarees" />
              <datalist id="add-item-categories">{existingCategories.map(c => <option key={c} value={c} />)}</datalist>
              <p className={help}>Pick an existing category or type a new one (it will be added automatically)</p>
            </label>
            {!isService && (
              <label className="block">
                <span className={label}>Low stock alert</span>
                <input className={input} value={form.lowStockAlert} onChange={set('lowStockAlert')} inputMode="numeric" />
                <p className={help}>Warns you in Inventory when stock falls to this level.</p>
              </label>
            )}
          </div>

          <div className={`grid gap-4 ${isService ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <label className="block">
              <span className={label}>{isService ? 'Service price (₹)' : 'Original price (₹)'} <span className="text-[#DC2626]">*</span></span>
              <input className={input} value={form.price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
            </label>
            <label className="block">
              <span className={label}>Cost price (₹)</span>
              <input className={input} value={form.cost} onChange={set('cost')} inputMode="decimal" placeholder="0.00" />
            </label>
            {!isService && (
              <label className="block">
                <span className={label}>Current stock</span>
                <input className={input} value={form.stock} onChange={set('stock')} inputMode="numeric" />
              </label>
            )}
          </div>
          <p className={`${help} !-mt-2`}>Cost price is for your records only — it is never used in billing.</p>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className={label}>GST rate (%)</span>
              <input className={input} value={form.gst} onChange={set('gst')} inputMode="decimal" />
              <p className={help}>Pre-fills the GST % when this item is on a GST invoice.</p>
            </label>
            <label className="block">
              <span className={label}>HSN / SAC code</span>
              <input className={input} value={form.hsn} onChange={set('hsn')} placeholder="Optional" maxLength={12} />
            </label>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
            <p className="mb-4 flex items-center gap-2 text-[12.5px] font-black uppercase tracking-[0.1em] text-amber-800">
              <Tag size={16} strokeWidth={1.75} /> {isService ? 'Service offer' : 'Product special offer'} (automatic on billing)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-[12.5px] font-black uppercase tracking-[0.1em] text-amber-800">Offer discount (%)</span>
                <input className={`${input} !border-amber-200`} value={form.offerPercent} onChange={(e) => setOfferPercent(e.target.value)} inputMode="decimal" placeholder="e.g. 10" />
              </label>
              <label className="block">
                <span className="mb-2 block text-[12.5px] font-black uppercase tracking-[0.1em] text-amber-800">Discounted offer price (₹)</span>
                <input className={`${input} !border-amber-200`} value={form.offerPrice} onChange={(e) => setOfferPrice(e.target.value)} inputMode="decimal" placeholder="Offer Price" />
              </label>
            </div>
            <p className="mt-3 text-[11.5px] font-medium text-amber-800">
              Whenever this {isService ? 'service' : 'product'} is added to a bill, the offer price is applied automatically and shown on the invoice.
            </p>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-gray-200 px-5 py-4 text-[14.5px] font-bold text-[#374151]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))} className="h-5 w-5 rounded accent-[rgb(var(--primary))]" />
            Active (visible in Billing Panel)
          </label>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-[#B91C1C]">{error}</p>}
        </div>

        <div className="border-t border-gray-100 px-7 py-5">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-[54px] w-full items-center justify-center gap-3 rounded-2xl bg-primary text-[15px] font-black uppercase tracking-[0.14em] text-primary-ink shadow-md hover:bg-primary-hover disabled:opacity-60"
          >
            <PackagePlus size={19} strokeWidth={1.75} />
            {loading ? 'Saving…' : isService ? 'Save Service' : 'Save Product to Catalog'}
          </button>
        </div>
      </form>
    </div>
  )
}

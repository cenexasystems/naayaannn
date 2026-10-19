import React, { useState, useEffect, useCallback } from 'react'
import {
  Search,
  SlidersHorizontal,
  Printer,
  History,
  AlertTriangle,
  Package,
  Layers,
  RefreshCw,
  BarChart3,
  Tag,
  Box,
  Edit2,
  Trash2,
  Boxes,
  Download,
  Plus,
  ChevronDown,
  ScanBarcode,
} from 'lucide-react'
import { inventoryService, type InventoryStockItem } from '../../services/inventoryService'
import { CreateBarcodeModal } from '../barcode/CreateBarcodeModal'
import { BarcodePrintModal } from '../barcode/BarcodePrintModal'
import { AdjustStockModal } from './AdjustStockModal'
import { StockHistoryDrawer } from './StockHistoryDrawer'
import { QuickPriceModal } from './QuickPriceModal'
import { formatCurrency } from '../../lib/retail'
import { useProductStore, useAdminAuthStore } from '../../store/store'
import { useAlarmStore } from '../../store/alarmStore'
import { CategoryManagerView } from './CategoryManagerView'
import { InventoryAnalyticsView } from './InventoryAnalyticsView'
import { AddEditProductView } from './AddEditProductView'
import { confirmDelete } from '../../lib/confirmDelete'
import { downloadCsv } from '../../lib/exportCsv'
import AddProductModal from '../AddProductModal'

type InventoryTab = 'stock' | 'products' | 'categories' | 'analytics'

export const InventoryTable: React.FC = () => {
  const role = useAdminAuthStore((state) => state.role)
  const [activeTab, setActiveTab] = useState<InventoryTab>('stock')
  const { products: storeProducts, fetchProducts } = useProductStore()
  const [items, setItems] = useState<InventoryStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'in_stock' | 'low' | 'out'>('all')

  // Modals state
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [selectedForReceive, setSelectedForReceive] = useState<{ productId: number; variantId?: string | null } | null>(null)

  const [printModalItem, setPrintModalItem] = useState<InventoryStockItem | null>(null)
  const [adjustModalItem, setAdjustModalItem] = useState<InventoryStockItem | null>(null)
  const [historyDrawerItem, setHistoryDrawerItem] = useState<InventoryStockItem | null>(null)
  const [priceModalItem, setPriceModalItem] = useState<InventoryStockItem | null>(null)
  const [editProductId, setEditProductId] = useState<number | string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      void fetchProducts(true)
      const data = await inventoryService.fetchInventoryItems()
      setItems(data)

      // Alert sound and modal when viewing inventory with low stock
      const lowStockFlagged = data
        .filter((i) => i.is_active && i.stock <= (i.low_stock_threshold || 5))
        .map((i) => ({
          id: i.variant_id ? `v-${i.variant_id}` : `p-${i.product_id}`,
          name: i.name,
          variantName: i.variant_name || undefined,
          stock: i.stock,
          alertThreshold: i.low_stock_threshold || 5,
          barcode: i.barcode || undefined,
          category: i.category || undefined,
        }))

      // The store decides whether to sound: silenced items stay silent until a new low-stock item appears
      if (lowStockFlagged.length > 0) {
        useAlarmStore.getState().setLowStockItems(lowStockFlagged)
      }
    } catch (err) {
      console.error('Failed to load inventory items:', err)
    } finally {
      setLoading(false)
    }
  }, [fetchProducts])

  const handleDeleteItem = async (item: InventoryStockItem) => {
    const itemLabel = item.variant_name ? `${item.name} (${item.variant_name})` : item.name
    const ok = await confirmDelete({
      title: `Permanently Delete “${itemLabel}”`,
      subtitle: `Category: ${item.category || 'General'} • Stock: ${item.stock}`,
      warning: 'This item will be deleted from the catalogue and inventory in the Neon database.',
      impact: [
        { label: 'Item', value: itemLabel },
        { label: 'Stock on Hand', value: `${item.stock} unit(s) removed from inventory`, tone: 'danger' },
        { label: 'Selling Price', value: formatCurrency(item.price || 0) },
        { label: 'Past Bills', value: 'Kept unchanged', tone: 'success' },
      ],
    })
    if (!ok) return

    try {
      setLoading(true)
      await inventoryService.deleteInventoryItem(item.product_id, item.variant_id)
      await fetchProducts(true)
      await loadData()
    } catch (err) {
      console.error('Failed to delete inventory item:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete item')
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Filter items for Stock Management view
  const filtered = items.filter((item) => {
    const q = search.toLowerCase().trim()
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.variant_name && item.variant_name.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q))

    if (!matchesSearch) return false

    const threshold = item.low_stock_threshold || 5
    if (filterStatus === 'out') return item.stock <= 0
    if (filterStatus === 'low') return item.stock > 0 && item.stock <= threshold
    if (filterStatus === 'in_stock') return item.stock > threshold

    return true
  })

  // Summary Metrics
  const stocked = items
  const totalSkus = items.length
  const totalUnits = stocked.reduce((sum, i) => sum + i.stock, 0)
  const outOfStockCount = stocked.filter((i) => i.stock <= 0).length
  const lowStockCount = stocked.filter((i) => i.stock > 0 && i.stock <= (i.low_stock_threshold || 5)).length
  const inStockCount = stocked.filter((i) => i.stock > (i.low_stock_threshold || 5)).length
  // Only units on hand count; items missing a cost price contribute 0 to the cost valuation
  const sellingValuation = items.reduce((sum, i) => sum + Math.max(i.stock, 0) * (i.price || 0), 0)
  const costValuation = items.reduce((sum, i) => sum + Math.max(i.stock, 0) * (i.purchase_price || 0), 0)

  interface ProductOptionType {
    id: number
    name: string
    price: number
    cost_price?: number
    barcode?: string
    stock_quantity?: number
    category?: string
    has_variants?: boolean
  }

  // Combined product options for Barcode Generator intake
  const distinctProducts: ProductOptionType[] = Array.from(
    new Map<number, ProductOptionType>([
      ...storeProducts
        .filter((p) => p.isActive !== false && p.category?.trim().toLowerCase() !== 'unregistered')
        .map(
          (p): [number, ProductOptionType] => [
            Number(p.id),
            {
              id: Number(p.id),
              name: p.name,
              price: p.price,
              cost_price: p.purchasePrice || 0,
              barcode: p.barcode,
              stock_quantity: p.stockQuantity ?? p.stock ?? 0,
              category: p.category,
              has_variants: p.hasVariants,
            },
          ]
        ),
      ...items
        .filter((i) => i.category?.trim().toLowerCase() !== 'unregistered')
        .map(
          (i): [number, ProductOptionType] => [
            i.product_id,
            {
              id: i.product_id,
              name: i.name,
              price: i.price,
              cost_price: 0,
              barcode: i.barcode || undefined,
              stock_quantity: i.stock,
              category: i.category || undefined,
              has_variants: !!i.variant_id,
            },
          ]
        ),
    ]).values()
  )

  const exportInventoryCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Product', 'Variant', 'Category', 'Barcode', 'SKU', 'Stock', 'Low Stock Alert', 'Price', 'Offer Price', 'Cost Price', 'Active']
    const lines = filtered.map((i) => [
      i.name, i.variant_name || '', i.category || '', i.barcode || '', i.sku || '',
      i.stock, i.low_stock_threshold ?? '', i.price, i.offer_price ?? '', i.purchase_price ?? '', i.is_active ? 'Yes' : 'No',
    ].map(q).join(','))
    void downloadCsv(`Inventory_${new Date().toISOString().slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'))
  }

  const subTabs: Array<[InventoryTab, string]> = [['stock', 'Stock List'], ['products', 'Add / Edit Products'], ['categories', 'Categories'], ['analytics', 'Analytics & Reports']]
  const toolBtn = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-[10px] font-bold uppercase tracking-wider text-[#111111] transition-colors hover:bg-gray-50 cursor-pointer'
  const darkBtn = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-[10px] font-bold uppercase tracking-wider text-primary-ink shadow-sm transition-colors hover:bg-primary-hover cursor-pointer'
  const rowBtn = 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-[10px] font-bold uppercase tracking-wide text-[#374151] transition-colors hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-5 min-[1750px]:flex-row min-[1750px]:items-start min-[1750px]:justify-between">
        <div className="shrink-0">
          <h2 className="flex items-center gap-3 text-[28px] font-black leading-tight tracking-tight text-[#111111]">
            <Boxes size={36} strokeWidth={1.75} /> Inventory
          </h2>
          <p className="mt-1 text-xs font-semibold text-[#111111]">Manage products and categories — add, edit and delete.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 min-[1750px]:flex-nowrap">
          <label className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveTab('stock') }}
              placeholder="Search products..."
              aria-label="Search products"
              className="h-10 w-64 rounded-xl border border-gray-300 bg-white pl-11 pr-4 text-xs font-semibold text-[#111111] placeholder:text-gray-500 focus:border-primary focus:outline-none"
            />
          </label>
          <button type="button" onClick={exportInventoryCsv} className={toolBtn}><Download size={18} strokeWidth={1.75} /> Inventory CSV</button>
          <button type="button" onClick={() => setActiveTab(activeTab === 'categories' ? 'stock' : 'categories')} className={toolBtn}><Tag size={18} strokeWidth={1.75} /> Manage Categories</button>
          <button type="button" onClick={() => setAddOpen(true)} className={darkBtn}><Plus size={18} strokeWidth={2} /> Add Product</button>
        </div>
      </div>

      {/* Secondary views */}
      <div className="flex flex-wrap items-center gap-2">
        {subTabs.map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => { if (id === 'products') setEditProductId(null); setActiveTab(id) }}
            className={`h-10 rounded-xl px-4 text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${activeTab === id ? 'bg-primary text-primary-ink' : 'bg-gray-100 text-[#111111] hover:bg-gray-200'}`}
          >
            {text}
          </button>
        ))}
        {activeTab === 'stock' && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {([['all', `All (${totalSkus})`], ['in_stock', `In Stock (${inStockCount})`], ['low', `Low (${lowStockCount})`], ['out', `Out (${outOfStockCount})`]] as const).map(([id, text]) => (
              <button key={id} type="button" onClick={() => setFilterStatus(id)}
                className={`h-10 rounded-xl border px-3.5 text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${filterStatus === id ? 'border-primary bg-primary text-primary-ink' : 'border-gray-200 bg-white text-[#374151] hover:bg-gray-50'}`}>
                {text}
              </button>
            ))}
            <button type="button" onClick={() => void loadData()} title="Refresh" aria-label="Refresh" className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-[#111111] cursor-pointer">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {role === 'admin' && (
              <button type="button" onClick={() => { setSelectedForReceive(null); setShowReceiveModal(true) }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-[10px] font-bold uppercase tracking-wide text-[#111111] hover:bg-gray-50 cursor-pointer" title="Generate & print barcodes">
                <Printer size={15} /> Add Barcode
              </button>
            )}
          </div>
        )}
      </div>

      {/* STOCK LIST */}
      {activeTab === 'stock' && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {loading && items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center text-[13px] font-bold text-gray-400">
              <RefreshCw size={24} className="mb-2 animate-spin" /> Loading inventory items...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-[13px] font-bold text-gray-400">No inventory items match your search or filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-5 text-[10px] font-bold uppercase tracking-wider text-[#111111]">Product</th>
                    <th className="px-4 py-5 text-[10px] font-bold uppercase tracking-wider text-[#111111]">Barcode</th>
                    <th className="px-4 py-5 text-center text-[10px] font-bold uppercase tracking-wider text-[#111111]">Stock</th>
                    <th className="px-4 py-5 text-[10px] font-bold uppercase tracking-wider text-[#111111]">Price</th>
                    <th className="px-4 py-5 text-right text-[10px] font-bold uppercase tracking-wider text-[#111111]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const open = expandedId === item.id
                    const threshold = item.low_stock_threshold || 5
                    const stockTone = item.stock <= 0 ? 'text-[#DC2626]' : item.stock <= threshold ? 'text-amber-600' : 'text-[#111111]'
                    return (
                      <React.Fragment key={item.id}>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <button type="button" onClick={() => setExpandedId(open ? null : item.id)} aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-pointer">
                                <ChevronDown size={17} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                              </button>
                              <div className="min-w-0">
                                <span className="text-sm font-black text-[#111111]">{item.name}</span>
                                {item.variant_name ? (
                                  <span className="ml-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-black text-[#374151]">Size: {item.variant_name}</span>
                                ) : (
                                  <button type="button" onClick={() => setExpandedId(open ? null : item.id)} className="ml-2 text-[11.5px] font-bold text-[#111111] hover:underline cursor-pointer">▾ Open in detail</button>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            {item.barcode ? (
                              <span className="inline-block rounded-md bg-gray-100 px-2 py-1 font-mono text-[12px] font-bold text-gray-800">{item.barcode}</span>
                            ) : (
                              <span className="text-[11px] italic text-gray-400">No Barcode</span>
                            )}
                          </td>
                          <td className={`px-4 py-4 text-center text-sm font-black tabular-nums ${stockTone}`}>{item.stock}</td>
                          <td className="px-4 py-4">
                            <button type="button" onClick={() => setPriceModalItem(item)} title="Quick edit price" className="text-sm font-black tabular-nums text-[#111111] hover:underline cursor-pointer">
                              {formatCurrency(item.price)}
                            </button>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => setExpandedId(open ? null : item.id)} className={rowBtn}>
                                <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> Details
                              </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (item.barcode) {
                                      setPrintModalItem(item)
                                    } else {
                                      setSelectedForReceive({ productId: item.product_id, variantId: item.variant_id })
                                      setShowReceiveModal(true)
                                    }
                                  }}
                                  className={rowBtn}
                                  title={item.barcode ? 'Print barcode labels' : 'Create a barcode for this item'}
                                >
                                  <ScanBarcode size={14} /> Barcode
                                </button>
                              <button type="button" onClick={() => { setEditProductId(item.product_id); setActiveTab('products') }} className={rowBtn} title={`Edit "${item.name}"`}>
                                <Edit2 size={14} /> Edit
                              </button>
                              <button type="button" onClick={() => setAdjustModalItem(item)} className={rowBtn} title="Adjust stock">
                                <SlidersHorizontal size={14} /> Stock
                              </button>
                              {role === 'admin' && (
                                <button type="button" onClick={() => void handleDeleteItem(item)} className={`${rowBtn} !border-red-200 !text-[#DC2626] hover:!bg-red-50`} title={`Delete "${item.name}"`}>
                                  <Trash2 size={14} /> Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-gray-100 bg-gray-50/70">
                            <td colSpan={5} className="px-4 py-3.5">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
                                {[
                                  ['Category', item.category || 'General'],
                                  ['SKU', item.sku || '—'],
                                  ['Offer Price', item.offer_price ? formatCurrency(item.offer_price) : '—'],
                                  ['Cost Price', item.purchase_price ? formatCurrency(item.purchase_price) : '—'],
                                  ['Low Stock Alert', String(threshold)],
                                ].map(([k, v]) => (
                                  <div key={k}>
                                    <p className="text-[10.5px] font-black uppercase tracking-widest text-gray-500">{k}</p>
                                    <p className="mt-0.5 font-bold text-[#111111] break-words">{v}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                  <button type="button" onClick={() => setHistoryDrawerItem(item)} className={rowBtn}><History size={14} /> Stock History</button>
                                <button type="button" onClick={() => setPriceModalItem(item)} className={rowBtn}><Edit2 size={14} /> Quick Price</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ADD / EDIT PRODUCTS VIEW */}
      {activeTab === 'products' && (
        <div className="animate-in fade-in duration-150">
          <AddEditProductView
            initialProductId={editProductId}
            onClearEdit={() => setEditProductId(null)}
            onStockUpdated={loadData}
          />
        </div>
      )}

      {/* TAB 3: CATEGORIES MANAGEMENT VIEW */}
      {activeTab === 'categories' && (
        <div className="animate-in fade-in duration-150">
          <CategoryManagerView />
        </div>
      )}

      {/* TAB 4: ANALYTICS & REPORTS VIEW */}
      {activeTab === 'analytics' && (
        <div className="animate-in fade-in duration-150">
          <InventoryAnalyticsView />
        </div>
      )}

      <AddProductModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => { setAddOpen(false); void loadData() }}
      />

      {/* Modal: Vyapar Barcode Generator Workspace */}
      {showReceiveModal && (
        <CreateBarcodeModal
          isOpen={showReceiveModal}
          onClose={() => setShowReceiveModal(false)}
          products={distinctProducts}
          preselectedProductId={selectedForReceive?.productId}
          preselectedVariantId={selectedForReceive?.variantId}
          onSuccess={loadData}
        />
      )}

      {/* Modal: Print Barcode Labels */}
      {printModalItem && (
        <BarcodePrintModal
          isOpen={!!printModalItem}
          onClose={() => setPrintModalItem(null)}
          productName={printModalItem.name}
          variantName={printModalItem.variant_name}
          barcodeValue={printModalItem.barcode || ''}
          price={printModalItem.price}
          mrp={printModalItem.offer_price}
          defaultQuantity={Math.max(1, printModalItem.stock)}
        />
      )}

      {/* Modal: Adjust Stock */}
      {adjustModalItem && (
        <AdjustStockModal
          isOpen={!!adjustModalItem}
          onClose={() => setAdjustModalItem(null)}
          item={adjustModalItem}
          onSuccess={loadData}
        />
      )}

      {/* Drawer: Stock History */}
      {historyDrawerItem && (
        <StockHistoryDrawer
          isOpen={!!historyDrawerItem}
          onClose={() => setHistoryDrawerItem(null)}
          item={historyDrawerItem}
        />
      )}

      {/* Modal: Quick Edit Price */}
      {priceModalItem && (
        <QuickPriceModal
          isOpen={!!priceModalItem}
          item={priceModalItem}
          onClose={() => setPriceModalItem(null)}
          onSuccess={(updated) => {
            setItems((prev) =>
              prev.map((it) =>
                it.id === updated.id
                  ? {
                      ...it,
                      price: updated.price,
                      purchase_price: updated.cost_price ?? it.purchase_price,
                    }
                  : it
              )
            )
            void fetchProducts()
          }}
        />
      )}
    </div>
  )
}

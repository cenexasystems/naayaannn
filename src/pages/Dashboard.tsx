import React, { useCallback, useEffect, useState, useMemo, useRef, type FormEvent } from 'react'
import {
  BarChart2, Trash2, Edit2, List, ShoppingCart, LayoutDashboard,
  Box, AlertCircle, ArrowUp, ArrowDown, Power, Download, TrendingUp, TrendingDown,
  Package, Search, RefreshCw, ShieldCheck, ShieldOff, Trophy,
  MessageCircle, ChevronDown, Eye, FileText, Printer, MoreVertical, X, Layers, Receipt,
  SlidersHorizontal, Tag, Ticket, Percent, CheckCircle2, Info, Sparkles, Banknote, QrCode, CreditCard, Gift, Settings as SettingsIcon, LogOut, Clock, History, UserCheck, Boxes, ChartNoAxesColumn, Wallet, TicketPercent, Settings2,
} from 'lucide-react'
import { paymentBreakdown, formatPaymentLabel } from '../lib/payments'

// Custom Malaysian Ringgit icon — replaces the generic dollar-sign icon
const RMIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="Malaysian Ringgit"
  >
    <rect x="2" y="2" width="20" height="20" rx="4" />
    <text
      x="12"
      y="16"
      textAnchor="middle"
      fontSize="9"
      fontWeight="bold"
      stroke="none"
      fill="currentColor"
      fontFamily="Arial, sans-serif"
    >₹</text>
  </svg>
)
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { debounce } from '../lib/debounce'
import { useAuthStore, useProductStore, useAdminAuthStore, type Product } from '../store/store'
import { uploadProductImage } from '../lib/storage'
import { formatCurrency, normalizeOrderMode, normalizeUnitType, toNumber, type UnitType } from '../lib/retail'
import { normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { Invoice } from '../components/Invoice'
import { printThermalReceipt } from '../lib/thermalPrint'
import { buildProfessionalWhatsAppMessage } from '../lib/whatsappMessage'
import { invoicePdfFile } from '../lib/invoicePdf'
import { formatPhoneDisplay, formatPhoneForCSV } from '../lib/phone'
import { downloadCsv } from '../lib/exportCsv'
// toWhatsAppUrl removed - using direct link building in handlers
import { createVariant, updateVariant, deleteVariant, setDefaultVariant, type ProductVariant } from '../services/variantService'
import { useVariantStore } from '../store/store'
import Pos from './Pos'
import AdvanceOrders from './AdvanceOrders'
import type { AdvanceOrder } from '../services/advanceOrderService'
import { InventoryTable } from '../components/inventory/InventoryTable'
import { CategoryManagerView } from '../components/inventory/CategoryManagerView'
import { ExpensesView } from '../components/expenses/ExpensesView'
import { BirthdaysView } from '../components/birthdays/BirthdaysView'
import { ShopSettingsView } from '../components/settings/ShopSettingsView'
import { AttendanceView } from '../components/attendance/AttendanceView'
import { expenseService, type ExpenseRecord } from '../services/expenseService'
import { useNavigationStore } from '../store/navigationStore'
import { useAlarmStore } from '../store/alarmStore'
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner'
import { BarcodeRedirectDialog } from '../components/pos/BarcodeRedirectDialog'
import { exportAnalyticsToCSV, exportAnalyticsToPDF } from '../services/analyticsExport'
import { BRAND_EN, BRAND_ICON, BRAND_TAGLINE } from '../lib/brand'
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import { db, isDatabaseConfigured } from '../lib/db'
import { confirmDelete } from '../lib/confirmDelete'

type Category = { id: string | number; name_en: string; name_ta: string; is_active?: boolean; sort_order?: number }
type DashboardOrder = {
  id: string; invoice_no: string; customer_name: string; phone: string; address: string
  created_at: string; total: number; status: string; order_mode: string; order_type: string; user_id: string | null; items: unknown
  coupon_code: string; discount_amount: number; manual_discount_amount: number; delivery_charge: number
  total_gst: number; payment_mode: string; payment_method?: string; split_details?: unknown; invoice_pdf_url: string; remarks?: string; reference_number?: string
}
type DashboardOrderItem = { order_id: string; product_id?: string | null; variant_id?: string | null; product_name: string; category?: string; quantity: number; line_total: number; is_manual?: boolean | null }
type DashboardCoupon = {
  id: number
  code: string
  percentage: number
  is_active: boolean
  expiry_date: string | null
  usage_limit: number | null
  usage_count: number
  min_order_value: number
}
type TabKey = 'overview' | 'whatsapp' | 'pos_analytics' | 'billing' | 'advance_orders' | 'inventory' | 'expenses' | 'birthdays' | 'products' | 'categories' | 'coupons' | 'users' | 'history' | 'settings' | 'attendance'
type PosAnalyticsTab = 'revenue' | 'today' | 'products' | 'categories' | 'coupons'
type ProfileUser = { id: string; email: string; name: string; mobile: string; role: string; created_at: string }

const normalizeStatus = (v: unknown) => String(v || '').trim().toLowerCase()
const normalizeOrderType = (v: unknown) => String(v || '').trim().toLowerCase() || 'pos_sale'
// Single source of truth for the bill-type badge AND the Offline/Online/Manual filter
const getBillType = (o: { order_type?: unknown; order_mode?: unknown }): 'manual' | 'online' | 'offline' =>
  normalizeOrderType(o.order_type) === 'manual_sale' ? 'manual' : normalizeOrderMode(o.order_mode) === 'online' ? 'online' : 'offline'
const isCompletedStatus = (v: unknown) => {
  const status = normalizeStatus(v)
  return status === 'completed' || status === 'paid'
}
const parseOrderItems = (items: unknown): Record<string, unknown>[] => {
  if (Array.isArray(items)) return items.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
  if (typeof items === 'string') { try { const p = JSON.parse(items); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

// When o.total is 0 (legacy orders saved with bug), compute it from the items JSON
/** A bill is a GST invoice when GST was charged on it. */
const isGstBill = (o: { total_gst?: unknown; gst_amount?: unknown }) =>
  toNumber(o.total_gst, 0) > 0 || toNumber(o.gst_amount, 0) > 0

const getOrderTotal = (order: { total: unknown; items: unknown; shipping?: unknown; delivery_charge?: unknown; total_gst?: unknown; discount_amount?: unknown; manual_discount_amount?: unknown }): number => {
  const stored = toNumber(order.total, 0)
  if (stored > 0) return stored
  const items = parseOrderItems(order.items)
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = toNumber(item.line_total ?? item.lineTotal, 0)
    if (lineTotal > 0) return sum + lineTotal
    return sum + toNumber(item.base_price ?? item.basePrice ?? item.price, 0) * Math.max(1, toNumber(item.quantity, 1))
  }, 0)
  return Math.max(0, subtotal
    + toNumber(order.shipping ?? order.delivery_charge, 0)
    + toNumber(order.total_gst, 0)
    - toNumber(order.discount_amount, 0)
    - toNumber(order.manual_discount_amount, 0)
  )
}

const toLocalDateKey = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const emptyForm = {
  name: '', nameTa: '', category: '', categoryId: null as string | number | null,
  remedy: [] as string[], price: '' as string | number, offerPrice: '' as string | number,
  purchasePrice: '' as string | number, mrp: '' as string | number,
  sku: '', barcode: '',
  unitType: 'unit' as UnitType, unitLabel: 'piece', baseQuantity: 1,
  stockQuantity: '100' as string | number, stockUnit: 'piece', allowDecimalQuantity: false,
  predefinedOptionsText: '', isActive: true, sortOrder: 0, stock: 100,
  description: '', descriptionTa: '', benefits: '', benefitsTa: '', image: '',
  hasVariants: false,
}

const exportCSV = (orders: DashboardOrder[]) => {
  const header = ['Order Ref', 'Customer', 'Phone', 'Date', 'Total (INR)', 'Order Type', 'Status']
  const rows = orders.map(o => {
    let dateStr = ''
    try {
      dateStr = new Date(o.created_at).toISOString().slice(0, 10)
    } catch {
      dateStr = String(o.created_at || '')
    }
    return [
      o.order_type === 'online_request' ? o.id : o.invoice_no,
      o.customer_name || 'Walk-in Customer',
      formatPhoneForCSV(o.phone),
      dateStr,
      getOrderTotal(o).toFixed(2),
      o.order_type,
      o.status,
    ]
  })
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const filename = `orders_${new Date().toISOString().slice(0, 10)}.csv`
  downloadCsv(filename, csv)
}

const UNIT_TYPE_OPTIONS: { value: UnitType; label: string; hint: string }[] = [
  { value: 'unit',   label: 'Standard Piece (No Size)', hint: 'e.g. Saree, Stole, Dupatta, Accessory' },
  { value: 'weight', label: 'Alpha Sizes (S, M, L...)', hint: 'Apparel with standard letter sizing (S, M, L, XL, 2XL)' },
  { value: 'volume', label: 'Numeric Sizes (28, 30...)', hint: 'Waist / chest numeric sizing (28, 30, 32, 34, 36)' },
  { value: 'bundle', label: 'Bundle / Combo Set',    hint: 'e.g. 3-piece combo, bridal set' },
]

const DEFAULT_OPTIONS_FOR_TYPE: Record<UnitType, string> = {
  unit:   '',
  weight: 'S, M, L, XL, 2XL',
  volume: '28, 30, 32, 34, 36, 38',
  bundle: '',
}

export default function Dashboard() {
  const { user } = useAuthStore()
  const { products, fetchProducts } = useProductStore()
  const location = useLocation()
  const navigate = useNavigate()
  const role = useAdminAuthStore(state => state.role)
  const lowStockCount = useAlarmStore(state => state.lowStockItems.length)
  const [tab, setTab] = useState<TabKey>(() => {
    const params = new URLSearchParams(location.search)
    const tabParam = params.get('tab') as TabKey | null
    if (tabParam) return tabParam
    if (location.pathname === '/whatsapp-center') return 'whatsapp'
    if (location.pathname === '/pos-analytics' && role === 'admin') return 'pos_analytics'
    if (location.pathname === '/advance-orders') return 'advance_orders'
    if (location.pathname === '/expenses' || location.pathname === '/dashboard/expenses') return 'expenses'
    return 'billing'
  })
  const { setCurrentTab } = useNavigationStore()
  const [cartItemToInject, setCartItemToInject] = useState<string | null>(null)

  // Sync tab with navigation store
  useEffect(() => {
    setCurrentTab(tab)
  }, [tab, setCurrentTab])

  // Global hardware scanner listener
  useHardwareBarcodeScanner({
    isBillingActive: tab === 'billing',
    onScanDirect: (barcode) => {
      setCartItemToInject(barcode)
    },
  })

  const handleNavigateToBillingFromDialog = (barcode: string) => {
    setTab('billing')
    setCurrentTab('billing')
    navigate('/dashboard', { replace: true })
    setCartItemToInject(barcode)
  }

  const [posAnalyticsTab, setPosAnalyticsTab] = useState<PosAnalyticsTab>('revenue')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [inventorySearch, setInventorySearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [productNotice, setProductNotice] = useState('')
  const [cats, setCats]     = useState<Category[]>([])
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [orderItems, setOrderItems] = useState<DashboardOrderItem[]>([])
  const [editingProd, setEditingProd] = useState<Product | null>(null)
  const [prodForm, setProdForm] = useState(emptyForm)
  const [newCat, setNewCat] = useState({ name_en: '', name_ta: '' })
  const [editingCategoryId, setEditingCategoryId] = useState<string | number | null>(null)
  const [categoryNotice, setCategoryNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [openCategoryMenuId, setOpenCategoryMenuId] = useState<string | number | null>(null)
  const [coupons, setCoupons] = useState<DashboardCoupon[]>([])
  const [couponForm, setCouponForm] = useState<{
    code: string
    percentage: number | string
    expiry_date: string
    usage_limit: string
    min_order_value: string
  }>({ code: '', percentage: '', expiry_date: '', usage_limit: '', min_order_value: '' })
  const [couponSaveError, setCouponSaveError] = useState('')
  const [couponSaveSuccess, setCouponSaveSuccess] = useState('')
  const [editingCouponId, setEditingCouponId] = useState<number | null>(null)

  // Variant management state
  const { getVariants, refetchVariants } = useVariantStore()
  const variantsMap = useVariantStore(s => s.variantsMap)
  const [variantForm, setVariantForm] = useState({ name: '', sizeLabel: '', price: '', purchasePrice: '', mrp: '', sku: '', barcode: '', stock: '50', weightValue: '', weightUnit: '', isDefault: false })
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [variantNotice, setVariantNotice] = useState('')
  const [variantLoading, setVariantLoading] = useState(false)

  const [analyticsTab, setAnalyticsTab] = useState('revenue')

  const [invoicePreviewOrder, setInvoicePreviewOrder] = useState<DashboardOrder | null>(null)

  // WA detail expansion
  const [waExpandedId, setWaExpandedId] = useState<string | null>(null)

  // Order history row expansion (remarks / ref no)
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null)
  const [editingOrder, setEditingOrder] = useState<DashboardOrder | null>(null)
  const [editOrderForm, setEditOrderForm] = useState({
    customer_name: '',
    phone: '',
    address: '',
    remarks: '',
    reference_number: '',
    status: 'completed',
  })
  const [savingOrderEdit, setSavingOrderEdit] = useState(false)

  // Search & date filter
  const [search, setSearch] = useState({ invoiceNo: '', phone: '', customerName: '', dateFrom: '', dateTo: '' })
  const [todayBillsSearch, setTodayBillsSearch] = useState('')
  const [productAnalyticsSearch, setProductAnalyticsSearch] = useState('')
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'year' | 'custom' | ''>('')
  const [historyQuickSearch, setHistoryQuickSearch] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [searchResults, setSearchResults] = useState<DashboardOrder[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('dashboard-sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })

  // Categories are a master list. Products reference this list through
  // category_id; product text is only a legacy display fallback.
  const activeCategories = useMemo(
    () => cats.filter(category => category.is_active !== false),
    [cats]
  )

  // Analytics global date filter
  const [analyticsDatePreset, setAnalyticsDatePreset] = useState<'all' | 'today' | 'week' | 'month' | 'year' | 'custom'>('all')
  const [gstScope, setGstScope] = useState<'all' | 'gst' | 'non_gst'>('all')
  const [historyGstScope, setHistoryGstScope] = useState<'all' | 'gst' | 'non_gst'>('all')
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState('')
  const [analyticsDateTo, setAnalyticsDateTo] = useState('')
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])

  // Order Management bill type filter
  const [billTypeFilter, setBillTypeFilter] = useState<'all' | 'offline' | 'online' | 'manual'>('all')

  // Users tab
  const [allUsers, setAllUsers] = useState<ProfileUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null)

  const isAdmin = true // bypassed for local demo
  const l = (en: string, _ta?: string) => en

  const toErr = (err: unknown, fb: string) =>
    err instanceof Error ? err.message
    : (err && typeof err === 'object' && 'message' in err) ? String((err as {message?:unknown}).message) || fb : fb

  useEffect(() => {
    if (role === 'staff') {
      const staffAllowedTabs: TabKey[] = ['billing', 'inventory', 'advance_orders', 'birthdays', 'expenses', 'history']
      if (!staffAllowedTabs.includes(tab)) {
        setTab('billing')
        navigate('/dashboard', { replace: true })
      }
    }
  }, [role, tab, navigate])

  const handleTabClick = (tabKey: TabKey) => {
    if (role === 'staff') {
      const staffAllowedTabs: TabKey[] = ['billing', 'inventory', 'advance_orders', 'birthdays', 'expenses', 'history']
      if (!staffAllowedTabs.includes(tabKey)) return
    }
    setTab(tabKey)
    setCurrentTab(tabKey)
    if (tabKey === 'pos_analytics') {
      navigate('/dashboard?tab=pos_analytics', { replace: true })
    } else if (tabKey === 'expenses') {
      navigate('/dashboard?tab=expenses', { replace: true })
    } else if (tabKey === 'birthdays') {
      navigate('/dashboard?tab=birthdays', { replace: true })
    } else if (tabKey === 'advance_orders') {
      navigate('/dashboard?tab=advance_orders', { replace: true })
    } else if (tabKey === 'inventory') {
      navigate('/dashboard?tab=inventory', { replace: true })
    } else if (tabKey === 'settings' || tabKey === 'attendance') {
      navigate(`/dashboard?tab=${tabKey}`, { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  const deletedOrderIds = React.useRef<Set<string>>(new Set())

  const toDashboardOrder = (row: Record<string, unknown>): DashboardOrder => ({
    id: String(row.id || ''), invoice_no: String(row.invoice_no || ''),
    customer_name: String(row.customer_name || ''), phone: String(row.phone || ''),
    address: String(row.address || ''),
    created_at: String(row.created_at || ''), total: toNumber(row.total, 0),
    status: String(row.status || 'pending'),
    order_mode: normalizeOrderMode(row.order_mode),
    order_type: normalizeOrderType(row.order_type),
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    items: row.items,
    coupon_code: String(row.coupon_code || ''),
    discount_amount: toNumber(row.discount_amount, 0),
    manual_discount_amount: toNumber(row.manual_discount_amount, 0),
    delivery_charge: toNumber(row.delivery_charge, 0),
    total_gst: toNumber(row.total_gst ?? row.gst_amount, 0),
    payment_mode: String(row.payment_mode || row.payment_method || ''),
    split_details: row.split_details,
    invoice_pdf_url: String(row.invoice_pdf_url || ''),
    remarks: row.remarks ? String(row.remarks) : '',
    reference_number: row.reference_number ? String(row.reference_number) : '',
  })

  const handleAdvanceOrderCompleted = useCallback((advance: AdvanceOrder) => {
    if (!advance.completed_order_id || !advance.invoice_number) return
    const createdAt = advance.completed_at || new Date().toISOString()
    const fallbackItem = {
      name: advance.product_name,
      category: advance.category,
      quantity: 1,
      base_price: advance.total_amount,
      line_total: advance.total_amount,
      unit: 'piece',
      unit_type: 'unit',
      source: 'advance_order',
    }
    const completedItems = advance.products.length ? advance.products : [fallbackItem]
    const completed: DashboardOrder = {
      id: advance.completed_order_id,
      invoice_no: advance.invoice_number,
      customer_name: advance.customer_name,
      phone: advance.phone,
      address: advance.address,
      created_at: createdAt,
      total: advance.total_amount,
      status: 'completed',
      order_mode: 'offline',
      order_type: 'advance_order',
      user_id: user?.id || null,
      items: completedItems,
      coupon_code: '',
      discount_amount: 0,
      manual_discount_amount: 0,
      delivery_charge: 0,
      total_gst: 0,
      payment_mode: advance.final_payment_method || '',
      payment_method: advance.final_payment_method || '',
      split_details: advance.split_details,
      invoice_pdf_url: '',
      remarks: advance.remarks || '',
      reference_number: advance.reference_number || '',
    }
    setOrders(current => [completed, ...current.filter(order => order.id !== completed.id)])
    setSearchResults(current => [completed, ...current.filter(order => order.id !== completed.id)].slice(0, 100))
    setOrderItems(current => [...completedItems.map(item => ({ order_id: completed.id, product_name: String(item.name || 'Product'), category: String(item.category || advance.category || ''), quantity: Number(item.quantity || 1), line_total: Number(item.line_total || 0), is_manual: false })), ...current.filter(row => row.order_id !== completed.id)])
  }, [user?.id])

  // Analytics (date-aware)
  const analytics = useMemo(() => {
    // GST scope: All bills, GST invoices only, or non-GST bills only
    const scopedOrders = gstScope === 'all' ? orders : orders.filter(o => (gstScope === 'gst') === isGstBill(o))

    // GST vs non-GST split for the selected period (always across all bills)
    const splitSource = orders.filter(o =>
      (!analyticsDateFrom || toLocalDateKey(o.created_at) >= analyticsDateFrom) &&
      (!analyticsDateTo || toLocalDateKey(o.created_at) <= analyticsDateTo) &&
      normalizeStatus(o.status) !== 'cancelled' && isCompletedStatus(o.status) &&
      normalizeOrderType(o.order_type) !== 'online_request')
    const gstBills = splitSource.filter(isGstBill)
    const nonGstBills = splitSource.filter(o => !isGstBill(o))
    const gstRevenue = gstBills.reduce((sum, o) => sum + getOrderTotal(o), 0)
    const nonGstRevenue = nonGstBills.reduce((sum, o) => sum + getOrderTotal(o), 0)

    // Apply global date filter
    let dated = scopedOrders
    if (analyticsDateFrom) dated = dated.filter(o => toLocalDateKey(o.created_at) >= analyticsDateFrom)
    if (analyticsDateTo)   dated = dated.filter(o => toLocalDateKey(o.created_at) <= analyticsDateTo)

    // Classify
    const nonCancelled = dated.filter(o => normalizeStatus(o.status) !== 'cancelled')
    const completedOrders = nonCancelled.filter(o => isCompletedStatus(o.status))
    const pendingOrders   = nonCancelled.filter(o => normalizeStatus(o.status) === 'pending')

    // WhatsApp = online_request type (all statuses, no revenue)
    const waOrders = dated.filter(o => normalizeOrderType(o.order_type) === 'online_request')

    // Billable = completed and NOT online_request
    const billableCompleted = completedOrders.filter(o => normalizeOrderType(o.order_type) !== 'online_request')
    // The trend charts are fixed calendar views. The period selector filters
    // KPIs/tables, but must not change the year/week bars underneath them.
    const allBillableCompleted = scopedOrders
      .filter(o => normalizeStatus(o.status) !== 'cancelled')
      .filter(o => isCompletedStatus(o.status))
      .filter(o => normalizeOrderType(o.order_type) !== 'online_request')
    // Channel is determined by order_mode. Older orders can use a different
    // order_type, so requiring exactly `pos_sale` hides valid online bills.
    const offlinePOS  = billableCompleted.filter(o => normalizeOrderMode(o.order_mode) === 'offline' && normalizeOrderType(o.order_type) !== 'manual_sale')
    const onlinePOS   = billableCompleted.filter(o => normalizeOrderMode(o.order_mode) === 'online')
    const manualSales = billableCompleted.filter(o => normalizeOrderType(o.order_type) === 'manual_sale')

    // Revenue (WhatsApp never included)
    const completedRevenue   = billableCompleted.reduce((s, o) => s + getOrderTotal(o), 0)
    const averageRevenuePerBill = billableCompleted.length > 0 ? completedRevenue / billableCompleted.length : 0
    const posRevenue         = offlinePOS.reduce((s, o) => s + getOrderTotal(o), 0)
    const onlinePosRevenue   = onlinePOS.reduce((s, o) => s + getOrderTotal(o), 0)
    const manualRevenue      = manualSales.reduce((s, o) => s + getOrderTotal(o), 0)

    // Money collected per channel (split payments are counted by their cash / QR / card parts)
    const collected = billableCompleted.reduce((acc, o) => {
      const b = paymentBreakdown(o.payment_mode || o.payment_method, o.split_details, getOrderTotal(o))
      acc.cash += b.cash; acc.qr += b.qr; acc.card += b.card; acc.other += b.other
      return acc
    }, { cash: 0, qr: 0, card: 0, other: 0 })

    // Expenses & Net Profit calculation:
    // Net Profit = Revenue (total selling based on orders) - Total Expense (from expense tracker)
    let datedExpenses = expenses
    if (analyticsDateFrom) datedExpenses = datedExpenses.filter(e => e.expense_date >= analyticsDateFrom)
    if (analyticsDateTo)   datedExpenses = datedExpenses.filter(e => e.expense_date <= analyticsDateTo)
    const totalExpenses = datedExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const netProfit = completedRevenue - totalExpenses
    const isProfitable = netProfit >= 0

    const toLocalMonthKey = (value: string | Date) => toLocalDateKey(value).slice(0, 7)

    const todayKey  = toLocalDateKey(new Date())
    const monthKey  = todayKey.slice(0, 7)
    const todaySales   = scopedOrders.filter(o => isCompletedStatus(o.status) && o.order_type !== 'whatsapp_request' && toLocalDateKey(o.created_at) === todayKey).reduce((s, o) => s + getOrderTotal(o), 0)

    // Today-specific analytics (for TODAY'S SALES tab)
    const todayOrders = billableCompleted.filter(o => toLocalDateKey(o.created_at) === todayKey)
    const todayCompletedOrdersCount = todayOrders.length
    const todayItemsSold = todayOrders.reduce((s, o) => {
      const items = parseOrderItems(o.items)
      return s + items.reduce((sum, item) => sum + toNumber(item.quantity ?? item.qty, 0), 0)
    }, 0)
    const todayAvgOrderValue = todayCompletedOrdersCount > 0 ? todaySales / todayCompletedOrdersCount : 0

    // Hourly trend for today
    const hourlyMap = new Map<string, number>()
    todayOrders.forEach(o => {
      const hour = String(new Date(o.created_at).getHours()).padStart(2, '0')
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + getOrderTotal(o))
    })
    const todayHourlyTrend = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0')
      // Use 12-hour format
      const ampm = i < 12 ? 'AM' : 'PM'
      const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i
      return { hour: `${h12} ${ampm}`, key: h, revenue: hourlyMap.get(h) || 0 }
    })

    // Today's top products
    const todayProductMap = new Map<string, { name: string; qty: number; revenue: number }>()
    todayOrders.forEach(o => {
      parseOrderItems(o.items).forEach(item => {
        const name = String(item.product_name || item.name || 'Product').trim()
        const qty = toNumber(item.quantity ?? item.qty, 0)
        const rev = toNumber(item.line_total ?? item.lineTotal, 0)
        const p = todayProductMap.get(name) || { name, qty: 0, revenue: 0 }
        p.qty += qty; p.revenue += rev
        todayProductMap.set(name, p)
      })
    })
    const todayTopProducts = Array.from(todayProductMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
    const todayBills = todayOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10)

    // Today's channel breakdown
    const todayOffline = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'pos_sale' && normalizeOrderMode(o.order_mode) !== 'online')
    const todayOnline = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'pos_sale' && normalizeOrderMode(o.order_mode) === 'online')
    const todayManual = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'manual_sale')
    const todayOfflineRevenue = todayOffline.reduce((s, o) => s + getOrderTotal(o), 0)
    const todayOnlineRevenue = todayOnline.reduce((s, o) => s + getOrderTotal(o), 0)
    const todayManualRevenue = todayManual.reduce((s, o) => s + getOrderTotal(o), 0)

    // Product hourly trend (products sold per hour today)
    const productHourlyMap = new Map<string, number>()
    todayOrders.forEach(o => {
      const hour = String(new Date(o.created_at).getHours()).padStart(2, '0')
      const totalQty = parseOrderItems(o.items).reduce((s, item) => s + toNumber(item.quantity ?? item.qty, 0), 0)
      productHourlyMap.set(hour, (productHourlyMap.get(hour) || 0) + totalQty)
    })
    const todayProductHourlyTrend = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0')
      const ampm = i < 12 ? 'AM' : 'PM'
      const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i
      return { hour: `${h12} ${ampm}`, key: h, qty: productHourlyMap.get(h) || 0 }
    })

    const monthlyRevenue = billableCompleted.filter(o => toLocalMonthKey(o.created_at) === monthKey).reduce((s, o) => s + getOrderTotal(o), 0)

    // Item-level analytics
    const completedIds = new Set(billableCompleted.map(o => o.id))
    const completedItems = orderItems.length > 0
      ? orderItems.filter(item => completedIds.has(item.order_id))
      : completedOrders.flatMap(order => parseOrderItems(order.items).map(row => ({
          order_id: order.id,
          product_name: String((row as Record<string,unknown>).product_name || (row as Record<string,unknown>).name || 'Product'),
          category: String((row as Record<string,unknown>).category || ''),
          quantity: toNumber((row as Record<string,unknown>).quantity ?? (row as Record<string,unknown>).qty, 0),
          line_total: toNumber((row as Record<string,unknown>).line_total ?? (row as Record<string,unknown>).lineTotal, 0),
          is_manual: (row as Record<string,unknown>).is_manual === true || (row as Record<string,unknown>).source === 'manual',
        })))

    const productMap    = new Map<string, { name: string; variant: string; qty: number; revenue: number; billCount: number; cost: number; costedRevenue: number; costedQty: number }>()

    // Unit cost lookup: variant cost price first, then product cost price (by id, then by name)
    const variantCostById = new Map<string, number>()
    Object.values(variantsMap || {}).forEach(list => (list || []).forEach(v => { if (v && v.purchasePrice != null && Number(v.purchasePrice) > 0) variantCostById.set(String(v.id), Number(v.purchasePrice)) }))
    const productCostById = new Map<string, number>()
    const productCostByName = new Map<string, number>()
    products.forEach(p => {
      const c = Number((p as { purchasePrice?: number }).purchasePrice) || 0
      if (c > 0) { productCostById.set(String(p.id), c); productCostByName.set(String(p.name || '').trim().toLowerCase(), c) }
    })
    const unitCostFor = (item: { product_id?: string | null; variant_id?: string | null }, mainName: string) => {
      if (item.variant_id && variantCostById.has(String(item.variant_id))) return variantCostById.get(String(item.variant_id)) as number
      if (item.product_id && productCostById.has(String(item.product_id))) return productCostById.get(String(item.product_id)) as number
      return productCostByName.get(mainName.trim().toLowerCase()) || 0
    }
    const productOrders = new Map<string, Set<string>>()
    const categoryMap   = new Map<string, { name: string; qty: number; revenue: number }>()
    const prodCatLookup = new Map(products.map(p => [String(p.name || '').trim().toLowerCase(), p.category || 'Uncategorized']))

    let totalProductsSold = 0
    let totalManualRevenue = 0

    completedItems.forEach((rawItem) => {
      const { product_name, category, quantity, line_total, order_id, is_manual } = rawItem
      const qty = toNumber(quantity, 0)
      const rev = toNumber(line_total, 0)
      totalProductsSold += qty

      const rawKey  = String(product_name || 'Product').trim() || 'Product'
      const dashIdx = rawKey.indexOf(' - ')
      const mainName   = dashIdx > 0 ? rawKey.slice(0, dashIdx) : rawKey
      const variantName = dashIdx > 0 ? rawKey.slice(dashIdx + 3) : ''

      const pc = productMap.get(rawKey) || { name: mainName, variant: variantName, qty: 0, revenue: 0, billCount: 0, cost: 0, costedRevenue: 0, costedQty: 0 }
      pc.qty += qty; pc.revenue += rev
      const unitCost = is_manual ? 0 : unitCostFor(rawItem as { product_id?: string | null; variant_id?: string | null }, mainName)
      if (unitCost > 0) { pc.cost += unitCost * qty; pc.costedRevenue += rev; pc.costedQty += qty }
      productMap.set(rawKey, pc)

      if (!productOrders.has(rawKey)) productOrders.set(rawKey, new Set())
      productOrders.get(rawKey)!.add(order_id)

      const catName = category || prodCatLookup.get(mainName.toLowerCase()) || 'Uncategorized'
      const cc = categoryMap.get(catName) || { name: catName, qty: 0, revenue: 0 }
      cc.qty += qty; cc.revenue += rev; categoryMap.set(catName, cc)

      if (is_manual) totalManualRevenue += rev
    })

    for (const [key, orderSet] of productOrders) {
      const p = productMap.get(key); if (p) { p.billCount = orderSet.size; productMap.set(key, p) }
    }

    const topProducts   = Array.from(productMap.values()).map(p => {
      const hasCost = p.costedQty > 0
      const profit = hasCost ? p.costedRevenue - p.cost : 0
      return { ...p, hasCost, profit, margin: hasCost && p.costedRevenue > 0 ? (profit / p.costedRevenue) * 100 : 0 }
    }).sort((a, b) => b.qty - a.qty)
    const totalProductCost = topProducts.reduce((s, p) => s + p.cost, 0)
    const totalProductProfit = topProducts.reduce((s, p) => s + (p.hasCost ? p.profit : 0), 0)
    const costedRevenueTotal = topProducts.reduce((s, p) => s + (p.hasCost ? p.costedRevenue : 0), 0)
    const productsWithoutCost = topProducts.filter(p => !p.hasCost).length
    const overallProfitMargin = costedRevenueTotal > 0 ? (totalProductProfit / costedRevenueTotal) * 100 : 0
    const topCategories = Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue)
    const bestProduct   = topProducts[0]?.name || 'No sales yet'
    const bestCategory  = topCategories[0]?.name || 'No sales yet'

    // Average items per bill
    const avgItemsPerBill = billableCompleted.length > 0
      ? totalProductsSold / billableCompleted.length : 0
    const averageProductRevenue = totalProductsSold > 0
      ? completedRevenue / totalProductsSold : 0

    // Category distribution for chart
    const categoryDist = Array.from(categoryMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)
      .map(([name, data]) => ({ name, value: data.revenue }))

    // Trend charts
    const chartYear = new Date().getFullYear()
    const monthlyRevenueMap = new Map<string, number>()
    allBillableCompleted.forEach(o => {
      const k = toLocalMonthKey(o.created_at)
      monthlyRevenueMap.set(k, (monthlyRevenueMap.get(k) || 0) + getOrderTotal(o))
    })
    const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(chartYear, i, 1)
      const k = toLocalMonthKey(d)
      return { key: k, month: d.toLocaleDateString('en-IN', { month: 'short' }), revenue: monthlyRevenueMap.get(k) || 0 }
    })

    const weeklyRevenueMap = new Map<string, number>()
    allBillableCompleted.forEach(o => {
      const k = toLocalDateKey(o.created_at)
      weeklyRevenueMap.set(k, (weeklyRevenueMap.get(k) || 0) + getOrderTotal(o))
    })

    const currentDayOfWeek = new Date().getDay() || 7 // 1: Mon, ..., 7: Sun
    const mondayDate = new Date()
    mondayDate.setDate(mondayDate.getDate() - currentDayOfWeek + 1)

    const weeklySales = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayDate)
      d.setDate(d.getDate() + i)
      const k = toLocalDateKey(d)
      // Force short weekday names in English to match Mon, Tue, Wed, Thu, Fri, Sat, Sun exactly
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)
      return { day: dayName, date: k, revenue: weeklyRevenueMap.get(k) || 0 }
    })

    const currentMonthDate = new Date()
    const daysInCurrentMonth = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 0).getDate()
    const monthDailySales = Array.from({ length: daysInCurrentMonth }, (_, i) => {
      const d = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), i + 1)
      const k = toLocalDateKey(d)
      return { day: `${i + 1}`, date: `${i + 1}/${currentMonthDate.getMonth() + 1}`, label: `Day ${i + 1}`, revenue: weeklyRevenueMap.get(k) || 0 }
    })

    const statusDistribution = [
      { name: 'WA Requests', value: waOrders.length, color: '#9CA3AF' },
      { name: 'POS Pending', value: pendingOrders.filter(o => normalizeOrderType(o.order_type) !== 'online_request').length, color: '#f59e0b' },
      { name: 'Completed',   value: billableCompleted.length, color: '#10b981' },
    ]
    const channelDistribution = [
      { name: 'Offline Bills', value: posRevenue, color: '#f97316' },
      { name: 'Online Bills',  value: onlinePosRevenue, color: '#9CA3AF' },
      { name: 'Manual Sales',  value: manualRevenue || totalManualRevenue, color: '#E5E7EB' },
    ]

    const hasCouponDateFilter = Boolean(analyticsDateFrom || analyticsDateTo)
    const orderCouponUsage = new Map<string, number>()
    const couponMap = new Map<string, { code: string; usage: number; discounts: number; percentage?: number; is_active?: boolean }>()
    coupons.forEach(c => {
      const code = String(c.code || '').trim().toUpperCase()
      if (!code) return
      couponMap.set(code, {
        code,
        usage: hasCouponDateFilter ? 0 : toNumber(c.usage_count, 0),
        discounts: 0,
        percentage: c.percentage,
        is_active: c.is_active,
      })
    })
    nonCancelled.forEach(order => {
      const rawCode = String((order as Record<string,unknown>).coupon_code || '').trim()
      if (!rawCode) return
      const code = rawCode.toUpperCase()
      const u = couponMap.get(code) || { code, usage: 0, discounts: 0, is_active: false }
      orderCouponUsage.set(code, (orderCouponUsage.get(code) || 0) + 1)
      u.discounts += toNumber((order as Record<string,unknown>).discount_amount, 0)
      couponMap.set(code, u)
    })
    couponMap.forEach(coupon => {
      const orderUsage = orderCouponUsage.get(coupon.code) || 0
      coupon.usage = hasCouponDateFilter ? orderUsage : Math.max(coupon.usage, orderUsage)
    })
    const topCoupons = Array.from(couponMap.values()).sort((a, b) => {
      if (b.usage !== a.usage) return b.usage - a.usage
      return b.discounts - a.discounts
    })
    const totalCouponDiscounts = topCoupons.reduce((s, c) => s + c.discounts, 0)
    const totalCouponOrders = topCoupons.reduce((s, c) => s + c.usage, 0)
    const couponUsageRate = nonCancelled.length > 0
      ? (totalCouponOrders / nonCancelled.length) * 100 : 0

    // Coupon daily trend (last 7 days)
    const couponDailyMap = new Map<string, { orders: number; discounts: number }>()
    nonCancelled.forEach(order => {
      const code = String((order as Record<string,unknown>).coupon_code || '').trim()
      if (!code) return
      const k = toLocalDateKey(order.created_at)
      const d = couponDailyMap.get(k) || { orders: 0, discounts: 0 }
      d.orders += 1
      d.discounts += toNumber((order as Record<string,unknown>).discount_amount, 0)
      couponDailyMap.set(k, d)
    })
    const couponDailyTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const k = toLocalDateKey(d)
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)
      const data = couponDailyMap.get(k) || { orders: 0, discounts: 0 }
      return { day: dayName, date: k, orders: data.orders, discounts: data.discounts }
    })

    // WhatsApp analytics (zero revenue - status changes never affect revenue)
    const waRequests  = waOrders.length
    const waPending   = waOrders.filter(o => normalizeStatus(o.status) === 'pending').length
    const waContacted = waOrders.filter(o => normalizeStatus(o.status) === 'contacted').length
    const waCompleted = waOrders.filter(o => isCompletedStatus(o.status)).length

    const waProductMap = new Map<string, number>()
    waOrders.forEach(order => {
      parseOrderItems(order.items).forEach(item => {
        const n = String((item as Record<string,unknown>).name || (item as Record<string,unknown>).product_name || '').trim()
        if (n) waProductMap.set(n, (waProductMap.get(n) || 0) + 1)
      })
    })
    const topWAProducts = Array.from(waProductMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    const waCategoryMap = new Map<string, number>()
    waOrders.forEach(order => {
      parseOrderItems(order.items).forEach(item => {
        const n = String((item as Record<string,unknown>).name || (item as Record<string,unknown>).product_name || '').trim()
        if (n) {
          const mainName = n.includes(' - ') ? n.split(' - ')[0] : n
          const catName = prodCatLookup.get(mainName.toLowerCase()) || 'Uncategorized'
          waCategoryMap.set(catName, (waCategoryMap.get(catName) || 0) + 1)
        }
      })
    })
    const topWACategories = Array.from(waCategoryMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    return {
      totalCompletedRevenue: completedRevenue,
      averageRevenuePerBill,
      todaySales,
      todayCompletedOrdersCount,
      todayItemsSold,
      todayAvgOrderValue,
      todayHourlyTrend,
      todayTopProducts,
      todayBills,
      todayOfflineRevenue,
      todayOnlineRevenue,
      todayManualRevenue,
      todayProductHourlyTrend,
      avgItemsPerBill,
      averageProductRevenue,
      categoryDist,
      totalCouponDiscounts,
      totalCouponOrders,
      couponUsageRate,
      couponDailyTrend,
      pendingOrders: pendingOrders.length,
      onlineRequests: waRequests,
      onlineRequestOrders: waOrders,
      completedOrders: billableCompleted.length,
      posRevenue,
      cashCollected: collected.cash,
      qrCollected: collected.qr,
      cardCollected: collected.card,
      otherCollected: collected.other,
      onlinePosRevenue,
      // Keep the bill count separate from revenue so the TOTAL ONLINE BILLS
      // card stays visible and always reflects the current completed orders.
      onlineBillCount: onlinePOS.length,
      monthDailySales,
      offlineOrderCount: offlinePOS.length,
      manualRevenue: manualRevenue || totalManualRevenue,
      monthlyRevenue,
      totalProductsSold,
      bestCategory,
      bestProduct,
      monthlyTrend,
      chartYear,
      channelDistribution,
      statusDistribution,
      topCoupons,
      topCategories,
      weeklySales,
      topProducts,
      totalProductCost,
      totalProductProfit,
      productsWithoutCost,
      overallProfitMargin,
      waRequests,
      waPending,
      waContacted,
      waCompleted,
      topWAProducts,
      topWACategories,
      totalExpenses,
      netProfit,
      isProfitable,
      gstRevenue,
      nonGstRevenue,
      gstBillCount: gstBills.length,
      nonGstBillCount: nonGstBills.length,
      netEarnings: gstRevenue + nonGstRevenue - totalExpenses,
    }
  }, [orders, orderItems, products, variantsMap, coupons, expenses, analyticsDateFrom, analyticsDateTo, gstScope])

  // Lifetime usage per coupon: the larger of the stored counter and orders that carry the code
  // (advance-order completion does not bump coupons.usage_count).
  const couponUsageByCode = useMemo(() => {
    const fromOrders = new Map<string, number>()
    orders.forEach(order => {
      if (String(order.status || '').toLowerCase() === 'cancelled') return
      const code = String(order.coupon_code || '').trim().toUpperCase()
      if (code) fromOrders.set(code, (fromOrders.get(code) || 0) + 1)
    })
    const usage = new Map<string, number>()
    coupons.forEach(c => {
      const code = String(c.code || '').trim().toUpperCase()
      usage.set(code, Math.max(toNumber(c.usage_count, 0), fromOrders.get(code) || 0))
    })
    return usage
  }, [orders, coupons])

  // Bill-type and date-range filtered results for Order Management table (client-side, instant)
  const filteredSearchResults = useMemo(() => {
    return searchResults.filter(o => {
      if (historyGstScope !== 'all' && (historyGstScope === 'gst') !== isGstBill(o)) return false
      if (billTypeFilter === 'manual' && getBillType(o) !== 'manual') return false
      if (billTypeFilter === 'offline' && getBillType(o) !== 'offline') return false
      if (billTypeFilter === 'online' && getBillType(o) !== 'online') return false

      if (search.dateFrom) {
        const orderDate = toLocalDateKey(o.created_at)
        if (orderDate < search.dateFrom) return false
      }
      if (search.dateTo) {
        const orderDate = toLocalDateKey(o.created_at)
        if (orderDate > search.dateTo) return false
      }

      return true
    })
  }, [searchResults, billTypeFilter, search.dateFrom, search.dateTo, historyGstScope])

  // Load dashboard data
  const loadData = useCallback(async () => {
    if (!isDatabaseConfigured) return
    setLoading(true)
    try {
      const productsPromise = fetchProducts(true)
      const [cRes, oRes, couponRes, expList] = await Promise.all([
        db.from('categories').select('id, name_en, name_ta, is_active, sort_order').order('sort_order'),
        db.from('orders')
          .select('id, invoice_no, customer_name, phone, address, created_at, total, status, order_mode, order_type, user_id, items, coupon_code, discount_amount, manual_discount_amount, delivery_charge, total_gst, gst_amount, payment_mode, payment_method, split_details, remarks, reference_number')
          .order('created_at', { ascending: false })
          .limit(1000),
        db.from('coupons')
          .select('id, code, percentage, is_active, expiry_date, usage_limit, usage_count, min_order_value')
          .order('created_at', { ascending: false }),
        expenseService.getExpenses(),
      ])
      if (cRes.error) throw cRes.error
      if (oRes.error) throw oRes.error
      const mappedOrders = (oRes.data || []).map(r => toDashboardOrder(r as Record<string, unknown>))
      setCats((cRes.data || []) as Category[])
      setOrders(mappedOrders)
      setSearchResults(mappedOrders.filter(o => normalizeOrderType(o.order_type) !== 'online_request').slice(0, 100))
      setCoupons((couponRes.data || []) as DashboardCoupon[])
      setExpenses(expList || [])

      const orderIds = mappedOrders.map(o => o.id).filter(Boolean)
      if (orderIds.length > 0) {
        let oi: unknown[] | null = null
        let orderItemsError: unknown = null
        const orderItemsResult = await db
          .from('order_items').select('order_id,product_id,variant_id,product_name,category,quantity,line_total,is_manual')
          .in('order_id', orderIds)
        oi = orderItemsResult.data
        orderItemsError = orderItemsResult.error

        if (orderItemsError) {
          const fallbackItemsResult = await db
            .from('order_items').select('order_id,product_id,variant_id,product_name,quantity,line_total,is_manual')
            .in('order_id', orderIds)
          oi = fallbackItemsResult.data
        }

        setOrderItems((oi || []).map(r => ({
          order_id: String((r as Record<string,unknown>).order_id || ''),
          product_id: (r as Record<string,unknown>).product_id != null ? String((r as Record<string,unknown>).product_id) : null,
          variant_id: (r as Record<string,unknown>).variant_id != null ? String((r as Record<string,unknown>).variant_id) : null,
          product_name: String((r as Record<string,unknown>).product_name || 'Product'),
          category: String((r as Record<string,unknown>).category || ''),
          quantity: toNumber((r as Record<string,unknown>).quantity, 0),
          line_total: toNumber((r as Record<string,unknown>).line_total, 0),
          is_manual: Boolean((r as Record<string,unknown>).is_manual),
        })))
      }

      await productsPromise
    } catch (err) { console.error('Dashboard load error', err) }
    finally { setLoading(false) }
  }, [fetchProducts])

  const loadUsers = useCallback(async () => {
    if (!isDatabaseConfigured) return
    setUsersLoading(true); setUsersError('')
    const { data, error } = await db
      .from('profiles')
      .select('id, email, name, mobile, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { setUsersError(error.message) }
    else { setAllUsers((data || []) as ProfileUser[]) }
    setUsersLoading(false)
  }, [])

  const loadCoupons = useCallback(async () => {
    if (!isDatabaseConfigured) return
    const { data } = await db
      .from('coupons')
      .select('id, code, percentage, is_active, expiry_date, usage_limit, usage_count, min_order_value')
      .order('created_at', { ascending: false })
    setCoupons((data || []) as DashboardCoupon[])
  }, [])

  const toggleUserRole = async (u: ProfileUser) => {
    const newRole = u.role === 'admin' ? 'customer' : 'admin'
    setRoleUpdating(u.id)
    const { error } = await db.from('profiles').update({ role: newRole }).eq('id', u.id)
    if (!error) {
      setAllUsers(prev => prev.map(p => p.id === u.id ? { ...p, role: newRole } : p))
    }
    setRoleUpdating(null)
  }

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const { error } = await db
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', orderId)
      if (error) {
        alert(`Failed to update order status: ${error.message}`)
        return
      }
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
      setSearchResults(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
    } catch (err: unknown) {
      alert(`Failed to update order status: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const startEditOrder = (o: DashboardOrder) => {
    setEditingOrder(o)
    setEditOrderForm({
      customer_name: o.customer_name || '',
      phone: o.phone || '',
      address: o.address || '',
      remarks: o.remarks || '',
      reference_number: o.reference_number || '',
      status: normalizeStatus(o.status) || 'completed',
    })
  }

  const saveOrderEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingOrder) return
    setSavingOrderEdit(true)
    try {
      const updatedFields = {
        customer_name: editOrderForm.customer_name.trim() || 'Customer',
        phone: editOrderForm.phone.trim(),
        address: editOrderForm.address.trim(),
        remarks: editOrderForm.remarks.trim(),
        reference_number: editOrderForm.reference_number.trim(),
        status: editOrderForm.status,
        updated_at: new Date().toISOString(),
      }
      const { error } = await db
        .from('orders')
        .update(updatedFields)
        .eq('id', editingOrder.id)

      if (error) {
        alert(`Failed to update order: ${error.message}`)
        return
      }

      setOrders(prev => prev.map(o => o.id === editingOrder.id ? { ...o, ...updatedFields } : o))
      setSearchResults(prev => prev.map(o => o.id === editingOrder.id ? { ...o, ...updatedFields } : o))
      setEditingOrder(null)
    } catch (err: unknown) {
      alert(`Error updating order: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingOrderEdit(false)
    }
  }

  const deleteOrder = async (orderId: string, invoiceNo: string) => {
    if (role === 'staff') return // staff cannot delete orders
    const bill = [...orders, ...searchResults].find(o => o.id === orderId)
    const billNo = formatInvoiceNo(invoiceNo)
    const billTotal = formatCurrency(toNumber(bill?.total, 0))
    const ok = await confirmDelete({
      title: `Permanently Delete Bill #${billNo}`,
      subtitle: bill ? `Customer: ${bill.customer_name || 'Walk-in'} • Date: ${new Date(bill.created_at).toLocaleDateString('en-GB')}` : undefined,
      warning: 'This bill and its line items will be permanently deleted from the Neon database. This cannot be undone.',
      impact: [
        { label: 'Invoice Number', value: `#${billNo}` },
        { label: 'Customer', value: bill?.customer_name || 'Walk-in' },
        { label: 'Bill Amount', value: billTotal, tone: 'danger' },
        { label: 'Revenue Analytics', value: `-${billTotal} (instantly dropped)`, tone: 'danger' },
        { label: 'Line Items', value: 'Permanently deleted with the bill', tone: 'warning' },
        { label: 'Inventory Stock', value: 'Not changed — adjust stock separately if needed', tone: 'warning' },
      ],
    })
    if (!ok) return
    // Clear FK reference in advance_orders first (if this order was created from an advance order)
    await db.from('advance_orders').update({ completed_order_id: null }).eq('completed_order_id', orderId)
    const { error } = await db.from('orders').delete().eq('id', orderId)
    if (error) {
      alert(`Error deleting order: ${error.message}`)
      return
    }
    // Track deleted ID so re-searches don't bring it back
    deletedOrderIds.current.add(orderId)
    setOrders(prev => prev.filter(o => o.id !== orderId))
    setSearchResults(prev => prev.filter(o => o.id !== orderId))
  }

  const getOrderWhatsAppPreview = (order: DashboardOrder) => {
    const rawItems = parseOrderItems(order.items)
    const fallbackItems = orderItems
      .filter(item => item.order_id === order.id)
      .map(item => ({ name: item.product_name, quantity: item.quantity, line_total: item.line_total }))
    const items = (rawItems.length ? rawItems : fallbackItems).map(normalizeStructuredOrderItem)
    if (!items.length) return null

    const subtotal = items.reduce((sum, item) => sum + toNumber(item.line_total, 0), 0)
    const message = buildProfessionalWhatsAppMessage({
      customerName: order.customer_name,
      phone: order.phone,
      invoiceNumber: order.invoice_no || order.id,
      invoiceDate: order.created_at,
      items: items.map(item => ({
        name: item.name,
        qty: item.quantity,
        unit: item.unit,
        unitType: item.unit_type,
        rate: item.base_price,
        lineTotal: item.line_total,
      })),
      subtotal,
      couponDiscount: order.discount_amount,
      manualDiscountAmount: order.manual_discount_amount,
      gstAmount: order.total_gst,
      shipping: order.delivery_charge,
      total: order.total,
    })
    return { items, subtotal, message, fileName: `Invoice-${order.invoice_no || order.id}.pdf` }
  }


  const handlePrintReceipt = (order: DashboardOrder) => {
    const preview = getOrderWhatsAppPreview(order)
    if (!preview) { alert('This order has no invoice details available.'); return }
    const subtotal = preview.subtotal

    printThermalReceipt({
      invoiceNo: order.invoice_no || order.id,
      date: order.created_at,
      customerName: order.customer_name,
      phone: order.phone,
      items: (preview.items as Array<{
        name?: string
        product_name?: string
        qty?: number
        quantity?: number
        unit?: string
        price?: number
        base_price?: number
        line_total?: number
      }>).map((item) => ({
        name: item.name || item.product_name || '',
        qty: item.qty || item.quantity || 0,
        unit: item.unit || '',
        price: item.price || item.base_price || 0,
        line_total: item.line_total || 0
      })),
      subtotal,
      shipping: order.delivery_charge || 0,
      couponDiscount: order.discount_amount || 0,
      manualDiscount: order.manual_discount_amount || 0,
      totalGst: order.total_gst || 0,
      total: order.total
    })
  }

  const openOrderInvoice = async (order: DashboardOrder, mode: 'view' | 'download' | 'print') => {
    if (mode === 'view') {
      setInvoicePreviewOrder(order)
      return
    }

    if (order.invoice_pdf_url) {
      const link = document.createElement('a')
      link.href = order.invoice_pdf_url
      if (mode === 'download') link.download = `Invoice-${order.invoice_no || order.id}.pdf`
      if (mode === 'download') { link.click(); return }
      const opened = window.open(order.invoice_pdf_url, '_blank', 'noopener,noreferrer')
      if (mode === 'print') opened?.addEventListener('load', () => opened.print())
      return
    }
    const preview = getOrderWhatsAppPreview(order)
    if (!preview) { alert('This order has no invoice details available.'); return }
    const file = invoicePdfFile({
      invoiceNo: order.invoice_no || order.id,
      date: order.created_at,
      customerName: order.customer_name,
      phone: order.phone,
      address: order.address,
      items: preview.items as unknown as Array<Record<string, unknown>>,
      subtotal: preview.subtotal,
      shipping: order.delivery_charge,
      discountAmount: order.discount_amount,
      manualDiscountAmount: order.manual_discount_amount,
      gstAmount: order.total_gst,
      paymentMode: formatPaymentLabel(order.payment_mode, order.split_details) || order.payment_mode,
      total: order.total,
    })
    const url = URL.createObjectURL(file)
    if (mode === 'download') {
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (mode === 'print') opened?.addEventListener('load', () => opened.print())
  }

  const generateCouponCode = () => {
    const prefixes = ['SAVE', 'STYLE', 'BOUTIQUE', 'SHOP', 'SPECIAL', 'FASHION', 'NEW']
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const suffix = Math.floor(Math.random() * 90 + 10)
    setCouponForm(f => ({ ...f, code: `${prefix}${suffix}` }))
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const saveCoupon = async (e: FormEvent) => {
    e.preventDefault()
    setCouponSaveError('')
    setCouponSaveSuccess('')
    if (!couponForm.code.trim()) { setCouponSaveError('Coupon code is required'); return }
    if (!(toNumber(couponForm.percentage, 0) > 0 && toNumber(couponForm.percentage, 0) <= 100)) {
      setCouponSaveError('Discount must be between 1% and 100%'); return
    }
    const code = couponForm.code.trim().toUpperCase()
    const payload = {
      code,
      percentage: toNumber(couponForm.percentage, 0),
      is_active: true,
      expiry_date: couponForm.expiry_date || null,
      usage_limit: couponForm.usage_limit ? toNumber(couponForm.usage_limit, 0) : null,
      min_order_value: toNumber(couponForm.min_order_value, 0),
    }
    let error: unknown = null
    if (editingCouponId !== null) {
      // Update existing - don't change code (it's the PK equivalent)
      const res = await db.from('coupons').update({ ...payload }).eq('id', editingCouponId)
      error = res.error
    } else {
      // Insert new coupon - UNIQUE constraint on code catches duplicates
      const res = await db.from('coupons').insert(payload)
      error = res.error
    }
    if (error) {
      const msg = (error as { message?: string }).message || 'Failed to save coupon'
      if (msg.toLowerCase().includes('row-level security')) {
        setCouponSaveError('Coupon save was blocked by Supabase RLS. Confirm your user has the admin role.')
      } else {
        setCouponSaveError(msg.includes('unique') || msg.includes('duplicate') ? `Coupon code "${code}" already exists` : msg)
      }
    } else {
      setCouponForm({ code: '', percentage: '', expiry_date: '', usage_limit: '', min_order_value: '' })
      setEditingCouponId(null)
      setCouponSaveSuccess(editingCouponId !== null ? 'Coupon updated!' : 'Coupon created!')
      await loadCoupons()
    }
  }

  const startEditCoupon = (coupon: DashboardCoupon) => {
    setEditingCouponId(coupon.id)
    setCouponForm({
      code: coupon.code,
      percentage: coupon.percentage ?? '',
      expiry_date: coupon.expiry_date ? coupon.expiry_date.slice(0, 10) : '',
      usage_limit: coupon.usage_limit !== null ? String(coupon.usage_limit) : '',
      min_order_value: coupon.min_order_value ? String(coupon.min_order_value) : '',
    })
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const cancelEditCoupon = () => {
    setEditingCouponId(null)
    setCouponForm({ code: '', percentage: '', expiry_date: '', usage_limit: '', min_order_value: '' })
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const deleteCoupon = async (coupon: DashboardCoupon) => {
    const ok = await confirmDelete({
      title: `Permanently Delete Coupon ${coupon.code}`,
      subtitle: `${coupon.percentage}% off • ${coupon.is_active ? 'Active' : 'Inactive'}`,
      warning: 'This coupon will be permanently deleted. Customers will no longer be able to apply it at billing.',
      impact: [
        { label: 'Coupon Code', value: coupon.code },
        { label: 'Discount', value: `${coupon.percentage}%` },
        { label: 'Past Bills', value: 'Keep the discount already applied', tone: 'success' },
        { label: 'Billing Panel', value: 'Code stops working immediately', tone: 'danger' },
      ],
    })
    if (!ok) return
    await db.from('coupons').delete().eq('id', coupon.id)
    await loadCoupons()
  }

  const toggleCoupon = async (coupon: DashboardCoupon) => {
    await db.from('coupons').update({ is_active: !coupon.is_active }).eq('id', coupon.id)
    await loadCoupons()
  }

  // Keep a stable ref to the debounced loader so realtime events don't
  // trigger a full data reload more than once every 4 seconds.
  const debouncedLoadRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    debouncedLoadRef.current = debounce(() => void loadData(), 350)
  }, [loadData])

  useEffect(() => {
    if (!isAdmin) return
    void loadData()
    if (!isDatabaseConfigured) return
    const handleChange = () => debouncedLoadRef.current?.()
    const ch = db.channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, handleChange)
      .subscribe()
    return () => { void db.removeChannel(ch) }
  }, [isAdmin, loadData])

  useEffect(() => {
    if (tab === 'users') void loadUsers()
    if (tab === 'coupons' || tab === 'pos_analytics') void loadCoupons()
    if (tab === 'history') void loadData()
  }, [tab, loadUsers, loadCoupons, loadData])

  useEffect(() => {
    if (tab === 'pos_analytics' && posAnalyticsTab === 'coupons') {
      void loadCoupons()
    }
  }, [tab, posAnalyticsTab, loadCoupons])

  const applyAnalyticsPreset = (preset: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom') => {
    setAnalyticsDatePreset(preset)
    if (preset === 'all')    { setAnalyticsDateFrom(''); setAnalyticsDateTo(''); return }
    if (preset === 'custom') return
    const today = new Date()
    const todayStr = toLocalDateKey(today)
    if (preset === 'today') {
      setAnalyticsDateFrom(todayStr); setAnalyticsDateTo(todayStr)
    } else if (preset === 'week') {
      // Calendar week: Monday → Sunday of the current week
      const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
      setAnalyticsDateFrom(toLocalDateKey(monday)); setAnalyticsDateTo(toLocalDateKey(sunday))
    } else if (preset === 'month') {
      setAnalyticsDateFrom(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
      setAnalyticsDateTo(toLocalDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
    } else if (preset === 'year') {
      setAnalyticsDateFrom(`${today.getFullYear()}-01-01`); setAnalyticsDateTo(`${today.getFullYear()}-12-31`)
    }
  }

  const applyDatePreset = (preset: 'today' | 'week' | 'month' | 'year' | 'custom') => {
    setDatePreset(preset)
    if (preset === 'custom') {
      setSearch(s => ({ ...s, dateFrom: '', dateTo: '' }))
      return
    }
    const today = new Date()
    const todayStr = toLocalDateKey(today)
    let from = todayStr
    let to = todayStr

    if (preset === 'today') {
      from = todayStr
    } else if (preset === 'week') {
      // Calendar week: Monday → Sunday of the current week
      const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
      from = toLocalDateKey(monday)
      to = toLocalDateKey(sunday)
    } else if (preset === 'month') {
      from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
      to = toLocalDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0))
    } else if (preset === 'year') {
      from = `${today.getFullYear()}-01-01`
      to = `${today.getFullYear()}-12-31`
    }

    setSearch(s => ({ ...s, dateFrom: from, dateTo: to }))
    void runSearch(undefined, { dateFrom: from, dateTo: to })
  }

  const handleClearHistoryFilters = () => {
    setHistoryQuickSearch('')
    setSearch({ invoiceNo: '', phone: '', customerName: '', dateFrom: '', dateTo: '' })
    setDatePreset('')
    setBillTypeFilter('all')
    setShowAdvancedFilters(false)
    void runSearch(undefined, { dateFrom: '', dateTo: '' })
  }

  const activeHistoryFiltersCount = useMemo(() => {
    let count = 0
    if (billTypeFilter !== 'all') count++
    if (datePreset || search.dateFrom || search.dateTo) count++
    if (search.invoiceNo.trim()) count++
    if (search.customerName.trim()) count++
    if (search.phone.trim()) count++
    return count
  }, [billTypeFilter, datePreset, search])

  // Order search - POS bills only (online_request excluded)
  const runSearch = async (e?: FormEvent, overrideDates?: { dateFrom?: string; dateTo?: string }) => {
    e?.preventDefault()
    setSearchLoading(true)
    try {
      const qText = historyQuickSearch.trim()
      const invInput = search.invoiceNo.trim()
      const phoneInput = search.phone.trim()
      const custInput = search.customerName.trim()
      const hasQuery = Boolean(qText || invInput || phoneInput || custInput)
      const effectiveDateFrom = overrideDates !== undefined ? (overrideDates.dateFrom ?? '') : search.dateFrom
      const effectiveDateTo = overrideDates !== undefined ? (overrideDates.dateTo ?? '') : search.dateTo

      let q = db.from('orders')
        .select('id, invoice_no, customer_name, phone, address, created_at, total, status, order_mode, order_type, items, coupon_code, discount_amount, manual_discount_amount, delivery_charge, total_gst, gst_amount, payment_mode, payment_method, split_details, remarks, reference_number')
        .neq('order_type', 'online_request')
        .order('created_at', { ascending: false })
        .limit(hasQuery ? 1000 : 500)

      if (qText) {
        const digitsOnly = qText.replace(/\D/g, '')
        const nonZeroDigits = digitsOnly.replace(/^0+/, '')
        const conds = [
          `invoice_no.ilike.%${qText}%`,
          `customer_name.ilike.%${qText}%`,
          `phone.ilike.%${qText}%`
        ]
        if (digitsOnly && digitsOnly !== qText) {
          conds.push(`invoice_no.ilike.%${digitsOnly}%`)
          if (digitsOnly.length >= 4) conds.push(`phone.ilike.%${digitsOnly}%`)
        }
        if (nonZeroDigits && nonZeroDigits !== digitsOnly && nonZeroDigits !== qText) {
          conds.push(`invoice_no.ilike.%${nonZeroDigits}%`)
        }
        q = q.or(conds.join(','))
      }

      if (invInput) {
        const digitsOnly = invInput.replace(/\D/g, '')
        const nonZeroDigits = digitsOnly.replace(/^0+/, '')
        const conds = [`invoice_no.ilike.%${invInput}%`]
        if (digitsOnly && digitsOnly !== invInput) conds.push(`invoice_no.ilike.%${digitsOnly}%`)
        if (nonZeroDigits && nonZeroDigits !== digitsOnly && nonZeroDigits !== invInput) conds.push(`invoice_no.ilike.%${nonZeroDigits}%`)
        q = q.or(conds.join(','))
      }

      if (phoneInput) {
        const digitsOnly = phoneInput.replace(/\D/g, '')
        if (digitsOnly && digitsOnly.length >= 4) {
          q = q.or(`phone.ilike.%${phoneInput}%,phone.ilike.%${digitsOnly}%`)
        } else {
          q = q.ilike('phone', `%${phoneInput}%`)
        }
      }

      if (custInput) {
        q = q.ilike('customer_name', `%${custInput}%`)
      }

      // Apply date filters using local midnight / end-of-day ISO bounds
      if (effectiveDateFrom) {
        const fromDate = new Date(`${effectiveDateFrom}T00:00:00`)
        q = q.gte('created_at', fromDate.toISOString())
      }
      if (effectiveDateTo) {
        const toDate = new Date(`${effectiveDateTo}T23:59:59.999`)
        q = q.lte('created_at', toDate.toISOString())
      }


      const { data, error } = await q
      if (error) throw error

      let results = (data || []).map(r => toDashboardOrder(r as Record<string, unknown>))

      // Client-side match filter to handle formatted invoice numbers and local calendar dates
      const matchOrder = (o: DashboardOrder) => {
        if (effectiveDateFrom && toLocalDateKey(o.created_at) < effectiveDateFrom) return false
        if (effectiveDateTo && toLocalDateKey(o.created_at) > effectiveDateTo) return false

        if (qText) {
          const qLower = qText.toLowerCase()
          const matchInv = o.invoice_no.toLowerCase().includes(qLower) || formatInvoiceNo(o.invoice_no).toLowerCase().includes(qLower) || o.id.toLowerCase() === qLower
          const matchCust = o.customer_name.toLowerCase().includes(qLower)
          const matchPhone = o.phone.toLowerCase().includes(qLower)
          const qDigits = qText.replace(/\D/g, '')
          const rawInvDigits = o.invoice_no.replace(/\D/g, '')
          const rawPhoneDigits = o.phone.replace(/\D/g, '')
          const matchInvDigits = Boolean(qDigits && (rawInvDigits.endsWith(qDigits) || rawInvDigits.includes(qDigits)))
          const matchPhoneDigits = Boolean(qDigits && qDigits.length >= 4 && rawPhoneDigits.includes(qDigits))
          if (!matchInv && !matchCust && !matchPhone && !matchInvDigits && !matchPhoneDigits) return false
        }
        if (invInput) {
          const matchRaw = o.invoice_no.toLowerCase().includes(invInput.toLowerCase())
          const matchFmt = formatInvoiceNo(o.invoice_no).toLowerCase().includes(invInput.toLowerCase())
          const matchId  = o.id.toLowerCase() === invInput.toLowerCase()
          const invDigits = invInput.replace(/\D/g, '')
          const rawDigits = o.invoice_no.replace(/\D/g, '')
          const matchDigits = invDigits && (rawDigits.endsWith(invDigits) || rawDigits.includes(invDigits))
          if (!matchRaw && !matchFmt && !matchId && !matchDigits) return false
        }
        if (custInput) {
          const matchCust = o.customer_name.toLowerCase().includes(custInput.toLowerCase())
          if (!matchCust) return false
        }
        if (phoneInput) {
          const pDigits = phoneInput.replace(/\D/g, '')
          const rawPhoneDigits = o.phone.replace(/\D/g, '')
          const matchPhoneRaw = o.phone.toLowerCase().includes(phoneInput.toLowerCase())
          const matchPhoneDigits = Boolean(pDigits && rawPhoneDigits.includes(pDigits))
          if (!matchPhoneRaw && !matchPhoneDigits) return false
        }
        return true
      }

      if (hasQuery || effectiveDateFrom || effectiveDateTo) {
        results = results.filter(matchOrder)
      }
      if (billTypeFilter !== 'all') results = results.filter(o => getBillType(o) === billTypeFilter)

      // Fallback: if query returned no results from Supabase, search in pre-loaded orders
      if (results.length === 0 && orders.length > 0) {
        const localMatches = orders.filter(o => {
          if (normalizeOrderType(o.order_type) === 'online_request') return false
          if (billTypeFilter === 'manual' && getBillType(o) !== 'manual') return false
          if (billTypeFilter === 'offline' && getBillType(o) !== 'offline') return false
          if (billTypeFilter === 'online' && getBillType(o) !== 'online') return false
          return matchOrder(o)
        })
        if (localMatches.length > 0) {
          results = localMatches
        }
      }

      setSearchResults(results.filter(o => !deletedOrderIds.current.has(o.id)))
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  // ΓöÇΓöÇ Product CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const handleSaveProd = async (e: FormEvent) => {
    e.preventDefault()
    setProductNotice('')
    setLoading(true)
    try {
      const unitType = normalizeUnitType(prodForm.unitType)

      // Parse predefined options from text
      let predefined_options: unknown[] = []
      if (prodForm.predefinedOptionsText.trim() && (unitType === 'weight' || unitType === 'volume')) {
        const baseUnit = unitType === 'weight' ? 'g' : 'ml'
        predefined_options = prodForm.predefinedOptionsText.split(',').map(s => s.trim()).filter(Boolean).map(raw => {
          const m = raw.match(/^([0-9.]+)\s*(g|kg|ml|l)?$/i)
          if (!m) return null
          let qty = parseFloat(m[1])
          const unit = (m[2] || baseUnit).toLowerCase()
          if (unit === 'kg') qty *= 1000
          if (unit === 'l')  qty *= 1000
          const label = unit === 'kg' ? `${parseFloat(m[1])}kg` : unit === 'l' ? `${parseFloat(m[1])}L` : `${qty}${baseUnit}`
          return { quantity: qty, unit: baseUnit, label }
        }).filter(Boolean)
      }

      const payload = {
        name: prodForm.name.trim(), name_ta: prodForm.nameTa.trim(), tamil_name: prodForm.nameTa.trim(),
        category: prodForm.category.trim(), category_id: prodForm.categoryId || null,
        remedy: prodForm.remedy, price: toNumber(prodForm.price, 0),
        offer_price: prodForm.offerPrice === '' ? null : toNumber(prodForm.offerPrice, 0),
        purchase_price: prodForm.purchasePrice === '' ? null : toNumber(prodForm.purchasePrice, 0),
        mrp: prodForm.mrp === '' ? null : toNumber(prodForm.mrp, 0),
        sku: prodForm.sku || null,
        barcode: prodForm.barcode || null,
        unit_type: unitType, unit_label: prodForm.unitLabel,
        base_quantity: toNumber(prodForm.baseQuantity, 1),
        stock_quantity: toNumber(prodForm.stockQuantity, 0),
        stock: Math.floor(toNumber(prodForm.stockQuantity, 0)),
        allow_decimal_quantity: prodForm.allowDecimalQuantity,
        predefined_options: predefined_options.length > 0 ? predefined_options : [],
        is_active: prodForm.isActive, sort_order: toNumber(prodForm.sortOrder, 0),
        has_variants: !!(prodForm as Record<string, unknown>).hasVariants,
        description: prodForm.description, benefits: prodForm.benefits,
        image_url: prodForm.image || '/product-placeholder.svg',
        image:     prodForm.image || '/product-placeholder.svg',
      }

      const { error } = editingProd
        ? await db.from('products').update(payload).eq('id', editingProd.id)
        : await db.from('products').insert(payload)
      if (error) throw error
      setProductNotice(editingProd ? 'Product updated!' : 'Product added!')
      setEditingProd(null); setProdForm(emptyForm)
      await loadData()
    } catch (err) { setProductNotice(toErr(err, 'Error saving product')) }
    finally { setLoading(false) }
  }

  const handleEdit = (p: Product) => {
    setEditingProd(p)
    const optText = (p.predefinedOptions || []).map(o => o.label).join(', ')
    setProdForm({
      name: p.name, nameTa: p.nameTa || p.tamilName || '', category: p.category,
      categoryId: p.categoryId ?? null, remedy: p.remedy || [],
      price: p.price, offerPrice: p.offerPrice || '',
      purchasePrice: p.purchasePrice || '', mrp: p.mrp || '',
      sku: p.sku || '', barcode: p.barcode || '',
      unitType: p.unitType,
      unitLabel: p.unitLabel, baseQuantity: p.baseQuantity,
      stockQuantity: p.stockQuantity || p.stock, stockUnit: p.stockUnit,
      allowDecimalQuantity: p.allowDecimalQuantity, predefinedOptionsText: optText,
      isActive: p.isActive, sortOrder: p.sortOrder, stock: p.stock,
      description: p.description, descriptionTa: p.descriptionTa || '',
      benefits: p.benefits || '', benefitsTa: p.benefitsTa || '',
      image: p.image || p.imageUrl || '',
      hasVariants: p.hasVariants ?? false,
    } as typeof prodForm)
    setVariantNotice('')
    setEditingVariantId(null)
    setVariantForm({ name: '', sizeLabel: '', price: '', purchasePrice: '', mrp: '', sku: '', barcode: '', stock: '50', weightValue: '', weightUnit: '', isDefault: false })
    setTab('products')
  }

  const handleToggleActive = async (p: Product) => {
    const { error } = await db.from('products').update({ is_active: !p.isActive }).eq('id', p.id)
    if (error) { setProductNotice(error.message); return }
    setProductNotice(`Product ${p.isActive ? 'deactivated' : 'activated'}`)
    await loadData()
  }

  const handleDeleteProd = async (id: string | number) => {
    const prod = products.find(p => String(p.id) === String(id))
    const ok = await confirmDelete({
      title: `Remove Product${prod ? ` “${prod.name}”` : ''}`,
      subtitle: prod ? `Category: ${prod.category || 'General'} • Stock: ${prod.stock}` : undefined,
      warning: 'This product will be deactivated and hidden from billing and the catalogue. Its sales history is kept.',
      impact: [
        { label: 'Product', value: prod?.name || String(id) },
        { label: 'Billing Panel', value: 'Hidden immediately', tone: 'danger' },
        { label: 'Past Bills & Analytics', value: 'Kept unchanged', tone: 'success' },
        { label: 'Undo', value: 'Can be re-activated later', tone: 'success' },
      ],
      confirmLabel: 'Remove Product',
    })
    if (!ok) return
    const { error } = await db.from('products').update({ is_active: false }).eq('id', id)
    if (error) { setProductNotice(error.message); return }
    setProductNotice('Product deactivated'); await loadData()
  }

  const handleSaveVariant = async (e: import('react').FormEvent) => {
    e.preventDefault()
    if (!editingProd) return
    setVariantLoading(true)
    setVariantNotice('')
    const price = Number(variantForm.price)
    const stock = Number(variantForm.stock)
    if (!variantForm.name.trim()) { setVariantNotice('Variant name required'); setVariantLoading(false); return }
    if (!(price > 0)) { setVariantNotice('Enter valid price'); setVariantLoading(false); return }
    try {
      const payload = {
        productId:   String(editingProd.id),
        variantName: variantForm.name.trim(),
        sizeLabel:   variantForm.sizeLabel.trim() || null,
        price,
        stock,
        purchasePrice: variantForm.purchasePrice ? Number(variantForm.purchasePrice) : null,
        mrp:         variantForm.mrp ? Number(variantForm.mrp) : null,
        sku:         variantForm.sku.trim() || null,
        barcode:     variantForm.barcode.trim() || null,
        weightValue: variantForm.weightValue ? Number(variantForm.weightValue) : null,
        weightUnit:  variantForm.weightUnit.trim() || null,
        isDefault:   variantForm.isDefault,
        sortOrder:   getVariants(String(editingProd.id)).length,
      }
      if (editingVariantId) {
        const { error } = await updateVariant(editingVariantId, payload)
        if (error) throw new Error(error)
        setVariantNotice('Variant updated!')
      } else {
        const { error } = await createVariant(payload)
        if (error) throw new Error(error)
        setVariantNotice('Variant added!')
        // Ensure product has_variants = true
        if (!editingProd.hasVariants) {
          await db.from('products').update({ has_variants: true }).eq('id', editingProd.id)
        }
      }
      setVariantForm({ name: '', sizeLabel: '', price: '', purchasePrice: '', mrp: '', sku: '', barcode: '', stock: '50', weightValue: '', weightUnit: '', isDefault: false })
      setEditingVariantId(null)
      await refetchVariants()
    } catch (err) { setVariantNotice(toErr(err, 'Error saving variant')) }
    finally { setVariantLoading(false) }
  }

  const handleDeleteVariant = async (variantId: string) => {
    const ok = await confirmDelete({
      title: 'Permanently Delete Variant',
      warning: 'This size / variant and its stock count will be permanently deleted from the Neon database.',
      impact: [
        { label: 'Variant Stock', value: 'Removed with the variant', tone: 'danger' },
        { label: 'Past Bills', value: 'Kept; the line no longer links to this variant', tone: 'success' },
        { label: 'Barcodes', value: 'Deletion is blocked while a barcode uses this variant', tone: 'warning' },
      ],
    })
    if (!ok) return
    const { error } = await deleteVariant(variantId)
    if (error) { setVariantNotice(error); return }
    setVariantNotice('Variant removed')
    await refetchVariants()
  }

  const handleSetDefault = async (variantId: string) => {
    if (!editingProd) return
    const { error } = await setDefaultVariant(variantId, String(editingProd.id))
    if (!error) { setVariantNotice('Default updated'); await refetchVariants() }
  }

  const startEditVariant = (v: ProductVariant) => {
    setEditingVariantId(v.id)
    setVariantForm({
      name: v.variantName, sizeLabel: v.sizeLabel || '', price: String(v.price),
      purchasePrice: String(v.purchasePrice || ''), mrp: String(v.mrp || ''),
      sku: v.sku || '', barcode: v.barcode || '',
      stock: String(v.stock), weightValue: String(v.weightValue || ''), weightUnit: v.weightUnit || '', isDefault: !!v.isDefault
    })
    setVariantNotice('')
  }

  const handleUploadImage = async (file?: File) => {
    if (!file) return
    setImageUploading(true)
    try { const url = await uploadProductImage(file); setProdForm(p => ({ ...p, image: url })); setProductNotice('Image uploaded!') }
    catch (err) { setProductNotice(toErr(err, 'Upload failed')) }
    finally { setImageUploading(false) }
  }

  const onAddCat = async (e: FormEvent) => {
    e.preventDefault()
    if (!newCat.name_en.trim()) return
    const payload = { ...newCat, name_en: newCat.name_en.trim() }
    const { error } = editingCategoryId === null
      ? await db.from('categories').insert({ ...payload, is_active: true })
      : await db.from('categories').update(payload).eq('id', editingCategoryId)
    if (error) {
      setCategoryNotice({ type: 'error', text: error.message || 'Could not add category.' })
      return
    }
    const wasEditing = editingCategoryId !== null
    setNewCat({ name_en: '', name_ta: '' })
    setEditingCategoryId(null)
    setCategoryNotice({ type: 'success', text: wasEditing ? 'Category updated successfully.' : 'Category added successfully.' })
    await loadData()
  }

  const deleteCat = async (c: Category) => {
    const linked = products.filter(p => String(p.categoryId ?? '') === String(c.id)).length
    const ok = await confirmDelete({
      title: `Permanently Delete Category “${c.name_en}”`,
      warning: 'This category will be permanently deleted. Products in it are kept and moved to “Uncategorized”.',
      impact: [
        { label: 'Category', value: c.name_en },
        { label: 'Products Affected', value: `${linked} moved to Uncategorized`, tone: linked > 0 ? 'warning' : 'default' },
        { label: 'Past Bills', value: 'Kept unchanged', tone: 'success' },
      ],
    })
    if (!ok) return
    const { error: linkedProductsError } = await db
      .from('products')
      .update({ category: 'Uncategorized', category_id: null })
      .eq('category_id', c.id)
    if (linkedProductsError) {
      setCategoryNotice({ type: 'error', text: linkedProductsError.message || 'Could not unlink products from category.' })
      return
    }
    const { error: legacyProductsError } = await db
      .from('products')
      .update({ category: 'Uncategorized', category_id: null })
      .eq('category', c.name_en)
    if (legacyProductsError) {
      setCategoryNotice({ type: 'error', text: legacyProductsError.message || 'Could not sync products.' })
      return
    }
    const { error } = await db.from('categories').delete().eq('id', c.id)
    if (error) {
      setCategoryNotice({ type: 'error', text: error.message || 'Could not delete category.' })
      return
    }
    if (prodForm.categoryId === c.id || prodForm.category === c.name_en) {
      setProdForm(form => ({ ...form, category: '', categoryId: null }))
    }
    setCategoryNotice({ type: 'success', text: `"${c.name_en}" deleted.` })
    await loadData()
  }

  const toggleCat = async (c: Category) => {
    // Optimistic update
    setCats(prev => prev.map(cat => cat.id === c.id ? { ...cat, is_active: !c.is_active } : cat))
    const { error } = await db.from('categories').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) {
      setCategoryNotice({ type: 'error', text: 'Failed to update category status.' })
      // Revert on error
      setCats(prev => prev.map(cat => cat.id === c.id ? { ...cat, is_active: c.is_active } : cat))
    }
  }

  const moveCat = async (c: Category, dir: 'up' | 'down') => {
    const currentIndex = cats.findIndex(cat => cat.id === c.id)
    if (dir === 'up' && currentIndex > 0) {
      const prevCat = cats[currentIndex - 1]
      const normalizedCats = cats.map((cat, i) => ({ ...cat, sort_order: i * 10 }))
      const currentNormalized = normalizedCats[currentIndex]
      const prevNormalized = normalizedCats[currentIndex - 1]
      
      const temp = currentNormalized.sort_order
      currentNormalized.sort_order = prevNormalized.sort_order
      prevNormalized.sort_order = temp
      
      setCats(normalizedCats.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      
      await Promise.all([
        db.from('categories').update({ sort_order: currentNormalized.sort_order }).eq('id', c.id),
        db.from('categories').update({ sort_order: prevNormalized.sort_order }).eq('id', prevCat.id)
      ])
    } else if (dir === 'down' && currentIndex < cats.length - 1) {
      const nextCat = cats[currentIndex + 1]
      const normalizedCats = cats.map((cat, i) => ({ ...cat, sort_order: i * 10 }))
      const currentNormalized = normalizedCats[currentIndex]
      const nextNormalized = normalizedCats[currentIndex + 1]
      
      const temp = currentNormalized.sort_order
      currentNormalized.sort_order = nextNormalized.sort_order
      nextNormalized.sort_order = temp
      
      setCats(normalizedCats.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      
      await Promise.all([
        db.from('categories').update({ sort_order: currentNormalized.sort_order }).eq('id', c.id),
        db.from('categories').update({ sort_order: nextNormalized.sort_order }).eq('id', nextCat.id)
      ])
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem('dashboard-sidebar-collapsed', sidebarCollapsed ? '1' : '0')
    } catch {
      // Ignore persistence failures in private mode or restricted storage.
    }
  }, [sidebarCollapsed])

  // Auto-refresh analytics data every 30 seconds
  useEffect(() => {
    if (tab !== 'pos_analytics' || (posAnalyticsTab !== 'today' && posAnalyticsTab !== 'products' && posAnalyticsTab !== 'categories' && posAnalyticsTab !== 'coupons')) return
    const interval = setInterval(() => { void loadData() }, 30000)
    return () => clearInterval(interval)
  }, [tab, posAnalyticsTab, loadData])

  if (!isAdmin) return (
    <div className="min-h-screen bg-bgMain flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-sm">
        <AlertCircle className="mx-auto text-red-400 mb-4" size={48} />
        <h2 className="text-2xl font-black mb-2">{l('Unauthorized', 'அன� மதி இல� லை')}</h2>
        <Link to="/" className="px-6 py-3 bg-sageDark text-white rounded-xl font-bold inline-block mt-4">{l('Go Home', 'ம� கப� பிற� க� ')}</Link>
      </div>
    </div>
  )

  const navItems: Array<{ id: TabKey; icon: React.ReactNode; label: string; badge?: number }> = role === 'staff'
    ? [
        { id: 'billing',        icon: <Receipt size={20} />,           label: 'Billing Panel' },
        { id: 'advance_orders', icon: <Clock size={20} />,             label: 'Advance Orders' },
        { id: 'history',        icon: <History size={20} />,           label: 'Order History' },
        { id: 'inventory',      icon: <Boxes size={20} />,             label: 'Inventory', badge: lowStockCount },
        { id: 'expenses',       icon: <Wallet size={20} />,            label: 'Expense Tracker' },
        { id: 'birthdays',      icon: <Gift size={20} />,              label: 'Birthdays' },
      ]
    : [
        { id: 'billing',        icon: <Receipt size={20} />,           label: 'Billing Panel' },
        { id: 'advance_orders', icon: <Clock size={20} />,             label: 'Advance Orders' },
        { id: 'history',        icon: <History size={20} />,           label: 'Order History' },
        { id: 'inventory',      icon: <Boxes size={20} />,             label: 'Inventory', badge: lowStockCount },
        { id: 'pos_analytics',  icon: <ChartNoAxesColumn size={20} />, label: 'Analytics Dashboard' },
        { id: 'expenses',       icon: <Wallet size={20} />,            label: 'Expense Tracker' },
        { id: 'attendance',     icon: <UserCheck size={20} />,         label: 'Attendance' },
        { id: 'birthdays',      icon: <Gift size={20} />,              label: 'Birthdays' },
        { id: 'coupons',        icon: <TicketPercent size={20} />,     label: 'Coupons' },
        { id: 'settings',       icon: <Settings2 size={20} />,         label: 'Settings' },
      ]

  return (
    <div className="admin-shell h-[100dvh] max-h-[100dvh] min-h-0 bg-bgMain flex flex-col lg:flex-row overflow-hidden">
      {/* Sidebar */}
      <aside
        className={[
          'w-full bg-primary bg-gradient-to-b from-primary to-primary/90 text-white border-b lg:border-b-0 border-white/10 flex flex-col shrink-0 h-auto lg:h-full lg:max-h-screen',
          'transition-[width] duration-300 ease-in-out overflow-hidden',
          sidebarCollapsed ? 'lg:w-[84px]' : 'lg:w-[272px]',
        ].join(' ')}
      >
        {/* Desktop brand header */}
        <div className={`hidden lg:flex items-center relative transition-all duration-300 shrink-0 ${sidebarCollapsed ? 'flex-col items-center pt-5 pb-4 px-2 gap-2 border-b border-white/20' : 'p-6 justify-between gap-3 border-b border-white/20'}`}>
          <Link to="/pos" title="Go to Billing Panel" className={`flex items-center gap-2.5 min-w-0 transition-all duration-300 ${sidebarCollapsed ? 'justify-center' : 'flex-1'}`}>
            <div className="shrink-0 w-12 h-12 rounded-xl shadow-md overflow-hidden">
              <img src={BRAND_ICON} alt={BRAND_EN} className="w-full h-full object-cover" />
            </div>
            {!sidebarCollapsed && (
              <div className="flex flex-col min-w-0">
                <h1 className="text-sm leading-tight font-black tracking-tight text-white break-words">{BRAND_EN}</h1>
                {BRAND_TAGLINE && <p className="mt-0.5 text-[9px] leading-snug font-bold tracking-wider text-white/80 break-words">{BRAND_TAGLINE}</p>}
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((state) => !state)}
            className={`flex items-center justify-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition-colors shrink-0 cursor-pointer ${sidebarCollapsed ? 'h-7 w-7 bg-white/10' : 'h-9 w-9'}`}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronDown size={16} className="-rotate-90" /> : <X size={22} strokeWidth={1.75} />}
          </button>
        </div>
        {/* Mobile mini-header */}
        <div className="flex lg:hidden items-center justify-between px-3 py-2 border-b border-white/10 bg-primary shrink-0 gap-2">
          <Link to="/pos" title="Go to Billing Panel" className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <div className="h-9 w-9 rounded-xl shrink-0 shadow-sm hover:scale-105 transition-transform overflow-hidden">
              <img src={BRAND_ICON} alt={BRAND_EN} className="w-full h-full object-cover" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
              <span className="text-[13px] sm:text-[14px] font-black text-white tracking-wide truncate min-w-0">
                {BRAND_EN}
              </span>
              <span className="shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded whitespace-nowrap bg-white/10 text-white/85 border border-white/20">
                {role === 'admin' ? 'ADMIN' : 'STAFF'}
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => {
              useAdminAuthStore.getState().logout()
              navigate('/admin-login', { replace: true })
            }}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-white/80 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/10 active:bg-white/20 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Power size={13} className="text-red-400 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
        {/* Nav List - Height safe and scrollable */}
        <nav
          className={`flex overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto lg:flex-col gap-1 lg:gap-2 px-2 py-2 lg:py-6 flex-1 min-h-0 transition-all duration-300 hide-scrollbar ${sidebarCollapsed ? 'lg:px-2' : 'lg:px-4'}`}
        >
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleTabClick(item.id)}
              title={item.label}
              className={[
                'shrink-0 flex flex-col lg:flex-row items-center justify-center lg:justify-start',
                'gap-1 lg:gap-4',
                'h-[48px] min-w-[64px] lg:min-w-0 lg:w-full lg:h-auto',
                sidebarCollapsed ? 'lg:w-[52px] lg:justify-center mx-auto' : 'lg:px-4',
                'px-1.5 py-1 lg:py-3.5',
                'rounded-xl font-bold uppercase tracking-wider text-[9.5px] lg:text-xs transition-colors overflow-hidden cursor-pointer',
                tab === item.id ? 'bg-white text-[#27272A] shadow-md' : 'text-white/90 hover:bg-white/20 hover:text-white',
              ].join(' ')}
            >
              <span className="shrink-0 flex items-center">
                {item.icon}
              </span>
              <span className={`hidden lg:block truncate text-left transition-all duration-200 ${sidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'opacity-100 flex-1'}`}>
                {item.label}
              </span>
              {!!item.badge && !sidebarCollapsed && (
                <span className="hidden lg:flex h-[26px] min-w-[26px] shrink-0 items-center justify-center rounded-full bg-[#DC2626] px-1.5 text-[12px] font-black text-white ring-2 ring-white/90">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Desktop Logout Button anchored at bottom */}
        <div className={`hidden lg:block shrink-0 pb-6 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}>
          <div className="border-t border-white/20 mb-4" />
          <button
            onClick={() => {
              useAdminAuthStore.getState().logout()
              navigate('/admin-login', { replace: true })
            }}
            className={[
              'shrink-0 flex items-center justify-center lg:justify-start',
              'gap-4',
              'w-full py-3.5',
              sidebarCollapsed ? 'lg:w-[52px] lg:justify-center mx-auto' : 'lg:px-4',
              'rounded-xl border border-white/20 bg-white/10 font-bold uppercase tracking-wider text-xs transition-all text-white hover:bg-white/25 hover:shadow-md overflow-hidden cursor-pointer',
            ].join(' ')}
          >
            <span className="shrink-0"><LogOut size={20} /></span>
            <span className={`truncate text-left transition-all duration-200 ${sidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'opacity-100 flex-1'}`}>Log out</span>
          </button>
        </div>

      </aside>

      {/* Main */}
      <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-3 sm:px-8 lg:px-12 pt-3 pb-8 bg-white">
        <header className="hidden lg:flex items-center justify-between gap-4 py-4 mb-6 border-b border-black/10 print:hidden">
          <h1 className="text-lg font-black text-[#000000] tracking-tight">{BRAND_EN}</h1>
        </header>
        <div className="lg:hidden h-4" />

        {/* ΓöÇΓöÇ ANALYTICS TAB ΓöÇΓöÇ */}

        {/* ── BUSINESS CONTROL CENTER ── */}
        {/* ── BUSINESS CONTROL CENTER ── */}
        {tab === 'overview' && (() => {
          const latestPOS = searchResults.slice(0, 10)
          return (
          <div className="space-y-6 rounded-[28px] bg-white p-5 sm:p-6 lg:p-7 shadow-sm border border-[#F3F4F6] text-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[#111111]">{l('Analytics Dashboard', 'பகுப்பாய்வு தட்டு')}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => void loadData()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] font-bold text-gray-700 hover:bg-slate-100 hover:text-[#111111] cursor-pointer transition-colors">
                  <RefreshCw size={13} /> {l('Refresh', 'புதுப்பி')}
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-200">
              {[
                { id: 'revenue', label: 'Revenue' },
                { id: 'product', label: 'Product & Category' },
                { id: 'inventory', label: 'Inventory' },
                { id: 'customer', label: 'Customer' },
                { id: 'billing', label: 'Billing' },
              ].map(sub => (
                <button key={sub.id} onClick={() => setAnalyticsTab(sub.id)}
                  className={`px-4 py-2 rounded-xl text-[13px] font-bold whitespace-nowrap transition-colors cursor-pointer ${analyticsTab === sub.id ? 'bg-primary text-primary-100 shadow-sm' : 'bg-slate-50 border border-slate-200 text-gray-700 hover:bg-slate-100 hover:text-[#111111]'}`}>
                  {sub.label}
                </button>
              ))}
            </div>

            {analyticsTab === 'revenue' && (
              <>

            {/* Revenue KPIs - 6 cards in 3 columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: l('Total Revenue', 'மொத்த வருவாய்'),    value: formatCurrency(analytics.totalCompletedRevenue), from: 'from-emerald-50 via-emerald-50/80 to-gray-50', iconBg: 'from-emerald-400 to-gray-500', icon: <RMIcon size={16} /> },
                {
                  label: analytics.isProfitable ? l('Net Profit', 'நிகர லாபம்') : l('Net Loss', 'நிகர நஷ்டம்'),
                  value: formatCurrency(Math.abs(analytics.netProfit)),
                  from: analytics.isProfitable ? 'from-emerald-50 via-gray-50/80 to-green-50' : 'from-rose-50 via-red-50/80 to-orange-50',
                  iconBg: analytics.isProfitable ? 'from-emerald-500 to-gray-600' : 'from-rose-500 to-red-600',
                  icon: analytics.isProfitable ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
                  arrow: analytics.isProfitable ? '↑' : '↓',
                  arrowColor: analytics.isProfitable ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100',
                  valueColor: analytics.isProfitable ? 'text-emerald-700' : 'text-rose-700',
                },
                { label: l('Total Expenses', 'மொத்த செலவு'),    value: formatCurrency(analytics.totalExpenses),         from: 'from-amber-50 via-amber-50/80 to-orange-50', iconBg: 'from-amber-400 to-orange-500', icon: <Receipt size={16} /> },
                { label: l("Today's Sales",  'இன்றைய விற்பனை'),  value: formatCurrency(analytics.todaySales),            from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <TrendingUp size={16} /> },
                { label: l('Offline Revenue', 'ஆஃப்லைன் வருவாய்'), value: formatCurrency(analytics.posRevenue),           from: 'from-orange-50 via-orange-50/80 to-amber-50', iconBg: 'from-orange-400 to-amber-500', icon: <RMIcon size={16} /> },
                { label: l('Online Revenue',  'ஆன்லைன் வருவாய்'),  value: formatCurrency(analytics.onlinePosRevenue),     from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <RMIcon size={16} /> },
                { label: l('Cash Collected', 'பணமாக பெற்றது'), value: formatCurrency(analytics.cashCollected), from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <Banknote size={16} /> },
                { label: l('QR Collected', 'QR மூலம் பெற்றது'), value: formatCurrency(analytics.qrCollected), from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <QrCode size={16} /> },
                { label: l('Card Collected', 'கார்டு மூலம் பெற்றது'), value: formatCurrency(analytics.cardCollected), from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <CreditCard size={16} /> },
                ...(analytics.otherCollected > 0 ? [{ label: l('Other / Online Collected', 'பிற / ஆன்லைன்'), value: formatCurrency(analytics.otherCollected), from: 'from-gray-50 via-gray-50/80 to-gray-50', iconBg: 'from-gray-400 to-gray-500', icon: <RMIcon size={16} /> }] : []),
              ].map((card, i) => (
                <div key={i} className={`bg-gradient-to-br ${card.from} rounded-2xl border border-white/40 p-4 sm:p-5 shadow-sm backdrop-blur-sm flex flex-col justify-between`}>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <p className="text-[11px] uppercase font-black text-[#374151] tracking-wider leading-tight">{card.label}</p>
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center text-white shrink-0 shadow-sm`}>{card.icon}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-[21px] sm:text-[23px] font-black break-words leading-tight ${card.valueColor || 'text-[#111111]'}`}>{card.value}</p>
                    {card.arrow && (
                      <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${card.arrowColor}`}>
                        {card.arrow}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Latest POS Bills */}
            <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-black text-[#111111]">{l('Latest POS Bills', 'POS பில்கள்')}</h3>
                <button onClick={() => setTab('billing')} className="text-[12px] font-bold text-[#10B981] hover:underline">{l('View All →', 'அனைத்தும் →')}</button>
              </div>
              {latestPOS.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-[#F3F4F6]/30">
                  <table className="w-full min-w-[480px] text-[12px]">
                    <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                      <tr>
                        <th className="px-3 py-2.5 font-black text-left">{l('Invoice', 'பில்')}</th>
                        <th className="px-3 py-2.5 font-black text-left">{l('Customer', 'வாடிக்கையாளர்')}</th>
                        <th className="px-3 py-2.5 font-black text-left">{l('Total', 'மொத்தம்')}</th>
                        <th className="px-3 py-2.5 font-black text-left">{l('Date', 'தேதி')}</th>
                        <th className="px-3 py-2.5 font-black text-left">{l('Type', 'வகை')}</th>
                        <th className="px-3 py-2.5 font-black text-left">{l('Status', 'நிலை')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]/20">
                      {latestPOS.map(o => {
                        const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                        const btClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-gray-100 text-gray-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-gray-100 text-gray-700' : 'bg-orange-100 text-orange-700'
                        return (
                          <tr key={o.id} className="hover:bg-[#F9FAFB]/50">
                            <td className="px-3 py-2.5 font-bold text-[#10B981] text-[11px]">{formatInvoiceNo(o.invoice_no)}</td>
                            <td className="px-3 py-2.5 font-semibold text-[#111111] max-w-[100px] truncate">{o.customer_name}</td>
                            <td className="px-3 py-2.5 font-black text-[#111111]">{formatCurrency(getOrderTotal(o))}</td>
                            <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                            <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${btClass}`}>{btLabel}</span></td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[11px] font-black px-2 py-0.5 rounded-lg ${normalizeStatus(o.status) === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {normalizeStatus(o.status)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[13px] text-[#374151] text-center py-4">{l('No bills yet', 'பில்கள் இல்லை')}</p>
              )}
            </div>
            </>
            )}

            {analyticsTab === 'product' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Top Products by Volume</h3>
                  <div className="space-y-3">
                    {analytics.topProducts.slice(0, 10).map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-[#F9FAFB] p-3 rounded-xl">
                        <div>
                          <p className="text-[13px] font-bold text-[#111111]">{p.name}</p>
                          <p className="text-[11px] text-[#374151]">{p.billCount} bills</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-black text-[#111111]">{p.qty}</p>
                          <p className="text-[11px] font-bold text-[#10B981]">{formatCurrency(p.revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Top Categories by Revenue</h3>
                  <div className="space-y-3">
                    {analytics.topCategories.slice(0, 10).map((c, i) => (
                      <div key={i} className="flex justify-between items-center bg-[#F9FAFB] p-3 rounded-xl">
                        <div>
                          <p className="text-[13px] font-bold text-[#111111]">{c.name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-black text-[#111111]">{formatCurrency(c.revenue)}</p>
                          <p className="text-[11px] text-[#374151]">{c.qty} sold</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'inventory' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Low Stock Alerts</h3>
                  <div className="space-y-3">
                    {products.filter(p => p.stock <= (p.lowStockAlert || 5)).slice(0, 10).map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-red-50 border border-red-100 p-3 rounded-xl">
                        <p className="text-[13px] font-bold text-red-900">{p.name}</p>
                        <p className="text-[14px] font-black text-red-700">{p.stock} left</p>
                      </div>
                    ))}
                    {products.filter(p => p.stock <= (p.lowStockAlert || 5)).length === 0 && (
                      <p className="text-[13px] text-[#374151]">No low stock alerts.</p>
                    )}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Total Inventory Value</h3>
                  <div className="bg-[#F9FAFB] p-5 rounded-xl">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-[#374151] mb-1">Selling Value (MRP)</p>
                    <p className="text-[24px] font-black text-[#111111]">
                      {formatCurrency(products.reduce((acc, p) => acc + (p.stock * p.price), 0))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'customer' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Customer Insights</h3>
                  <div className="bg-gray-50 border border-gray-100 p-5 rounded-xl mb-4">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-gray-800 mb-1">Unique Customers</p>
                    <p className="text-[24px] font-black text-gray-900">
                      {new Set(searchResults.filter(o => o.phone).map(o => o.phone)).size}
                    </p>
                  </div>
                  <div className="bg-[#F9FAFB] p-5 rounded-xl">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-[#374151] mb-1">Avg Order Value</p>
                    <p className="text-[24px] font-black text-[#111111]">
                      {formatCurrency(analytics.totalCompletedRevenue / (searchResults.filter(o => isCompletedStatus(o.status)).length || 1))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'billing' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Billing Metrics</h3>
                  <div className="space-y-4">
                    <div className="bg-[#F9FAFB] p-4 rounded-xl flex justify-between items-center">
                      <span className="text-[13px] font-bold text-[#374151]">Total Invoices Generated</span>
                      <span className="text-sm font-black text-[#111111]">{searchResults.length}</span>
                    </div>
                    <div className="bg-[#F9FAFB] p-4 rounded-xl flex justify-between items-center">
                      <span className="text-[13px] font-bold text-[#374151]">Discounts Applied</span>
                      <span className="text-sm font-black text-[#10B981]">
                        {formatCurrency(searchResults.reduce((acc, o) => acc + (toNumber(o.discount_amount, 0)), 0))}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#111111] mb-4">Top Coupons</h3>
                  <div className="space-y-3">
                    {analytics.topCoupons.slice(0, 5).map((c, i) => (
                      <div key={i} className="flex justify-between items-center bg-[#F9FAFB] p-3 rounded-xl">
                        <span className="text-[13px] font-bold text-[#111111]">{c.code}</span>
                        <span className="text-[12px] font-bold text-[#10B981]">{c.usage} uses</span>
                      </div>
                    ))}
                    {analytics.topCoupons.length === 0 && <p className="text-[13px] text-[#374151]">No coupons used yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
          )
        })()}

        {/* ── WHATSAPP CENTER ── */}
        {tab === 'whatsapp' && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-[#111111]">{l('WhatsApp Center', 'வாட்ஸ் அப் மையம்')}</h2>
                {analytics.waPending > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[12px] font-black animate-pulse">
                    {analytics.waPending} {l('pending', 'நிலுவை')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Compact period filter */}
                <div className="flex gap-1">
                  {(['all', 'today', 'week', 'month'] as const).map(preset => (
                    <button key={preset} type="button" onClick={() => applyAnalyticsPreset(preset)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-colors ${analyticsDatePreset === preset ? 'bg-primary text-white' : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]/40'}`}>
                      {preset === 'all' ? l('All','எல்லாம்') : preset === 'today' ? l('Today','இன்று') : preset === 'week' ? l('Week','வாரம்') : l('Month','மாதம்')}
                    </button>
                  ))}
                </div>
                <button onClick={() => void loadData()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#F3F4F6]/40 rounded-lg text-[11px] font-bold text-[#374151] hover:bg-[#F9FAFB]">
                  <RefreshCw size={12} /> {l('Refresh', 'புதுப்பி')}
                </button>
              </div>
            </div>

            {/* Status summary cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: l('Total Requests', 'மொத்த கோரிக்கை'), val: analytics.waRequests,  bg: 'bg-gray-50',   color: 'text-gray-700',   border: 'border-gray-100' },
                { label: l('Pending', 'நிலுவை'),                 val: analytics.waPending,   bg: 'bg-amber-50',  color: 'text-amber-700',  border: 'border-amber-100' },
                { label: l('Contacted', 'தொடர்பு'),               val: analytics.waContacted, bg: 'bg-orange-50', color: 'text-orange-700', border: 'border-orange-100' },
                { label: l('Completed', 'முடிந்தது'),              val: analytics.waCompleted, bg: 'bg-green-50',  color: 'text-green-700',  border: 'border-green-100' },
              ].map(({ label, val, bg, color, border }) => (
                <div key={label} className={`${bg} border ${border} rounded-xl p-3 text-center`}>
                  <p className={`text-[10px] uppercase font-black ${color} tracking-wider mb-1`}>{label}</p>
                  <p className="text-[28px] font-black text-[#111111] leading-none">{val}</p>
                </div>
              ))}
            </div>

            {/* ═══ CUSTOMER REQUEST MANAGEMENT - PRIMARY SECTION ═══ */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <MessageCircle size={17} className="text-gray-600" />
                  <h3 className="text-base font-black text-[#111111]">{l('Customer Requests', 'வாடிக்கையாளர் கோரிக்கைகள்')}</h3>
                  <span className="text-[10px] font-bold text-[#9CA3AF] bg-[#F9FAFB] px-2 py-0.5 rounded-full">{l('RM0 revenue - status updates only', 'RM0 வருவாய் - நிலை மட்டும்')}</span>
                </div>
                <span className="text-[12px] text-[#374151] font-bold">{analytics.onlineRequestOrders.length} {l('requests', 'கோரிக்கைகள்')}</span>
              </div>

              {analytics.onlineRequestOrders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] min-w-[820px]">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <tr className="text-left text-[#374151] font-black text-[10px] uppercase tracking-wider">
                        <th className="px-4 py-3">{l('Customer', 'வாடிக்கையாளர்')}</th>
                        <th className="px-4 py-3">{l('Phone', 'தொலைபேசி')}</th>
                        <th className="px-4 py-3">{l('Address', 'முகவரி')}</th>
                        <th className="px-4 py-3 text-center">{l('Products', 'பொருட்கள்')}</th>
                        <th className="px-4 py-3">{l('Est. Total', 'மதிப்பீடு')}</th>
                        <th className="px-4 py-3">{l('Date & Time', 'தேதி & நேரம்')}</th>
                        <th className="px-4 py-3">{l('Status', 'நிலை')}</th>
                        <th className="px-4 py-3 text-center">{l('Details', 'விவரம்')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {analytics.onlineRequestOrders.map(order => {
                        const its = parseOrderItems(order.items)
                        const isExpanded = waExpandedId === order.id

                        const normalizedItems = its.map(raw => normalizeStructuredOrderItem(raw as Record<string, unknown>))
                        const waMsg = buildProfessionalWhatsAppMessage({
                          customerName: order.customer_name,
                          phone: order.phone,
                          invoiceNumber: formatInvoiceNo(order.invoice_no || order.id),
                          invoiceDate: order.created_at,
                          items: normalizedItems.map(item => ({
                            name: item.name,
                            qty: item.quantity,
                            unit: item.unit,
                            unitType: item.unit_type,
                            rate: item.base_price,
                            lineTotal: item.line_total,
                          })),
                          subtotal: normalizedItems.reduce((sum, item) => sum + item.line_total, 0),
                          total: getOrderTotal(order),
                          paymentMode: formatPaymentLabel(order.payment_mode || order.payment_method, order.split_details) || order.payment_mode || order.payment_method,
                        })

                        return (
                          <React.Fragment key={order.id}>
                            <tr className={`hover:bg-gray-50/40 align-middle ${isExpanded ? 'bg-gray-50/30' : ''}`}>
                              <td className="px-4 py-3 font-bold text-[#111111] whitespace-nowrap">{order.customer_name || '-'}</td>
                              <td className="px-4 py-3 text-[#374151] whitespace-nowrap">{formatPhoneDisplay(order.phone) || '-'}</td>
                              <td className="px-4 py-3 text-[#6B7280] max-w-[140px] truncate" title={order.address || '-'}>{order.address || '-'}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-700 text-[11px] font-black">{its.length}</span>
                              </td>
                              <td className="px-4 py-3 font-black text-[#111111]">{formatCurrency(getOrderTotal(order))}</td>
                              <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-[11px]">
                                <div>{new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                <div className="text-[10px]">{new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={normalizeStatus(order.status)}
                                    onChange={e => void updateOrderStatus(order.id, e.target.value)}
                                    className={`text-[11px] font-black px-2 py-1.5 rounded-lg border cursor-pointer outline-none ${
                                      isCompletedStatus(order.status) ? 'bg-green-100 text-green-700 border-green-200'
                                      : normalizeStatus(order.status) === 'contacted' ? 'bg-orange-100 text-orange-700 border-orange-200'
                                      : 'bg-amber-100 text-amber-700 border-amber-200'
                                    }`}>
                                    <option value="pending">{l('Pending', 'நிலுவை')}</option>
                                    <option value="contacted">{l('Contacted', 'தொடர்பு')}</option>
                                    <option value="completed">{l('Completed', 'முடிந்தது')}</option>
                                  </select>
                                  {role !== 'staff' && (
                                    <button onClick={() => void deleteOrder(order.id, order.invoice_no)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Order">
                                    <Trash2 size={14} />
                                  </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setWaExpandedId(isExpanded ? null : order.id)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${
                                    isExpanded ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}>
                                  {isExpanded ? l('Close', 'மூடு') : l('View', 'பார்')}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="px-4 pb-5 pt-2 bg-gray-50/40">
                                  <div className="space-y-4">
                                    {/* Customer info bar */}
                                    <div className="flex flex-wrap gap-4 text-[12px] bg-white rounded-xl p-3 border border-gray-100">
                                      <div><span className="font-black text-[#374151]">{l('Name', 'பெயர்')}: </span><span className="font-bold text-[#111111]">{order.customer_name || '-'}</span></div>
                                      <div><span className="font-black text-[#374151]">{l('Phone', 'தொலைபேசி')}: </span><span className="font-bold text-[#111111]">{formatPhoneDisplay(order.phone) || '-'}</span></div>
                                      <div className="flex-1"><span className="font-black text-[#374151]">{l('Address', 'முகவரி')}: </span><span className="text-[#111111]">{order.address || '-'}</span></div>
                                      {Boolean(order.remarks) && (
                                        <div className="w-full mt-1 border-t border-gray-50 pt-2"><span className="font-black text-[#374151]">Remarks: </span><span className="font-bold text-[#111111]">{order.remarks}</span></div>
                                      )}
                                      {Boolean(order.reference_number) && (
                                        <div className="w-full mt-1 border-t border-gray-50 pt-2"><span className="font-black text-[#374151]">Ref Number: </span><span className="font-bold text-[#111111]">{order.reference_number}</span></div>
                                      )}
                                    </div>

                                    {/* Items table */}
                                    {its.length > 0 && (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-[12px] min-w-[540px] bg-white rounded-xl overflow-hidden border border-gray-100">
                                          <thead className="bg-[#F9FAFB]">
                                            <tr className="text-left text-[#374151] font-black text-[10px] uppercase tracking-wider">
                                              <th className="px-4 py-2.5">{l('Product', 'பொருள்')}</th>
                                              <th className="px-4 py-2.5">{l('Variant', 'வகைப்படி')}</th>
                                              <th className="px-4 py-2.5">{l('Size / Weight', 'அளவு / எடை')}</th>
                                              <th className="px-4 py-2.5 text-center">{l('Qty', 'அளவு')}</th>
                                              <th className="px-4 py-2.5">{l('Unit Price', 'ஒரு விலை')}</th>
                                              <th className="px-4 py-2.5 text-right">{l('Line Total', 'வரி மொத்தம்')}</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#F3F4F6]/20">
                                            {its.map((raw, idx) => {
                                              const item = raw as Record<string, unknown>
                                              const fullName  = String(item.name || item.product_name || 'Product')
                                              const dashIdx   = fullName.indexOf(' - ')
                                              const prodName  = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName
                                              const variant   = dashIdx > 0 ? fullName.slice(dashIdx + 3) : '-'
                                              const qty       = toNumber(item.quantity ?? item.qty, 0)
                                              const basePrice = toNumber(item.base_price ?? item.basePrice ?? item.price, 0)
                                              const lineTotal = toNumber(item.line_total ?? item.lineTotal, 0)
                                              const unit      = String(item.unit || 'pc')
                                              const unitType  = String(item.unit_type || item.unitType || 'unit')
                                              const sizeLabel = unitType === 'weight'
                                                ? qty >= 1000 ? `${qty / 1000}kg` : `${qty}g`
                                                : unitType === 'volume'
                                                  ? qty >= 1000 ? `${qty / 1000}L` : `${qty}ml`
                                                  : `${qty} ${unit}`
                                              const priceLabel = formatCurrency(basePrice)
                                              return (
                                                <tr key={idx} className="hover:bg-gray-50/20">
                                                  <td className="px-4 py-2.5 font-bold text-[#111111]">{prodName}</td>
                                                  <td className="px-4 py-2.5 text-[#374151]">{variant}</td>
                                                  <td className="px-4 py-2.5 text-[#374151]">{sizeLabel}</td>
                                                  <td className="px-4 py-2.5 text-center font-bold">{qty}</td>
                                                  <td className="px-4 py-2.5 text-[#374151]">{priceLabel}</td>
                                                  <td className="px-4 py-2.5 font-black text-[#111111] text-right">{formatCurrency(lineTotal)}</td>
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                          <tfoot className="bg-[#F9FAFB] border-t border-[#F3F4F6]/30">
                                            <tr>
                                              <td colSpan={5} className="px-4 py-2.5 text-right font-black text-[#374151] text-[11px] uppercase tracking-wider">{l('Grand Total', 'மொத்த தொகை')}</td>
                                              <td className="px-4 py-2.5 text-right font-black text-[18px] text-[#111111]">{formatCurrency(getOrderTotal(order))}</td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    )}

                                    {/* WhatsApp message */}
                                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black text-[#374151] uppercase tracking-wider">{l('WhatsApp Message', 'வாட்ஸ் அப் செய்தி')}</span>
                                        <button
                                          type="button"
                                          onClick={() => void navigator.clipboard.writeText(waMsg)}
                                          className="px-3 py-1 rounded-lg bg-[#25D366] text-white text-[11px] font-black hover:bg-[#1da851] transition-colors">
                                          {l('Copy Message', 'நகல் எடு')}
                                        </button>
                                      </div>
                                      <pre className="text-[12px] text-[#111111] bg-[#F9FAFB] rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed select-all">{waMsg}</pre>
                                    </div>
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
              ) : (
                <div className="px-5 py-12 text-center">
                  <MessageCircle size={40} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-[14px] font-bold text-[#374151]">{l('No WhatsApp requests in selected period', 'தேர்ந்த காலத்தில் WA கோரிக்கை இல்லை')}</p>
                </div>
              )}
            </div>

            {/* ——— ANALYTICS - secondary, compact, bottom ——— */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Top Requested Products */}
              <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-4 shadow-sm">
                <h3 className="text-[13px] font-black text-[#111111] mb-3">{l('Top Requested Products', 'அதிக தேவை')}</h3>
                {analytics.topWAProducts.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.topWAProducts.slice(0, 6).map((item, i) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-700 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-[11px] font-bold text-[#111111] truncate flex-1">{item.name}</span>
                        <span className="text-[11px] font-black text-gray-600 shrink-0">{item.count}x</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#9CA3AF] text-center py-3">{l('No data', 'தரவு இல்லை')}</p>
                )}
              </div>

              {/* Top Requested Categories */}
              <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-4 shadow-sm">
                <h3 className="text-[13px] font-black text-[#111111] mb-3">{l('Top Categories', 'வகைகள்')}</h3>
                {analytics.topWACategories.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.topWACategories.slice(0, 6).map((cat, i) => (
                      <div key={cat.name} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-[11px] font-bold text-[#111111] truncate flex-1">{cat.name}</span>
                        <span className="text-[11px] font-black text-emerald-600 shrink-0">{cat.count}x</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#9CA3AF] text-center py-3">{l('No data', 'தரவு இல்லை')}</p>
                )}
              </div>

              {/* Status Distribution - compact bar */}
              <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-4 shadow-sm">
                <h3 className="text-[13px] font-black text-[#111111] mb-3">{l('Status Distribution', 'நிலை விளக்கம்')}</h3>
                <div className="h-[144px] w-full min-w-0 relative">
                  <ResponsiveContainer width="100%" height={144} minWidth={0} minHeight={0}>
                    <BarChart data={analytics.statusDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                      <XAxis dataKey="name" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
                      <Tooltip formatter={(value) => toNumber(value as number | string, 0)} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={20}>
                        {analytics.statusDistribution.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ——— POS ANALYTICS ——— */}
        {tab === 'pos_analytics' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-[28px] font-black text-[#111111] tracking-tight leading-tight">
                  {gstScope === 'gst' ? 'GST Revenue' : gstScope === 'non_gst' ? 'Non-GST Revenue' : 'Revenue Analytics'}
                </h2>
                <p className="mt-1 text-[14px] font-medium text-[#374151]">
                  {gstScope === 'gst'
                    ? 'GST invoices only — taxable sales dashboard'
                    : gstScope === 'non_gst'
                      ? 'Non-GST bills only — retail sales dashboard'
                      : 'All bills — full store & channel insights'}
                </p>
                <div className="mt-4 inline-flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 max-w-full overflow-x-auto hide-scrollbar" role="tablist" aria-label="Bill type">
                  {([
                    { id: 'all' as const, label: 'All Bills' },
                    { id: 'gst' as const, label: 'GST Invoices' },
                    { id: 'non_gst' as const, label: 'Non-GST Bills' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={gstScope === opt.id}
                      onClick={() => setGstScope(opt.id)}
                      className={`whitespace-nowrap rounded-xl px-4 sm:px-5 py-2 text-[12px] sm:text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                        gstScope === opt.id ? 'bg-primary text-primary-ink shadow-sm' : 'text-[#111111] hover:bg-gray-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Export Actions */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    exportAnalyticsToCSV({
                      data: analytics,
                      activeTab: posAnalyticsTab,
                      datePreset: analyticsDatePreset,
                      dateFrom: analyticsDateFrom,
                      dateTo: analyticsDateTo,
                    })
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#F3F4F6] text-[#111111] font-bold text-xs hover:bg-[#FAFAFA] shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
                  title="Export current analytics view to CSV"
                >
                  <Download size={14} className="text-primary-hover" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  disabled={exportingPdf}
                  onClick={async () => {
                    try {
                      setExportingPdf(true)
                      await exportAnalyticsToPDF({
                        data: analytics,
                        activeTab: posAnalyticsTab,
                        datePreset: analyticsDatePreset,
                        dateFrom: analyticsDateFrom,
                        dateTo: analyticsDateTo,
                      })
                    } catch (err) {
                      console.error('PDF export error:', err)
                    } finally {
                      setExportingPdf(false)
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary border border-primary-soft/60 text-primary-100 font-black text-xs hover:bg-primary-hover shadow-md transition-all cursor-pointer hover:scale-[1.02] disabled:opacity-60"
                  title="Export formatted executive PDF with chart diagrams"
                >
                  {exportingPdf ? (
                    <RefreshCw size={14} className="animate-spin text-primary-hover" />
                  ) : (
                    <FileText size={14} className="text-primary-hover" />
                  )}
                  <span>{exportingPdf ? 'Generating PDF...' : 'Export PDF (Charts)'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-5">
              {/* Sub-tabs */}
              <div className="flex items-end gap-8 overflow-x-auto hide-scrollbar border-b border-gray-200 xl:flex-1" role="tablist" aria-label="Analytics view">
                {([
                  { id: 'revenue' as const,  label: 'Revenue' },
                  { id: 'today' as const,    label: "Today's Sales" },
                  { id: 'products' as const, label: 'Products' },
                  { id: 'coupons' as const,  label: 'Coupons' },
                ]).map(({ id, label }) => {
                  const isActive = posAnalyticsTab === id
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setPosAnalyticsTab(id as PosAnalyticsTab)}
                      className={`-mb-px shrink-0 whitespace-nowrap border-b-[3px] pb-3.5 pt-1 text-[11px] font-black uppercase tracking-wide transition-colors cursor-pointer ${
                        isActive ? 'border-primary text-[#111111]' : 'border-transparent text-[#111111]/80 hover:text-[#111111]'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Period filter (hidden for Today's Sales) */}
              {posAnalyticsTab !== 'today' && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                    <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#111111]">Period:</span>
                    {(['all', 'today', 'week', 'month', 'year'] as const).map(preset => (
                      <button key={preset} type="button" onClick={() => applyAnalyticsPreset(preset)}
                        className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${analyticsDatePreset === preset ? 'bg-primary text-primary-ink' : 'text-[#111111] hover:bg-gray-50'}`}>
                        {preset === 'all' ? 'All Time' : preset === 'today' ? 'Today' : preset === 'week' ? 'This Week' : preset === 'month' ? 'This Month' : 'This Year'}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                    <label className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">From:</span>
                      <input type="date" value={analyticsDateFrom} onChange={e => { setAnalyticsDateFrom(e.target.value); setAnalyticsDatePreset('custom') }} className="bg-transparent text-sm font-black text-[#111111] outline-none" /></label>
                    <label className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">To:</span>
                      <input type="date" value={analyticsDateTo} onChange={e => { setAnalyticsDateTo(e.target.value); setAnalyticsDatePreset('custom') }} className="bg-transparent text-sm font-black text-[#111111] outline-none" /></label>
                  </div>
                </div>
              )}
            </div>

            {/* GST / non-GST summary (All Bills view) */}
            {posAnalyticsTab === 'revenue' && gstScope === 'all' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
                  <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-600 to-[#0B3B2E] p-6 text-white shadow-md">
                    <div className="flex items-start justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/90">{analytics.netEarnings >= 0 ? 'Net Earnings' : 'Net Loss'}</p>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><Wallet size={18} /></span>
                    </div>
                    <p className="mt-6 text-2xl font-black leading-none">{formatCurrency(Math.abs(analytics.netEarnings))}</p>
                    <p className="mt-3 text-[11px] font-black text-white/85">GST + Non-GST − Expenses</p>
                  </div>
                  <div className="rounded-xl border border-primary-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">GST Sales</p>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary"><RMIcon size={18} /></span>
                    </div>
                    <p className="mt-6 text-2xl font-black leading-none text-primary">{formatCurrency(analytics.gstRevenue)}</p>
                    <p className="mt-3 text-[11px] font-semibold text-[#374151]">{analytics.gstBillCount} GST invoice{analytics.gstBillCount === 1 ? '' : 's'}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">Non-GST Sales</p>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><TrendingUp size={18} /></span>
                    </div>
                    <p className="mt-6 text-2xl font-black leading-none text-emerald-600">+ {formatCurrency(analytics.nonGstRevenue)}</p>
                    <p className="mt-3 text-[11px] font-semibold text-[#374151]">{analytics.nonGstBillCount} retail bill{analytics.nonGstBillCount === 1 ? '' : 's'}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">Total Expenses</p>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600"><TrendingDown size={18} /></span>
                    </div>
                    <p className="mt-6 text-2xl font-black leading-none text-[#DC2626]">− {formatCurrency(analytics.totalExpenses)}</p>
                    <button type="button" onClick={() => handleTabClick('expenses')} className="mt-3 text-[11px] font-black text-[#DC2626] underline underline-offset-2 cursor-pointer">
                      Money out — Expense Tracker
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-semibold text-[#4B5563]">
                    <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Calculation Formula</span>
                    <span>GST ({formatCurrency(analytics.gstRevenue)}) + Non-GST ({formatCurrency(analytics.nonGstRevenue)}) − Expenses ({formatCurrency(analytics.totalExpenses)})</span>
                  </div>
                  <p className="whitespace-nowrap text-[14px] font-bold text-[#374151]">
                    = {analytics.netEarnings >= 0 ? 'Net Profit' : 'Net Loss'}:{' '}
                    <span className={`font-mono font-black ${analytics.netEarnings >= 0 ? 'text-emerald-600' : 'text-[#DC2626]'}`}>{formatCurrency(Math.abs(analytics.netEarnings))}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Revenue sub-tab */}
            {posAnalyticsTab === 'revenue' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                  {[
                    {
                      label: 'Total Revenue',
                      helper: 'POS + manual sales combined',
                      value: formatCurrency(analytics.totalCompletedRevenue),
                      icon: <RMIcon size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: analytics.isProfitable ? 'Net Profit' : 'Net Loss',
                      helper: `Revenue (${formatCurrency(analytics.totalCompletedRevenue)}) − Expenses (${formatCurrency(analytics.totalExpenses)})`,
                      value: formatCurrency(Math.abs(analytics.netProfit)),
                      icon: analytics.isProfitable ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
                      color: analytics.isProfitable ? 'text-emerald-600' : 'text-rose-600',
                      bg: analytics.isProfitable ? 'bg-emerald-50' : 'bg-rose-50',
                      valueColor: analytics.isProfitable ? 'text-emerald-600' : 'text-rose-600',
                      arrow: analytics.isProfitable ? '↑' : '↓',
                    },
                    {
                      label: 'Total Expenses',
                      helper: 'Overheads from expense tracker',
                      value: formatCurrency(analytics.totalExpenses),
                      icon: <Receipt size={16} />,
                      color: 'text-amber-500',
                      bg: 'bg-amber-50',
                    },
                    {
                      label: 'Completed Bills',
                      helper: 'POS + manual bills',
                      value: String(analytics.completedOrders),
                      icon: <Trophy size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: 'Offline Revenue',
                      helper: 'Walk-in POS sales',
                      value: formatCurrency(analytics.posRevenue),
                      icon: <RMIcon size={16} />,
                      color: 'text-gray-500',
                      bg: 'bg-gray-50',
                    },
                    {
                      label: 'Total Offline Bills',
                      helper: 'Walk-in POS orders',
                      value: String(analytics.offlineOrderCount),
                      icon: <LayoutDashboard size={16} />,
                      color: 'text-red-500',
                      bg: 'bg-red-50',
                    },
                    {
                      label: 'Total Online Bills',
                      helper: 'Live completed online bills',
                      value: String(analytics.onlineBillCount),
                      icon: <Box size={16} />,
                      color: 'text-gray-500',
                      bg: 'bg-gray-50',
                    },
                    {
                      label: 'Total Items Sold',
                      helper: 'From completed bills',
                      value: String(Math.round(analytics.totalProductsSold)),
                      icon: <Box size={16} />,
                      color: 'text-gray-500',
                      bg: 'bg-gray-50',
                    },
                    {
                      label: 'Average Revenue Per Bill',
                      helper: 'Average per bill',
                      value: formatCurrency(analytics.averageRevenuePerBill),
                      icon: <RMIcon size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: 'Cash Collected',
                      helper: 'Cash incl. split payments',
                      value: formatCurrency(analytics.cashCollected),
                      icon: <Banknote size={16} />,
                      color: 'text-primary-hover',
                      bg: 'bg-primary-50',
                    },
                    {
                      label: 'QR Collected',
                      helper: 'QR / UPI incl. split payments',
                      value: formatCurrency(analytics.qrCollected),
                      icon: <QrCode size={16} />,
                      color: 'text-primary-hover',
                      bg: 'bg-primary-50',
                    },
                    {
                      label: 'Card Collected',
                      helper: 'Card incl. split payments',
                      value: formatCurrency(analytics.cardCollected),
                      icon: <CreditCard size={16} />,
                      color: 'text-primary-hover',
                      bg: 'bg-primary-50',
                    },
                    ...(analytics.otherCollected > 0 ? [{
                      label: 'Other / Online Collected',
                      helper: 'Online or unspecified payment mode',
                      value: formatCurrency(analytics.otherCollected),
                      icon: <RMIcon size={16} />,
                      color: 'text-gray-500',
                      bg: 'bg-gray-50',
                    }] : []),
                    {
                      label: 'Top Product',
                      helper: 'Most sold item',
                      value: analytics.bestProduct || 'No sales yet',
                      icon: <Trophy size={16} />,
                      color: 'text-gray-500',
                      bg: 'bg-gray-50',
                    },
                  ].filter(card => !['Net Profit', 'Net Loss', 'Total Expenses'].includes(card.label)).map((card, index) => (
                    <div key={index} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">{card.label}</p>
                          <div className={`w-10 h-10 rounded-full ${card.bg} flex items-center justify-center ${card.color} shrink-0`}>{card.icon}</div>
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <p className={`text-xl font-black leading-tight ${card.valueColor || 'text-[#111111]'}`}>
                            {card.value}
                          </p>
                          {card.arrow && (
                            <span className={`inline-flex items-center text-xs font-black px-1.5 py-0.5 rounded-md ${card.bg} ${card.color}`}>
                              {card.arrow}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[12px] text-[#6B7280] leading-snug" title={card.helper}>{card.helper}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white rounded-card border border-borderLight p-6 shadow-soft">
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <h3 className="text-[16px] font-bold text-[#111111]">Revenue Trend {analytics.chartYear}</h3>
                      <span className="text-[12px] font-bold text-[#111111] bg-red-50 px-2.5 py-1 rounded-md">Avg {formatCurrency(analytics.monthlyRevenue || 0)}/mo</span>
                    </div>
                    <div className="h-[192px] w-full min-w-0 relative">
                      <ResponsiveContainer width="100%" height={192} minWidth={0} minHeight={0}>
                        <BarChart data={analytics.monthlyTrend}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                          <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} angle={-45} textAnchor="end" height={60} />
                          <YAxis hide />
                          <Tooltip cursor={{ fill: '#F9FAFB' }} formatter={(value) => formatCurrency(toNumber(value as number | string, 0))} />
                          <Bar dataKey="revenue" fill="#A1A1AA" radius={[4, 4, 0, 0]} barSize={12} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div className="bg-white rounded-card border border-borderLight p-6 shadow-soft">
                      <h3 className="text-[16px] font-bold text-[#111111] mb-6">Order Source</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-[12px] font-bold mb-2">
                            <span className="text-[#111111] uppercase">Offline</span>
                            <span className="text-[#111111]">{analytics.completedOrders}</span>
                          </div>
                          <div className="w-full bg-[#F3F4F6] rounded-full h-2.5">
                            <div className="bg-primary h-2.5 rounded-full" style={{ width: '100%' }}></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[12px] font-bold mb-2">
                            <span className="text-[#6B7280] uppercase">Online</span>
                            <span className="text-[#111111]">0</span>
                          </div>
                          <div className="w-full bg-[#F3F4F6] rounded-full h-2.5">
                            <div className="bg-[#F3F4F6] h-2.5 rounded-full" style={{ width: '0%' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-card border border-borderLight p-6 shadow-soft">
                      <h3 className="text-[16px] font-bold text-[#111111] mb-4">Top Items by Revenue</h3>
                      <div className="space-y-3">
                        {analytics.topProducts.slice(0, 3).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <span className="font-bold text-[#6B7280] w-4 shrink-0">{i + 1}</span>
                              <span className="font-bold text-[#111111] break-words whitespace-normal leading-snug min-w-0 flex-1">{p.name}</span>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <span className="font-bold text-[#111111]">{formatCurrency(p.revenue)}</span>
                              <span className="text-[#6B7280] text-[11px] w-8 text-right">{Math.round(p.qty)} pcs</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white rounded-card border border-borderLight p-6 shadow-soft">
                    <div className="flex items-center justify-between gap-3 mb-6">
                      <div>
                        <h3 className="text-[16px] font-bold text-[#111111]">Revenue Trend This Week</h3>
                        <p className="mt-1 text-[12px] text-[#6B7280]">Monday to Sunday sales view for the current week.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[#F9FAFB] px-3 py-1 text-[11px] font-bold text-primary-hover">
                          Week {(() => { const now = new Date(); const start = new Date(now.getFullYear(), 0, 1); const diff = Math.floor((now.getTime() - start.getTime()) / 86400000); return Math.ceil((diff + start.getDay() + 1) / 7) })()} of {new Date().getFullYear()}
                        </span>
                        <span className="rounded-full bg-[#F9FAFB] px-3 py-1 text-[11px] font-bold text-primary-hover">
                          Today: {formatCurrency(analytics.todaySales)}
                        </span>
                      </div>
                    </div>
                    <div className="h-[256px] w-full min-w-0 relative">
                      <ResponsiveContainer width="100%" height={256} minWidth={0} minHeight={0}>
                        <BarChart data={analytics.weeklySales}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                          <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                          <YAxis hide />
                          <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            formatter={(value) => formatCurrency(toNumber(value as number | string, 0))}
                            labelFormatter={(_, payload) => {
                              const point = payload?.[0]?.payload as { day?: string; date?: string } | undefined
                              return point ? `${point.day || 'Day'} - ${point.date || ''}` : 'Weekly Revenue'
                            }}
                          />
                          <Bar dataKey="revenue" fill="#111111" radius={[4, 4, 0, 0]} barSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white rounded-card border border-borderLight p-6 shadow-soft">
                    <h3 className="text-[16px] font-bold text-[#111111] mb-4">Top Products This Week</h3>
                    <div className="space-y-3">
                      {analytics.topProducts.slice(0, 5).map((p, i) => (
                        <div key={`${p.name}-${i}`} className="flex items-center justify-between rounded-xl bg-[#F9FAFB] p-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-[#111111]">{p.name}</p>
                            <p className="text-[11px] text-[#6B7280]">{p.billCount} bills</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] font-black text-[#111111]">{Math.round(p.qty)}</p>
                            <p className="text-[11px] font-bold text-[#10B981]">{formatCurrency(p.revenue)}</p>
                          </div>
                        </div>
                      ))}
                      {analytics.topProducts.length === 0 && (
                        <p className="text-[13px] text-[#6B7280]">No completed product sales yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Today's Sales sub-tab */}
            {posAnalyticsTab === 'today' && (
              <div className="space-y-6">
                {/* Key metrics box grid row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "TODAY'S REVENUE", value: formatCurrency(analytics.todaySales), icon: <RMIcon size={20} className="text-emerald-700" />, bg: 'bg-emerald-50', border: 'border-emerald-100' },
                    { label: "COMPLETED ORDERS", value: String(analytics.todayCompletedOrdersCount), icon: <ShoppingCart size={20} className="text-gray-700" />, bg: 'bg-gray-50', border: 'border-gray-100' },
                    { label: "ITEMS SOLD", value: String(Math.round(analytics.todayItemsSold)), icon: <Package size={20} className="text-gray-700" />, bg: 'bg-gray-50', border: 'border-gray-100' },
                    { label: "AVG ORDER VALUE", value: formatCurrency(analytics.todayAvgOrderValue), icon: <Trophy size={20} className="text-amber-700" />, bg: 'bg-amber-50', border: 'border-amber-100' },
                  ].map((card, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-gray-200/80 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">{card.label}</p>
                        <p className="text-xl font-black text-[#111111] leading-tight truncate">{card.value}</p>
                      </div>
                      <div className={`w-11 h-9 rounded-2xl ${card.bg} border ${card.border} flex items-center justify-center shrink-0 shadow-xs`}>
                        {card.icon}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Top products today */}
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#111111] mb-4">Top Products Today</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {analytics.todayTopProducts.map((p, i) => (
                      <div key={i} className="flex items-center justify-between bg-[#F9FAFB] p-3 rounded-xl border border-gray-100">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-bold text-[#111111] truncate">{p.name}</p>
                          <p className="text-[11px] text-[#374151]">{Math.round(p.qty)} sold</p>
                        </div>
                        <p className="text-[13px] font-black text-[#10B981] ml-2">{formatCurrency(p.revenue)}</p>
                      </div>
                    ))}
                    {analytics.todayTopProducts.length === 0 && (
                      <p className="col-span-full text-center text-[13px] text-[#374151] py-6">No products sold yet today.</p>
                    )}
                  </div>
                </div>

                {/* Today's latest bills */}
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#111111]">Today's Bills</h3>
                    <span className="text-[11px] font-bold text-[#10B981]">{analytics.todayCompletedOrdersCount} orders</span>
                  </div>
                  <div className="mb-3">
                    <input
                      type="text"
                      placeholder="Search by invoice number..."
                      value={todayBillsSearch}
                      onChange={e => setTodayBillsSearch(e.target.value)}
                      className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#F3F4F6]/60 rounded-xl text-[13px] font-bold text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:border-primary-soft transition-colors"
                    />
                  </div>
                  {(() => {
                    const filteredBills = analytics.todayBills.filter(b => !todayBillsSearch || b.invoice_no?.toLowerCase().includes(todayBillsSearch.toLowerCase()))
                    return filteredBills.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-[#F3F4F6]/30">
                      <table className="w-full min-w-[480px] text-[12px]">
                        <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                          <tr>
                            <th className="px-3 py-2.5 font-black text-left">Invoice</th>
                            <th className="px-3 py-2.5 font-black text-left">Customer</th>
                            <th className="px-3 py-2.5 font-black text-left">Total</th>
                            <th className="px-3 py-2.5 font-black text-left">Time</th>
                            <th className="px-3 py-2.5 font-black text-left">Type</th>
                            <th className="px-3 py-2.5 font-black text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F3F4F6]/20">
                          {filteredBills.map(o => {
                            const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                            const btClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-gray-100 text-gray-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-gray-100 text-gray-700' : 'bg-orange-100 text-orange-700'
                            return (
                              <tr key={o.id} className="hover:bg-[#F9FAFB]/50">
                                <td className="px-3 py-2.5 font-bold text-[#10B981] text-[11px]">{formatInvoiceNo(o.invoice_no)}</td>
                                <td className="px-3 py-2.5 font-semibold text-[#111111] max-w-[100px] truncate">{o.customer_name}</td>
                                <td className="px-3 py-2.5 font-black text-[#111111]">{formatCurrency(getOrderTotal(o))}</td>
                                <td className="px-3 py-2.5 text-[#374151] whitespace-nowrap">{new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${btClass}`}>{btLabel}</span></td>
                                <td className="px-3 py-2.5">
                                  <button onClick={() => void openOrderInvoice(o, 'view')} className="inline-flex items-center gap-1 rounded-lg border border-[#F3F4F6]/60 px-2 py-1.5 text-[11px] font-black text-[#111111] hover:bg-[#F9FAFB]" title="View Invoice">
                                    <Eye size={13} /> View Invoice
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#374151] text-center py-4">{todayBillsSearch ? 'No bills match your search.' : 'No bills yet today.'}</p>
                  )})()}
                </div>
              </div>
            )}

            {/* Products sub-tab */}
            {posAnalyticsTab === 'products' && (
              <div className="space-y-6">
                {/* Key metrics row: Revenue is 1st KPI card */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  {[
                    { label: 'Total Product Revenue', value: formatCurrency(analytics.totalCompletedRevenue), icon: <RMIcon size={18} />, from: 'from-emerald-500 to-gray-600' },
                    { label: 'Total Products Sold', value: String(Math.round(analytics.totalProductsSold)), icon: <Package size={18} />, from: 'from-gray-500 to-gray-600' },
                    { label: 'Average Product Revenue', value: formatCurrency(analytics.averageProductRevenue), icon: <RMIcon size={18} />, from: 'from-gray-500 to-gray-600' },
                    { label: 'Total Product Profit', value: formatCurrency(analytics.totalProductProfit), icon: <TrendingUp size={18} />, from: analytics.totalProductProfit >= 0 ? 'from-emerald-500 to-gray-600' : 'from-rose-500 to-red-600' },
                    { label: 'Profit Margin', value: `${analytics.overallProfitMargin.toFixed(1)}%`, icon: <Percent size={18} />, from: 'from-gray-500 to-gray-600' },
                    { label: 'Top Product', value: analytics.bestProduct || 'No sales yet', icon: <Trophy size={18} />, from: 'from-amber-500 to-orange-600' },
                  ].map((card, i) => (
                    <div key={i} className={`relative overflow-hidden rounded-2xl p-5 shadow-lg border border-white/20 bg-gradient-to-br ${card.from} flex flex-col justify-between min-h-[120px]`}>
                      <div className="absolute inset-0 bg-gradient-to-tl from-white/30 via-white/10 to-transparent" />
                      <div className="relative z-10 flex flex-col justify-between h-full">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-[10px] uppercase font-black text-white/80 tracking-wider">{card.label}</p>
                          <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-sm shrink-0">{card.icon}</div>
                        </div>
                        <p className="text-[18px] sm:text-[22px] font-extrabold text-white drop-shadow-sm break-words leading-tight">{card.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Full product table with Search by Name, SKU, Category */}
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-[#111111]">All Products Analytics</h3>
                      <p className="text-[12px] text-[#6B7280]">Search by Product Name, SKU, or Category for instant statistics</p>
                    </div>
                    <span className="text-[11px] font-bold text-[#10B981] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 self-start sm:self-auto">{analytics.topProducts.length} products</span>
                  </div>
                  <p className="mb-3 text-[11px] font-semibold text-[#6B7280]">Profit = Revenue − (Cost price × Qty sold), using each product&apos;s current cost price.{analytics.productsWithoutCost > 0 ? ` ${analytics.productsWithoutCost} product${analytics.productsWithoutCost === 1 ? '' : 's'} without a cost price (or manual items) show "—" and are left out of the profit totals.` : ''}</p>
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by Product Name, SKU, or Category..."
                      value={productAnalyticsSearch}
                      onChange={e => setProductAnalyticsSearch(e.target.value)}
                      className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#F3F4F6]/60 rounded-xl text-[13px] font-bold text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:border-primary-soft transition-colors"
                    />
                  </div>
                  {(() => {
                    const filteredProds = analytics.topProducts.filter(p => {
                      if (!productAnalyticsSearch.trim()) return true
                      const q = productAnalyticsSearch.toLowerCase()
                      return p.name.toLowerCase().includes(q) || (p.variant && p.variant.toLowerCase().includes(q))
                    })
                    return filteredProds.length > 0 ? (
                      <>
                      <div className="overflow-x-auto rounded-xl border border-[#F3F4F6]/30">
                        <table className="w-full min-w-[760px] text-left text-[12px]">
                          <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                            <tr>
                              <th className="px-4 py-2.5 font-black">#</th>
                              <th className="px-4 py-2.5 font-black">Product</th>
                              <th className="px-4 py-2.5 font-black">Variant / SKU</th>
                              <th className="px-4 py-2.5 font-black">Qty Sold</th>
                              <th className="px-4 py-2.5 font-black">Revenue</th>
                              <th className="px-4 py-2.5 font-black">Cost</th>
                              <th className="px-4 py-2.5 font-black">Profit</th>
                              <th className="px-4 py-2.5 font-black">Margin</th>
                              <th className="px-4 py-2.5 font-black">Bills</th>
                              <th className="px-4 py-2.5 font-black">Avg Revenue/Bill</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F3F4F6]/20">
                            {filteredProds.slice(0, 50).map((p, i) => (
                              <tr key={`${p.name}-${p.variant || i}`} className="hover:bg-[#F9FAFB]/50">
                                <td className="px-4 py-2 text-[11px] text-[#9CA3AF] font-bold">{i + 1}</td>
                                <td className="px-4 py-2 font-bold text-[#111111]">{p.name}</td>
                                <td className="px-4 py-2 text-[#374151]">{p.variant || '-'}</td>
                                <td className="px-4 py-2 font-bold">{Math.round(p.qty)}</td>
                                <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(p.revenue)}</td>
                                <td className="px-4 py-2 text-[#374151]">{p.hasCost ? formatCurrency(p.cost) : '—'}</td>
                                <td className={`px-4 py-2 font-bold ${p.hasCost ? (p.profit >= 0 ? 'text-emerald-700' : 'text-rose-600') : 'text-[#9CA3AF]'}`}>{p.hasCost ? formatCurrency(p.profit) : '—'}</td>
                                <td className="px-4 py-2 text-[#374151]">{p.hasCost ? `${p.margin.toFixed(1)}%` : '—'}</td>
                                <td className="px-4 py-2 text-[#374151]">{p.billCount}</td>
                                <td className="px-4 py-2 font-bold text-[#111111]">{formatCurrency(p.billCount > 0 ? p.revenue / p.billCount : 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      </>
                    ) : (
                      <p className="text-center text-[13px] text-[#374151] py-6">{productAnalyticsSearch ? 'No products match your search query.' : 'No product sales in selected period'}</p>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* Categories sub-tab */}
            {posAnalyticsTab === 'categories' && (
              <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                <h3 className="text-base font-black text-[#111111] mb-4">{l('Category Analytics', 'வகை பகுப்பாய்வு')}</h3>
                {analytics.topCategories.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-[#F3F4F6]/30">
                    <table className="w-full min-w-[420px] text-left text-[13px]">
                      <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                        <tr>
                          <th className="px-4 py-2.5 font-black">#</th>
                          <th className="px-4 py-2.5 font-black">{l('Category', 'வகை')}</th>
                          <th className="px-4 py-2.5 font-black">{l('Revenue', 'வருவாய்')}</th>
                          <th className="px-4 py-2.5 font-black">{l('Qty Sold', 'விற்ற அளவு')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]/20">
                        {analytics.topCategories.map((c, i) => (
                          <tr key={c.name} className="hover:bg-[#F9FAFB]/50">
                            <td className="px-4 py-2 text-[11px] text-[#9CA3AF] font-bold">{i + 1}</td>
                            <td className="px-4 py-2 font-bold text-[#111111]">{c.name}</td>
                            <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(c.revenue)}</td>
                            <td className="px-4 py-2 text-[#374151]">{Math.round(c.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-[13px] text-[#374151] py-6">{l('No data in selected period', 'தேர்ந்த காலத்தில் தரவு இல்லை')}</p>
                )}
              </div>
            )}

            {/* Coupons sub-tab */}
            {posAnalyticsTab === 'coupons' && (
              <div className="space-y-6">
                {/* Key metrics row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Coupons Used', value: String(analytics.totalCouponOrders), icon: <ShoppingCart size={18} />, from: 'from-emerald-500 to-gray-600' },
                    { label: 'Total Discounts Given', value: formatCurrency(analytics.totalCouponDiscounts), icon: <RMIcon size={18} />, from: 'from-gray-500 to-gray-600' },
                    { label: 'Usage Rate', value: `${analytics.couponUsageRate.toFixed(1)}%`, icon: <TrendingUp size={18} />, from: 'from-gray-500 to-gray-600' },
                    { label: 'Unique Coupons', value: String(analytics.topCoupons.length), icon: <Trophy size={18} />, from: 'from-amber-500 to-orange-600' },
                  ].map((card, i) => (
                    <div key={i} className={`relative overflow-hidden rounded-2xl p-5 shadow-lg border border-white/20 bg-gradient-to-br ${card.from} flex flex-col justify-between min-h-[120px]`}>
                      <div className="absolute inset-0 bg-gradient-to-tl from-white/30 via-white/10 to-transparent" />
                      <div className="relative z-10 flex flex-col justify-between h-full">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-[10px] uppercase font-black text-white/80 tracking-wider">{card.label}</p>
                          <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-sm shrink-0">{card.icon}</div>
                        </div>
                        <p className="text-[18px] sm:text-[22px] font-extrabold text-white drop-shadow-sm break-words leading-tight">{card.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Coupon daily trend + Top coupons */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-[#111111] mb-4">Coupon Usage (Last 7 Days)</h3>
                    {analytics.couponDailyTrend.some(d => d.orders > 0) ? (
                      <div className="h-[256px] w-full min-w-0 relative">
                        <ResponsiveContainer width="100%" height={256} minWidth={0} minHeight={0}>
                          <BarChart data={analytics.couponDailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                            <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip cursor={{ fill: '#F9FAFB' }} formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Discounts']} />
                            <Bar dataKey="orders" fill="url(#couponGrad)" radius={[4, 4, 0, 0]} barSize={24} />
                            <defs>
                              <linearGradient id="couponGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10B981" />
                                <stop offset="100%" stopColor="#111111" />
                              </linearGradient>
                            </defs>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-center text-[13px] text-[#374151] py-12">No coupon usage in the last 7 days.</p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-[#111111] mb-4">Top Coupons</h3>
                    <div className="space-y-3">
                      {analytics.topCoupons.slice(0, 8).map((coupon, i) => (
                        <div key={coupon.code} className="flex items-center justify-between gap-2 p-3 bg-[#F9FAFB] rounded-xl">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-[#9CA3AF]">{i + 1}</span>
                              <p className="text-[13px] font-bold text-[#111111] truncate font-mono">{coupon.code}</p>
                              {coupon.percentage ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                  {coupon.percentage}% OFF
                                </span>
                              ) : null}
                              {coupon.is_active === false && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#374151] ml-5">{coupon.usage} order{coupon.usage !== 1 ? 's' : ''}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[13px] font-black text-emerald-700">{formatCurrency(coupon.discounts)}</p>
                            <p className="text-[10px] text-[#374151]">discounted</p>
                          </div>
                        </div>
                      ))}
                      {analytics.topCoupons.length === 0 && (
                        <p className="text-center text-[13px] text-[#374151] py-6">No coupons created or used yet</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Coupon detail table */}
                <div className="bg-white rounded-2xl border border-[#F3F4F6]/30 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-[#111111]">All Coupons Performance</h3>
                    <span className="text-[11px] font-bold text-[#10B981]">{analytics.topCoupons.length} coupons</span>
                  </div>
                  {analytics.topCoupons.length > 0 ? (
                    <>
                      <div className="space-y-3 md:hidden">
                        {analytics.topCoupons.map((coupon, i) => (
                          <div key={coupon.code} className="rounded-2xl border border-[#F3F4F6]/30 bg-[#FAFAFA] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[13px] font-black text-[#9CA3AF]">#{i + 1}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <p className="text-[16px] font-bold text-[#111111] break-words font-mono">{coupon.code}</p>
                                  {coupon.percentage ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                      {coupon.percentage}% OFF
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <p className="text-[14px] font-black text-emerald-700">{formatCurrency(coupon.discounts)}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                              <div>
                                <p className="text-[#9CA3AF] uppercase text-[11px] font-black">Orders</p>
                                <p className="font-bold text-[#111111]">{coupon.usage}</p>
                              </div>
                              <div>
                                <p className="text-[#9CA3AF] uppercase text-[11px] font-black">Avg Discount</p>
                                <p className="font-semibold text-[#374151]">{coupon.usage > 0 ? formatCurrency(coupon.discounts / coupon.usage) : '-'}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-[#F3F4F6]/30">
                        <table className="w-full min-w-[500px] text-left text-[12px]">
                          <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                            <tr>
                              <th className="px-4 py-2.5 font-black">#</th>
                              <th className="px-4 py-2.5 font-black">Code</th>
                              <th className="px-4 py-2.5 font-black">Discount Rate</th>
                              <th className="px-4 py-2.5 font-black">Orders Used</th>
                              <th className="px-4 py-2.5 font-black">Total Discount</th>
                              <th className="px-4 py-2.5 font-black">Avg Discount</th>
                              <th className="px-4 py-2.5 font-black text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F3F4F6]/20">
                            {analytics.topCoupons.map((coupon, i) => (
                              <tr key={coupon.code} className="hover:bg-[#F9FAFB]/50">
                                <td className="px-4 py-2 text-[11px] text-[#9CA3AF] font-bold">{i + 1}</td>
                                <td className="px-4 py-2 font-bold text-[#111111] font-mono">{coupon.code}</td>
                                <td className="px-4 py-2 font-bold text-amber-800">
                                  {coupon.percentage ? `${coupon.percentage}%` : '-'}
                                </td>
                                <td className="px-4 py-2 font-bold">{coupon.usage}</td>
                                <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(coupon.discounts)}</td>
                                <td className="px-4 py-2 text-[#374151]">{coupon.usage > 0 ? formatCurrency(coupon.discounts / coupon.usage) : '-'}</td>
                                <td className="px-4 py-2 text-right">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${
                                    coupon.is_active === false
                                      ? 'bg-gray-100 text-gray-500'
                                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}>
                                    {coupon.is_active === false ? 'Inactive' : 'Active'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-center text-[13px] text-[#374151] py-8">
                      No coupons configured in store yet. Add coupons from the Coupons tab to track performance.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── BILLING PANEL ── */}
        {tab === 'billing' && (
          <div>
            <Pos
              isEmbedded
              externalScannedCode={cartItemToInject}
              onCodeProcessed={() => setCartItemToInject(null)}
            />
          </div>
        )}

        {/* ── INVENTORY & BARCODES TAB ── */}
        {tab === 'inventory' && (
          <InventoryTable />
        )}

        {tab === 'advance_orders' && (
          <AdvanceOrders
            onOrderCompleted={(adv) => {
              if (adv) handleAdvanceOrderCompleted(adv)
              void loadData()
            }}
          />
        )}

        {/* ── ORDER MANAGEMENT ── */}
        {tab === 'history' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-5 min-[1750px]:flex-row min-[1750px]:items-center min-[1750px]:justify-between">
              <div className="shrink-0">
                <h2 className="whitespace-nowrap text-[28px] font-black leading-tight tracking-tight text-[#111111]">{l('Order History', 'ஆர்டர் வரலாறு')}</h2>
                <p className="mt-1 text-xs font-semibold text-[#111111]">{l('Manage and track past invoices', 'கடந்த பில்களை நிர்வகிக்கவும்')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#111111]">Period:</span>
                  {([['', 'All Time'], ['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year']] as const).map(([value, text]) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => {
                        if (!value) {
                          setDatePreset('')
                          setSearch(s => ({ ...s, dateFrom: '', dateTo: '' }))
                          void runSearch(undefined, { dateFrom: '', dateTo: '' })
                        } else applyDatePreset(value)
                      }}
                      className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${datePreset === value ? 'bg-primary text-primary-ink' : 'text-[#111111] hover:bg-gray-50'}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <div className="inline-flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <label className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">From:</span>
                    <input type="date" value={search.dateFrom} onChange={e => { const v = e.target.value; setDatePreset('custom'); setSearch(s => ({ ...s, dateFrom: v })); void runSearch(undefined, { dateFrom: v, dateTo: search.dateTo }) }} className="bg-transparent text-sm font-black text-[#111111] outline-none" /></label>
                  <label className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#111111]">To:</span>
                    <input type="date" value={search.dateTo} onChange={e => { const v = e.target.value; setDatePreset('custom'); setSearch(s => ({ ...s, dateTo: v })); void runSearch(undefined, { dateFrom: search.dateFrom, dateTo: v }) }} className="bg-transparent text-sm font-black text-[#111111] outline-none" /></label>
                </div>
                <button
                  type="button"
                  onClick={() => exportCSV(filteredSearchResults)}
                  disabled={filteredSearchResults.length === 0}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border-2 border-primary bg-white px-5 text-[11px] font-black uppercase tracking-wide text-[#111111] hover:bg-primary-50 disabled:opacity-40 cursor-pointer"
                >
                  <Download size={18} strokeWidth={2} /> Export CSV
                </button>
              </div>
            </div>

            <form onSubmit={runSearch} className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
              <div className="mb-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 hide-scrollbar" role="tablist" aria-label="Bill type">
                {([['all', 'All Bills'], ['gst', 'GST Invoices'], ['non_gst', 'Non-GST Bills']] as const).map(([id, text]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={historyGstScope === id}
                    onClick={() => setHistoryGstScope(id)}
                    className={`whitespace-nowrap rounded-xl px-5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${historyGstScope === id ? 'bg-primary text-primary-ink shadow-sm' : 'text-[#374151] hover:bg-gray-100'}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#111111]">Search Order ID</span>
                  <span className="relative block">
                    <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#111111]" />
                    <input type="text" value={search.invoiceNo} onChange={e => setSearch(s => ({ ...s, invoiceNo: e.target.value }))} placeholder="e.g. INV-..." className="h-9 w-full rounded-xl border border-gray-200 pl-10 pr-3 text-[14px] font-medium text-[#111111] placeholder:text-gray-500 focus:border-primary focus:outline-none" />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#111111]">Customer Name</span>
                  <input type="text" value={search.customerName} onChange={e => setSearch(s => ({ ...s, customerName: e.target.value }))} placeholder="Search name..." className="h-9 w-full rounded-xl border border-gray-200 px-4 text-[14px] font-medium text-[#111111] placeholder:text-gray-500 focus:border-primary focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#111111]">Customer Phone</span>
                  <input type="text" inputMode="tel" value={search.phone} onChange={e => setSearch(s => ({ ...s, phone: e.target.value }))} placeholder="Search phone..." className="h-9 w-full rounded-xl border border-gray-200 px-4 text-[14px] font-medium text-[#111111] placeholder:text-gray-500 focus:border-primary focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#111111]">Order Source</span>
                  <span className="relative block">
                    <select value={billTypeFilter} onChange={e => setBillTypeFilter(e.target.value as typeof billTypeFilter)} className="h-9 w-full appearance-none rounded-xl border border-gray-200 bg-white pl-4 pr-9 text-[14px] font-black text-[#111111] focus:border-primary focus:outline-none cursor-pointer">
                      <option value="all">All Sources</option>
                      <option value="offline">Offline (POS)</option>
                      <option value="online">Online Order</option>
                      <option value="manual">Manual Bill</option>
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#111111]" />
                  </span>
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={searchLoading} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-5 text-[10px] font-bold uppercase tracking-wider text-primary-ink hover:bg-primary-hover disabled:opacity-50 cursor-pointer">
                    {searchLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Search size={15} />}
                    {l('Search', 'தேடு')}
                  </button>
                  {(activeHistoryFiltersCount > 0 || search.invoiceNo || search.customerName || search.phone) && (
                    <button type="button" onClick={handleClearHistoryFilters} className="h-9 rounded-xl border border-gray-200 px-4 text-[10px] font-bold uppercase text-[#111111] hover:bg-gray-50 cursor-pointer">Reset</button>
                  )}
                </div>
              </div>
            </form>

            <p className="px-1 text-[13px] font-bold text-gray-600">{filteredSearchResults.length} {l('bill(s)', 'பில்கள்')}</p>

            <div className="space-y-3">
              <div className="space-y-3 md:hidden">
                {filteredSearchResults.slice(0, 50).map(o => {
                  const billTypeLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                  const billTypeClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-gray-50 text-gray-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-gray-50 text-gray-700' : 'bg-orange-50 text-orange-700'
                  return (
                    <div key={o.id} className="rounded-2xl border border-[#F3F4F6]/60 bg-[#FAFAFA] p-3 sm:p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-[#111111] break-words">{formatInvoiceNo(o.invoice_no)}</p>
                          <p className="text-[13px] text-[#374151]">{new Date(o.created_at).toLocaleDateString('en-IN')}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${billTypeClass}`}>{billTypeLabel}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3 text-[12px] sm:text-[13px]">
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black">Customer</p>
                          <p className="font-bold text-[#111111] truncate">{o.customer_name || '—'}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black">Phone</p>
                          <p className="font-semibold text-[#374151] truncate">{formatPhoneDisplay(o.phone) || '—'}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black">Total</p>
                          <p className="font-black text-[#111111]">{formatCurrency(getOrderTotal(o))}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Coupon</p>
                          <p className="font-semibold text-[#374151] break-words">{o.coupon_code || '—'}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Discount</p>
                          <p className="font-semibold text-emerald-700">{(o.discount_amount + o.manual_discount_amount) > 0 ? `-${formatCurrency(o.discount_amount + o.manual_discount_amount)}` : '—'}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Delivery</p>
                          <p className="font-semibold text-[#111111]">{o.delivery_charge > 0 ? formatCurrency(o.delivery_charge) : '—'}</p>
                        </div>
                        <div className="min-w-0 col-span-2">
                          <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Payment</p>
                          <p className="font-semibold text-[#374151] break-words">{formatPaymentLabel(o.payment_mode || o.payment_method, o.split_details) || '—'}</p>
                        </div>
                        {(Boolean(o.reference_number) || Boolean(o.remarks) || Boolean(o.address)) && (
                          <div className="col-span-2 mt-1 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-[#F3F4F6] pt-3">
                            {Boolean(o.reference_number) && (
                              <div className="min-w-0">
                                <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Ref #</p>
                                <p className="font-semibold text-[#111111] break-words">{o.reference_number}</p>
                              </div>
                            )}
                            {Boolean(o.remarks) && (
                              <div className="min-w-0">
                                <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Remarks</p>
                                <p className="font-semibold text-[#374151] break-words">{o.remarks}</p>
                              </div>
                            )}
                            {Boolean(o.address) && (
                              <div className="col-span-2 min-w-0">
                                <p className="text-[#9CA3AF] uppercase text-[10px] sm:text-[11px] font-black leading-tight">Address</p>
                                <p className="font-semibold text-[#374151] break-words">{o.address}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <div className="flex gap-2 w-full sm:flex-1">
                          <button onClick={() => void openOrderInvoice(o, 'view')} className="inline-flex h-10 sm:min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#F3F4F6]/60 px-2 sm:px-3 text-[12px] font-black text-[#111111] transition-colors hover:bg-white cursor-pointer" title="View Invoice">
                            <Eye size={14} /> View
                          </button>
                          <button onClick={() => window.open(`/invoice/${o.id}`, '_blank')} className="inline-flex h-10 sm:min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 px-2 sm:px-3 text-[12px] font-black text-white transition-colors hover:bg-green-600 cursor-pointer" title="Invoice & Share">
                            <MessageCircle size={14} /> Share
                          </button>
                          <button onClick={() => startEditOrder(o)} className="inline-flex h-10 sm:min-h-[44px] px-3 items-center justify-center gap-1.5 rounded-xl border border-primary-soft/50 bg-primary-soft/10 text-[12px] font-black text-primary transition-colors hover:bg-primary-soft/20 cursor-pointer" title="Edit Order Details">
                            <Edit2 size={13} /> Edit
                          </button>
                        </div>
                        <div className="flex gap-2 w-full sm:flex-1">
                          <select value={normalizeStatus(o.status)} onChange={e => void updateOrderStatus(o.id, e.target.value)}
                            className={`min-h-[44px] flex-1 cursor-pointer rounded-xl border px-3 py-2 text-[12px] font-black outline-none ${normalizeStatus(o.status) === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                            <option value="pending">{l('Pending', 'நிலுவை')}</option>
                            <option value="completed">{l('Completed', 'முடிந்தது')}</option>
                          </select>
                          {role !== 'staff' && (
                            <button onClick={() => void deleteOrder(o.id, o.invoice_no)} className="h-10 w-10 sm:h-9 sm:w-11 shrink-0 rounded-xl border border-[#F3F4F6]/60 text-primary-hover transition-colors hover:bg-primary-soft/5 cursor-pointer" title="Delete Order">
                            <Trash2 size={14} className="mx-auto" />
                          </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {filteredSearchResults.length === 0 && (
                  <div className="rounded-2xl border border-[#F3F4F6]/60 bg-[#FAFAFA] px-4 py-8 text-center text-[#374151]">{l('No matching bills', 'பில்கள் இல்லை')}</div>
                )}
              </div>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full min-w-[1100px] text-left">
                  <thead className="border-b border-gray-200">
                    <tr>
                      {['Order ID', 'Date & Time', 'Customer Name', 'Mobile Number', 'Source', 'Total Due'].map(h => (
                        <th key={h} className="whitespace-nowrap px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-[#111111]">{h}</th>
                      ))}
                      <th className="whitespace-nowrap px-4 py-4 text-right text-[10px] font-bold uppercase tracking-wider text-[#111111]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSearchResults.slice(0, 50).map(o => {
                      const sourceLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'Manual' : normalizeOrderMode(o.order_mode) === 'online' ? 'Online' : 'Offline'
                      const created = new Date(o.created_at)
                      const completedStatus = normalizeStatus(o.status) === 'completed'
                      const actionBtn = 'flex h-9 w-11 shrink-0 items-center justify-center rounded-xl transition-colors cursor-pointer'
                      return (
                        <React.Fragment key={o.id}>
                        <tr className="border-b border-gray-100">
                          <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-[#111111]">{formatInvoiceNo(o.invoice_no)}</td>
                          <td className="whitespace-nowrap px-4 py-4">
                            <p className="text-sm font-black text-[#111111]">{created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                            <p className="text-[12.5px] text-gray-600">{created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                          </td>
                          <td className="max-w-[260px] truncate px-4 py-4 text-sm font-black text-[#111111]">{o.customer_name || 'Walk-in'}</td>
                          <td className="whitespace-nowrap px-4 py-4 font-mono text-[14px] font-bold text-[#111111]">{o.phone ? o.phone.replace(/^91(?=\d{10}$)/, '') : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-4">
                            <div className="flex flex-col items-start gap-1.5">
                              <span className="rounded-md border border-gray-700 px-2.5 py-0.5 text-[10.5px] font-black uppercase tracking-[0.16em] text-gray-700">{sourceLabel}</span>
                              <span className="rounded-md border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[10.5px] font-black uppercase tracking-[0.16em] text-gray-700">{isGstBill(o) ? 'GST' : 'Non-GST'}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-base font-black text-primary">{formatCurrency(getOrderTotal(o))}</td>
                          <td className="whitespace-nowrap px-4 py-4">
                            <div className="flex items-center justify-end gap-2.5">
                              <select
                                value={normalizeStatus(o.status)}
                                aria-label={`Status of ${formatInvoiceNo(o.invoice_no)}`}
                                onChange={e => void updateOrderStatus(o.id, e.target.value)}
                                className={`h-9 cursor-pointer appearance-none rounded-xl px-4 text-center text-[10px] font-bold uppercase tracking-wider outline-none ${completedStatus ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'}`}
                              >
                                <option value="completed">{l('Completed', 'முடிந்தது')}</option>
                                <option value="pending">{l('Pending', 'நிலுவை')}</option>
                              </select>
                              <button type="button" onClick={() => window.open(`/invoice/${o.id}`, '_blank')} className={`${actionBtn} bg-emerald-50 text-emerald-600 hover:bg-emerald-100`} title="Invoice & WhatsApp share" aria-label="Share invoice on WhatsApp">
                                <MessageCircle size={19} strokeWidth={1.75} />
                              </button>
                              <button type="button" onClick={() => void openOrderInvoice(o, 'view')} className={`${actionBtn} bg-gray-100 text-[#111111] hover:bg-gray-200`} title="View invoice" aria-label="View invoice">
                                <FileText size={19} strokeWidth={1.75} />
                              </button>
                              <button type="button" onClick={() => setHistoryExpandedId(historyExpandedId === o.id ? null : o.id)} className={`${actionBtn} ${historyExpandedId === o.id ? 'bg-primary text-primary-ink' : 'bg-gray-100 text-[#111111] hover:bg-gray-200'}`} title="View details" aria-label="View details">
                                <Eye size={19} strokeWidth={1.75} />
                              </button>
                              <button type="button" onClick={() => startEditOrder(o)} className={`${actionBtn} bg-gray-100 text-[#111111] hover:bg-gray-200`} title="Edit order details" aria-label="Edit order">
                                <Edit2 size={17} strokeWidth={1.75} />
                              </button>
                              {role !== 'staff' && (
                                <button type="button" onClick={() => void deleteOrder(o.id, o.invoice_no)} className={`${actionBtn} bg-red-50 text-[#DC2626] hover:bg-red-100`} title="Delete Order" aria-label="Delete order">
                                  <Trash2 size={19} strokeWidth={1.75} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {historyExpandedId === o.id && (
                          <tr className="bg-[#F9FAFB] border-b border-[#F3F4F6]/40">
                            <td colSpan={7} className="px-4 py-3.5">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-[#F3F4F6]/50 mb-3">
                                <p className="text-[11px] font-black uppercase text-[#10B981] tracking-wider">
                                  {l('Order Details & Remarks', 'ஆர்டர் விவரங்கள் மற்றும் குறிப்புகள்')}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => startEditOrder(o)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#F3F4F6] text-xs font-bold text-[#111111] hover:bg-gray-50 shadow-sm transition-all cursor-pointer w-fit"
                                >
                                  <Edit2 size={12} className="text-primary-hover" />
                                  <span>{l('Edit Order Details', 'விவரங்களை திருத்து')}</span>
                                </button>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[12px]">
                                <div>
                                  <p className="text-[10px] font-black uppercase text-[#9CA3AF] tracking-wider mb-1">Reference No</p>
                                  <p className="font-semibold text-[#111111] break-words">{o.reference_number || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase text-[#9CA3AF] tracking-wider mb-1">Remarks</p>
                                  <p className="font-semibold text-[#374151] break-words">{o.remarks || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase text-[#9CA3AF] tracking-wider mb-1">Customer</p>
                                  <p className="font-semibold text-[#111111] break-words">{o.customer_name || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase text-[#9CA3AF] tracking-wider mb-1">Address</p>
                                  <p className="font-semibold text-[#374151] break-words">{o.address || '—'}</p>
                                </div>
                              </div>
                              {(() => {
                                const itemsSubtotal = getOrderWhatsAppPreview(o)?.subtotal ?? 0
                                const rows: Array<[string, string, string?]> = []
                                rows.push(['Subtotal', formatCurrency(itemsSubtotal > 0 ? itemsSubtotal : o.total - o.delivery_charge - o.total_gst + o.discount_amount + o.manual_discount_amount)])
                                if (o.discount_amount > 0) rows.push([o.coupon_code ? `Coupon (${o.coupon_code})` : 'Coupon / Discount', `-${formatCurrency(o.discount_amount)}`, 'text-emerald-700'])
                                if (o.manual_discount_amount > 0) rows.push(['Discount', `-${formatCurrency(o.manual_discount_amount)}`, 'text-emerald-700'])
                                if (o.total_gst > 0) {
                                  const cgst = Math.round((o.total_gst / 2) * 100) / 100
                                  rows.push(['CGST', formatCurrency(cgst)], ['SGST', formatCurrency(Math.round((o.total_gst - cgst) * 100) / 100)])
                                }
                                rows.push(['Delivery Charges', o.delivery_charge > 0 ? formatCurrency(o.delivery_charge) : 'Free (₹0)'])
                                return (
                                  <div className="mt-4 max-w-sm rounded-xl border border-primary-soft/40 bg-white p-3 text-[12px]">
                                    <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-[#9CA3AF]">Price Breakdown</p>
                                    {rows.map(([label, value, color]) => (
                                      <div key={label} className="flex justify-between py-0.5"><span className="text-[#374151]">{label}</span><span className={`font-bold ${color || 'text-[#111111]'}`}>{value}</span></div>
                                    ))}
                                    <div className="mt-1.5 flex justify-between border-t border-[#F3F4F6] pt-1.5 text-[13px]"><span className="font-black text-primary-hover">Total</span><span className="font-black text-[#111111]">{formatCurrency(getOrderTotal(o))}</span></div>
                                  </div>
                                )
                              })()}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      )
                    })}
                    {filteredSearchResults.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-12 text-center text-[14px] text-gray-500">{l('No matching bills', 'பில்கள் இல்லை')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ΓöÇΓöÇ INVENTORY TAB ΓöÇΓöÇ */}
        {tab === 'products' && (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* Product Form */}
            <div className="xl:col-span-2">
              <form onSubmit={handleSaveProd} className="bg-white rounded-2xl border border-borderLight p-6 shadow-sm space-y-5">
                <h3 className="text-base font-black text-[#111111]">{editingProd ? l('Edit Product', 'திருத்து') : l('Add Product', 'சேர்க்கவும்')}</h3>

                {productNotice && (
                  <div className={`p-3 rounded-xl text-[13px] font-bold text-center ${productNotice.includes('!') && !productNotice.toLowerCase().includes('error') && !productNotice.toLowerCase().includes('fail') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {productNotice}
                  </div>
                )}

                {/* Product Type */}
                <div>
                  <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-2">{l('Product Type', 'பொருள் வகை')} *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {UNIT_TYPE_OPTIONS.map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => {
                          const defaults = DEFAULT_OPTIONS_FOR_TYPE[opt.value]
                          const unitLabel = opt.value === 'weight' ? 'g' : opt.value === 'volume' ? 'ml' : opt.value === 'bundle' ? 'bundle' : 'piece'
                          const baseQty = opt.value === 'weight' ? 100 : opt.value === 'volume' ? 250 : 1
                          setProdForm(f => ({ ...f, unitType: opt.value, unitLabel, baseQuantity: baseQty, predefinedOptionsText: defaults, allowDecimalQuantity: opt.value === 'weight' || opt.value === 'volume' }))
                        }}
                        className={`p-3 rounded-xl text-left border-2 transition-colors ${prodForm.unitType === opt.value ? 'border-primary-soft bg-primary/5' : 'border-[#F3F4F6] hover:border-[#E5E7EB]'}`}>
                        <p className={`text-[13px] font-black ${prodForm.unitType === opt.value ? 'text-[#111111]' : 'text-[#111111]'}`}>{opt.label}</p>
                        <p className="text-[11px] text-[#6B7280] leading-tight mt-1">{opt.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Product Name', 'பொருள் பெயர்')} *</label>
                    <input required className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="e.g. Manjal Podi" value={prodForm.name} onChange={e => setProdForm(f => ({...f, name: e.target.value}))} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Tamil Name', 'தமிழ் பெயர்')}</label>
                    <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="எ.கா. மஞ்சள் பொடி" value={prodForm.nameTa} onChange={e => setProdForm(f => ({...f, nameTa: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Price (INR)', 'விலை (INR)')} *</label>
                    <input required type="number" min="0" step="0.01"
                      className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      value={prodForm.price} onChange={e => setProdForm(f => ({...f, price: e.target.value}))} />
                    <p className="text-[11px] text-[#6B7280] mt-1">
                      {prodForm.unitType === 'weight' ? `Per ${prodForm.baseQuantity}g` : prodForm.unitType === 'volume' ? `Per ${prodForm.baseQuantity}ml` : 'Per piece/bundle'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Purchase Price (INR)', 'வாங்கிய விலை')} *</label>
                    <input required type="number" min="0" step="0.01"
                      className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      value={prodForm.purchasePrice} onChange={e => setProdForm(f => ({...f, purchasePrice: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('MRP (INR)', 'MRP (INR)')}</label>
                    <input type="number" min="0" step="0.01"
                      className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="Maximum Retail Price"
                      value={prodForm.mrp} onChange={e => setProdForm(f => ({...f, mrp: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Offer Price (INR)', 'சலுகை விலை')}</label>
                    <input type="number" min="0" step="0.01"
                      className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="Leave blank for no discount"
                      value={prodForm.offerPrice} onChange={e => setProdForm(f => ({...f, offerPrice: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('SKU', 'SKU')}</label>
                    <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="e.g. MP-100G" value={prodForm.sku} onChange={e => setProdForm(f => ({...f, sku: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Barcode', 'பார்கோடு')}</label>
                    <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder="e.g. 8998765432100" value={prodForm.barcode} onChange={e => setProdForm(f => ({...f, barcode: e.target.value}))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Stock', 'இருப்பு')} *</label>
                    <input required type="number" min="0"
                      className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      value={prodForm.stockQuantity} onChange={e => setProdForm(f => ({...f, stockQuantity: e.target.value}))} />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Category', 'வகை')} *</label>
                    <select required className="w-full min-w-0 h-9 px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors touch-manipulation"
                      value={prodForm.category}
                      onChange={e => {
                        const sel = cats.find(c => c.name_en === e.target.value)
                        setProdForm(f => ({ ...f, category: e.target.value, categoryId: sel?.id || null }))
                      }}>
                      <option value="">{l('Select category...', 'வகை தேர்வு செய்யுங்கள்...')}</option>
                      {cats.map(c => <option key={c.id} value={c.name_en}>{c.name_en}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setCategoryManagerOpen(open => !open)}
                      className="mt-2 text-[11px] font-black text-[#111111] hover:underline"
                    >
                      {categoryManagerOpen ? 'Hide categories' : 'Manage categories'}
                    </button>
                    {categoryManagerOpen && (
                      <div className="mt-2 rounded-xl border border-[#F3F4F6]/60 bg-white p-2 space-y-1">
                        {cats.length === 0 ? (
                          <p className="px-2 py-1 text-[11px] text-[#6B7280]">No categories available.</p>
                        ) : activeCategories.map(c => (
                          <div key={c.id} className="relative flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-red-50">
                            <span className="truncate text-[12px] font-bold text-[#111111]">{c.name_en}</span>
                            <button
                              type="button"
                              onClick={() => setOpenCategoryMenuId(id => id === c.id ? null : c.id)}
                              className="shrink-0 rounded-lg p-1.5 text-[#6B7280] hover:bg-white hover:text-[#111111]"
                              aria-label={`Actions for ${c.name_en}`}
                            >
                              <MoreVertical size={14} />
                            </button>
                            {openCategoryMenuId === c.id && (
                              <div className="absolute right-2 top-9 z-20 min-w-28 rounded-xl border border-[#F3F4F6]/60 bg-white p-1 shadow-lg">
                                <button type="button" onClick={() => { setEditingCategoryId(c.id); setNewCat({ name_en: c.name_en, name_ta: c.name_ta || '' }); setOpenCategoryMenuId(null) }} className="block w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-[#111111] hover:bg-[#F9FAFB]">Edit / Rename</button>
                                <button type="button" onClick={() => { setOpenCategoryMenuId(null); void deleteCat(c) }} className="block w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-red-600 hover:bg-red-50">Delete</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Predefined Options (weight/volume only) */}
                {(prodForm.unitType === 'weight' || prodForm.unitType === 'volume') && (
                  <div>
                    <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">
                      {prodForm.unitType === 'weight' ? 'Alpha Size Options (S, M, L...)' : 'Numeric Size Options (28, 30, 32...)'}
                    </label>
                    <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                      placeholder={prodForm.unitType === 'weight' ? 'XS, S, M, L, XL, 2XL' : '28, 30, 32, 34, 36, 38'}
                      value={prodForm.predefinedOptionsText}
                      onChange={e => setProdForm(f => ({...f, predefinedOptionsText: e.target.value}))} />
                    <p className="text-[11px] text-[#6B7280] mt-1">{l('Standard partitioned size options for apparel. Keep letter and numeric sizes separate.', 'நிலையான ஆடை அளவு விருப்பங்கள். எழுத்து மற்றும் எண் அளவுகளை பிரிக்கவும்.')}</p>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Description', 'விளக்கம்')}</label>
                  <textarea rows={2} className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors resize-none"
                    placeholder="Short product description..." value={prodForm.description}
                    onChange={e => setProdForm(f => ({...f, description: e.target.value}))} />
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider mb-1">{l('Benefits / Health Tags', 'நன்மைகள்')}</label>
                  <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                    placeholder="Immunity, Digestion (comma-separated)"
                    value={prodForm.benefits}
                    onChange={e => setProdForm(f => ({...f, benefits: e.target.value}))} />
                </div>

                {/* Image */}
                <div className="space-y-3">
                  <label className="block text-[11px] font-black uppercase text-[#6B7280] tracking-wider">{l('Product Image', 'படம்')}</label>
                  <input className="w-full px-4 py-2.5 bg-[#FAFAFA] border border-[#F3F4F6] focus:border-primary-soft rounded-xl text-[13px] font-bold outline-none transition-colors"
                    placeholder="https://... (image URL)"
                    value={prodForm.image} onChange={e => setProdForm(f => ({...f, image: e.target.value}))} />
                  <input type="file" accept="image/*"
                    className="w-full px-4 py-2 bg-[#FAFAFA] border border-[#F3F4F6] rounded-xl text-[12px] text-[#6B7280]"
                    onChange={e => void handleUploadImage(e.target.files?.[0])} />
                  {imageUploading && <p className="text-[12px] text-[#111111] font-bold">{l('Uploading image...', 'படம் பதிவேற்றுகிறது...')}</p>}
                  {prodForm.image && (
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#FAFAFA] border border-borderLight shadow-sm">
                      <img src={prodForm.image} alt="preview" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input type="checkbox" id="isActive" checked={prodForm.isActive}
                    onChange={e => setProdForm(f => ({...f, isActive: e.target.checked}))}
                    className="w-4 h-4 text-[#111111] rounded focus:ring-maroon-dark accent-maroon-dark"
                  />
                  <label htmlFor="isActive" className="text-[14px] font-bold text-[#111111]">{l('Active (visible in store)', 'கடையில் காட்டு')}</label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="hasVariants"
                    checked={!!prodForm.hasVariants}
                    onChange={e => setProdForm(f => ({...f, hasVariants: e.target.checked} as typeof f))}
                    className="w-4 h-4 text-[#111111] rounded focus:ring-maroon-dark accent-maroon-dark"
                  />
                  <label htmlFor="hasVariants" className="text-[14px] font-bold text-[#111111]">
                    {l('Has Variants (brands/sizes)', 'வகைகள் உள்ளன')}
                  </label>
                </div>

                <div className="flex gap-3 pt-3 border-t border-borderLight">
                  <button type="submit" disabled={loading}
                    className="flex-grow py-3 bg-primary hover:bg-[#374151] text-white font-black rounded-xl disabled:opacity-60 transition-colors shadow-sm text-[13px]">
                    {loading ? l('Saving...','சேமிக்கிறது...') : editingProd ? l('Update Product','புதுப்பி') : l('Add Product','சேர்க்கவும்')}
                  </button>
                  <button type="button" onClick={() => { setEditingProd(null); setProdForm(emptyForm); setProductNotice('') }}
                    className="px-6 py-3 bg-[#F3F4F6] text-[#111111] font-bold rounded-xl hover:bg-[#F3F4F6] transition-colors text-[13px]">
                    Reset
                  </button>
                </div>
              </form>
            </div>

            {/* Product List */}
            <div className="xl:col-span-3">
              <div className="bg-white rounded-2xl border border-borderLight shadow-sm overflow-hidden flex flex-col h-full">
                <div className="px-4 py-3.5 border-b border-borderLight flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
                  <div>
                    <h3 className="text-base font-black text-[#111111]">{l('Products', 'பொருட்கள்')} <span className="text-[#6B7280] font-medium text-[16px]">({products.length})</span></h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                      <input
                        type="text"
                        placeholder={l('Search items...', 'பொருட்களை தேட...')}
                        value={inventorySearch}
                        onChange={e => setInventorySearch(e.target.value)}
                        className="pl-10 pr-4 py-2 rounded-xl border border-[#F3F4F6] text-[13px] bg-[#FAFAFA] focus:bg-white outline-none focus:border-primary-soft w-[180px] lg:w-[240px] transition-colors shadow-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto flex-1 bg-white">
                  <table className="w-full min-w-[640px] text-left border-collapse">
                    <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-[#6B7280] border-b border-borderLight">
                      <tr>
                        <th className="px-6 py-4 font-black">{l('Product Name', 'பொருள்')}</th>
                        <th className="px-4 py-4 font-black">{l('Type', 'வகை')}</th>
                        <th className="px-4 py-4 font-black">{l('Stock', 'இருப்பு')}</th>
                        <th className="px-4 py-4 font-black">{l('Price', 'விலை')}</th>
                        <th className="px-6 py-4 font-black text-right">{l('Actions', 'நடவடிக்கை')}</th>
                      </tr>
                    </thead>
                    <tbody className="text-[14px] divide-y divide-[#F3F4F6] bg-white">
                      {products.filter(p => !inventorySearch || p.name.toLowerCase().includes(inventorySearch.toLowerCase()) || p.tamilName?.toLowerCase().includes(inventorySearch.toLowerCase()) || p.category?.toLowerCase().includes(inventorySearch.toLowerCase())).map(p => (
                        <tr key={p.id} className={`hover:bg-[#FAFAFA] transition-colors cursor-pointer ${!p.isActive ? 'opacity-60' : ''}`}>
                          <td className="px-6 py-4" onClick={() => handleEdit(p)}>
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#FAFAFA] border border-[#F3F4F6] shrink-0 shadow-sm">
                                <img src={p.image || p.imageUrl || ''} alt={p.name}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-[#111111] truncate max-w-[200px]">{p.name}</p>
                                <p className="text-[12px] text-[#6B7280] mt-0.5">{p.category}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                              p.unitType === 'weight' ? 'bg-[#F3F4F6] text-[#6B7280]' :
                              p.unitType === 'volume' ? 'bg-[#F3F4F6] text-[#6B7280]' :
                              p.unitType === 'bundle' ? 'bg-[#FFEDD5] text-[#C2410C]' :
                              'bg-[#F3F4F6] text-[#6B7280]'
                            }`}>{p.unitType}</span>
                          </td>
                          <td className="px-4 py-4 font-bold">
                            <span className={toNumber(p.stockQuantity ?? p.stock, 0) < 10 ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded-md' : 'text-[#111111]'}>
                              {toNumber(p.stockQuantity ?? p.stock, 0)}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-bold text-[#111111]">{formatCurrency(p.price)}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleEdit(p)} title="Edit product" className="p-2 text-[#6B7280] hover:text-[#111111] hover:bg-primary/5 rounded-lg transition-colors shadow-sm bg-white border border-[#F3F4F6]">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => void handleToggleActive(p)} title={p.isActive ? 'Deactivate' : 'Activate'} className={`p-2 rounded-lg transition-colors shadow-sm bg-white border border-[#F3F4F6] ${p.isActive ? 'text-amber-500 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}>
                                <Power size={16} />
                              </button>
                              <button onClick={() => void handleDeleteProd(p.id)} title="Delete product" className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shadow-sm bg-white border border-[#F3F4F6]">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Variant Management Panel - shown when editing a variant product */}
            {editingProd && (
              <div className="xl:col-span-5 bg-white rounded-2xl border border-borderLight p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-base font-black text-[#111111]">
                    {l('Variants', 'வகைகள்')} - <span className="text-[#6B7280]">{editingProd.name}</span>
                    {!editingProd.hasVariants && (
                      <span className="ml-3 text-[12px] font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                        {l('Enable "Has Variants" above to manage variants', '"வகைகள் உள்ளன" இயக்கவும்')}
                      </span>
                    )}
                  </h3>
                  {variantNotice && (
                    <span className={`text-[13px] font-bold px-3 py-1.5 rounded-xl ${variantNotice.toLowerCase().includes('error') || variantNotice.toLowerCase().includes('required') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {variantNotice}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  {/* Add / Edit variant form */}
                  <form onSubmit={handleSaveVariant} className="space-y-4 bg-[#FAFAFA] rounded-2xl p-5 border border-[#F3F4F6]">
                    <h4 className="text-[10px] font-bold uppercase tracking-widerr text-[#111111]">
                      {editingVariantId ? l('Edit Variant', 'வகை திருத்து') : l('Add Variant', 'வகை சேர்')}
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Variant Name *', 'வகை பெயர் *')}</label>
                        <input required
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder={l('e.g. Cycle Brand / 25g', 'e.g. Cycle Brand / 25g')}
                          value={variantForm.name}
                          onChange={e => setVariantForm(f => ({...f, name: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Size Label', 'அளவு பட்டை')}</label>
                        <input
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="25g / 250ml / 1 pack"
                          value={variantForm.sizeLabel}
                          onChange={e => setVariantForm(f => ({...f, sizeLabel: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Purchase Price (INR)', 'வாங்கிய விலை')}</label>
                        <input type="number" min="0" step="0.01"
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="30"
                          value={variantForm.purchasePrice}
                          onChange={e => setVariantForm(f => ({...f, purchasePrice: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('MRP (INR)', 'MRP (INR)')}</label>
                        <input type="number" min="0" step="0.01"
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="50"
                          value={variantForm.mrp}
                          onChange={e => setVariantForm(f => ({...f, mrp: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Selling Price (INR) *', 'விற்பனை விலை *')}</label>
                        <input required type="number" min="0" step="0.01"
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="40"
                          value={variantForm.price}
                          onChange={e => setVariantForm(f => ({...f, price: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('SKU', 'SKU')}</label>
                        <input className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="SKU-123"
                          value={variantForm.sku}
                          onChange={e => setVariantForm(f => ({...f, sku: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Barcode', 'பார்கோடு')}</label>
                        <input className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="890..."
                          value={variantForm.barcode}
                          onChange={e => setVariantForm(f => ({...f, barcode: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Stock *', 'இருப்பு *')}</label>
                        <input required type="number" min="0"
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="50"
                          value={variantForm.stock}
                          onChange={e => setVariantForm(f => ({...f, stock: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Weight/Vol Value', 'எடை மதிப்பு')}</label>
                        <input type="number" min="0" step="0.001"
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm"
                          placeholder="250"
                          value={variantForm.weightValue}
                          onChange={e => setVariantForm(f => ({...f, weightValue: e.target.value}))} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{l('Unit', 'அலகு')}</label>
                        <select
                          className="w-full px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] text-[13px] font-bold outline-none focus:border-primary-soft transition-colors shadow-sm appearance-none"
                          value={variantForm.weightUnit}
                          onChange={e => setVariantForm(f => ({...f, weightUnit: e.target.value}))}>
                          <option value="">-</option>
                          <option value="g">g (grams)</option>
                          <option value="kg">kg</option>
                          <option value="ml">ml</option>
                          <option value="L">L (litres)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <input type="checkbox" id="varIsDefault" checked={variantForm.isDefault}
                        onChange={e => setVariantForm(f => ({...f, isDefault: e.target.checked}))}
                        className="w-4 h-4 text-[#111111] rounded focus:ring-maroon-dark accent-maroon-dark"
                      />
                      <label htmlFor="varIsDefault" className="text-[13px] font-bold text-[#111111]">{l('Default variant (shown first)', 'முதல் வகை (முதலில் காட்டு)')}</label>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button type="submit" disabled={variantLoading}
                        className="flex-grow py-3 bg-primary hover:bg-[#333333] text-white font-black text-[13px] rounded-xl disabled:opacity-60 transition-colors shadow-sm">
                        {variantLoading ? l('Saving...', 'சேமிக்கிறது...') : editingVariantId ? l('Update Variant', 'புதுப்பி') : l('Add Variant', 'சேர்')}
                      </button>
                      {editingVariantId && (
                        <button type="button"
                          onClick={() => { setEditingVariantId(null); setVariantForm({ name: '', sizeLabel: '', price: '', purchasePrice: '', mrp: '', sku: '', barcode: '', stock: '50', weightValue: '', weightUnit: '', isDefault: false }); setVariantNotice('') }}
                          className="px-6 py-3 bg-white border border-[#F3F4F6] text-[#111111] font-bold text-[13px] rounded-xl hover:bg-[#F3F4F6] transition-colors shadow-sm">
                          {l('Cancel', 'ரத்து')}
                        </button>
                      )}
                    </div>
                  </form>

                  {/* Current variants list */}
                  <div className="bg-[#FAFAFA] rounded-2xl p-5 border border-[#F3F4F6]">
                    <h4 className="text-[10px] font-bold uppercase tracking-widerr text-[#111111] mb-4">
                      {l('Current Variants', 'தற்போதைய வகைகள்')} <span className="text-[#6B7280]">({getVariants(String(editingProd.id)).length})</span>
                    </h4>
                    {getVariants(String(editingProd.id)).length === 0 ? (
                      <p className="text-[13px] text-[#6B7280] text-center py-8 bg-white border border-[#F3F4F6] rounded-xl">
                        {l('No variants yet - add one using the form.', 'வகைகள் இல்லை - படிவத்தில் சேர்க்கவும்.')}
                      </p>
                    ) : (
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {getVariants(String(editingProd.id)).map((v: ProductVariant) => (
                          <div key={v.id}
                            className={`flex items-center justify-between gap-3 p-4 rounded-xl border transition-colors bg-white shadow-sm ${editingVariantId === v.id ? 'border-primary-soft ring-1 ring-maroon-dark/20' : 'border-[#F3F4F6] hover:border-[#E5E7EB]'}`}>
                            <div className="flex items-center gap-3 min-w-0">
                              {v.isDefault && (
                                <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-black flex items-center justify-center shrink-0">★</span>
                              )}
                              <div className="min-w-0">
                                <p className="text-[14px] font-bold text-[#111111] truncate">{v.variantName}</p>
                                <p className="text-[12px] text-[#6B7280] mt-0.5">
                                  <span className="font-bold text-[#111111]">{formatCurrency(v.price)}</span>{v.sizeLabel ? ` · ${v.sizeLabel}` : ''} · {l('Stock', 'இருப்பு')}: <span className="font-bold">{v.stock}</span>
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!v.isDefault && (
                                <button onClick={() => void handleSetDefault(v.id)}
                                  className="px-2 py-1.5 text-[#6B7280] hover:text-[#111111] hover:bg-primary/5 rounded-lg text-[10px] font-black uppercase transition-colors">
                                  {l('Set Default', 'முதல்')}
                                </button>
                              )}
                              <button onClick={() => startEditVariant(v)}
                                className="p-2 text-[#6B7280] hover:text-[#111111] hover:bg-[#F3F4F6] rounded-lg transition-colors">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => void handleDeleteVariant(v.id)}
                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CATEGORIES TAB (Unified Taxonomy Manager) ── */}
        {tab === 'categories' && (
          <div className="w-full space-y-6">
            <CategoryManagerView />
          </div>
        )}

        {/* ——— COUPON MANAGEMENT (BLACK & GOLD PREMIUM THEME) ——— */}
        {tab === 'coupons' && (
          <div className="space-y-6">
            {/* Header with Title & Refresh Action */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-[24px] font-black text-[#111111] tracking-tight">{l('Coupon Management', 'கூப்பன் மேலாண்மை')}</h2>
                <p className="text-[13px] text-[#6B7280]">
                  {l('Create and manage discount codes. Applies to product subtotal only.', 'பொருட்களின் subtotal-க்கு மட்டும் கூப்பன் தள்ளுபடி பொருந்தும்.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadCoupons()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#F3F4F6] text-[#111111] font-bold text-xs hover:bg-[#FAFAFA] shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
                title="Refresh coupons list"
              >
                <RefreshCw size={14} className="text-primary-hover" />
                <span>{l('Refresh', 'புதுப்பி')}</span>
              </button>
            </div>

            {/* Stat Cards matching POS Analytics */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Card 1: Total Coupons */}
              <div className="bg-white rounded-card border border-borderLight p-5 shadow-soft flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p className="text-[11px] font-bold text-[#111111] uppercase tracking-wider">Total Coupons</p>
                    <div className="w-8 h-8 rounded-full bg-[#FAFAFA] border border-[#F3F4F6] flex items-center justify-center text-primary-hover shrink-0">
                      <Tag size={15} />
                    </div>
                  </div>
                  <p className="text-[24px] font-black leading-tight text-[#111111] mb-1">
                    {coupons.length}
                  </p>
                </div>
                <p className="text-[12px] text-[#6B7280] leading-snug">Configured promotional codes</p>
              </div>

              {/* Card 2: Active Coupons */}
              <div className="bg-white rounded-card border border-borderLight p-5 shadow-soft flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p className="text-[11px] font-bold text-[#111111] uppercase tracking-wider">Active Coupons</p>
                    <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={15} />
                    </div>
                  </div>
                  <p className="text-[24px] font-black leading-tight text-emerald-600 mb-1">
                    {coupons.filter(c => c.is_active).length}
                  </p>
                </div>
                <p className="text-[12px] text-[#6B7280] leading-snug">Live & ready at POS checkout</p>
              </div>

              {/* Card 3: Total Used */}
              <div className="bg-white rounded-card border border-borderLight p-5 shadow-soft flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p className="text-[11px] font-bold text-[#111111] uppercase tracking-wider">Total Redemptions</p>
                    <div className="w-8 h-8 rounded-full bg-primary text-primary-100 border border-primary-soft/40 flex items-center justify-center shrink-0">
                      <Percent size={15} />
                    </div>
                  </div>
                  <p className="text-[24px] font-black leading-tight text-[#111111] mb-1">
                    {Array.from(couponUsageByCode.values()).reduce((acc, n) => acc + n, 0)}
                  </p>
                </div>
                <p className="text-[12px] text-[#6B7280] leading-snug">Total customer discount usages</p>
              </div>
            </div>

            {/* Subtotal notice banner */}
            <div className="rounded-xl border border-[#F3F4F6]/60 bg-[#FAFAFA] px-4 py-2.5 text-[12px] font-medium text-primary-hover flex items-center gap-2.5 shadow-xs">
              <Info size={16} className="text-primary-hover shrink-0" />
              <span>{l('Coupon discount applies to product subtotal only — delivery charges are excluded.', 'கூப்பன் தள்ளுபடி பொருட்களின் subtotal-க்கு மட்டும் பொருந்தும்.')}</span>
            </div>

            {/* Main Form & Catalog Columns */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
              {/* Form Card */}
              <form onSubmit={saveCoupon} className="bg-white rounded-card border border-borderLight p-6 shadow-soft space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100">
                    <div>
                      <span className="px-2.5 py-0.5 rounded-full bg-primary text-primary-100 border border-primary-soft/30 text-[10px] font-black uppercase tracking-wider">
                        {editingCouponId !== null ? 'EDIT MODE' : 'NEW COUPON'}
                      </span>
                      <h3 className="mt-1.5 text-base font-black text-[#111111]">
                        {editingCouponId !== null ? l('Edit Coupon', 'கூப்பனை திருத்து') : l('Create Coupon', 'புதிய கூப்பன்')}
                      </h3>
                    </div>
                    {editingCouponId !== null && (
                      <button
                        type="button"
                        onClick={cancelEditCoupon}
                        className="px-3 py-1 rounded-full border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {couponSaveError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-[12px] font-bold text-red-700">
                      {couponSaveError}
                    </div>
                  )}
                  {couponSaveSuccess && (
                    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-[12px] font-bold text-emerald-700">
                      {couponSaveSuccess}
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Code */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                        {l('Coupon Code', 'கூப்பன் குறியீடு')} <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          className="flex-1 rounded-xl border border-gray-300 bg-[#FAFAFA] px-3.5 py-2.5 text-[13px] font-mono font-black uppercase tracking-wider text-[#111111] outline-none transition-all focus:border-[#111111] focus:bg-white focus:ring-1 focus:ring-[#111111] disabled:opacity-60"
                          placeholder="WELCOME10"
                          value={couponForm.code}
                          disabled={editingCouponId !== null}
                          onChange={e => { setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() })); setCouponSaveError(''); setCouponSaveSuccess('') }}
                        />
                        {editingCouponId === null && (
                          <button
                            type="button"
                            onClick={generateCouponCode}
                            className="inline-flex items-center gap-1.5 shrink-0 rounded-xl bg-primary border border-primary-soft text-primary-100 px-4 py-2.5 text-xs font-black uppercase tracking-wider hover:bg-primary-hover shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
                          >
                            <Sparkles size={13} className="text-primary-hover" />
                            <span>Generate</span>
                          </button>
                        )}
                      </div>
                      {editingCouponId !== null && (
                        <p className="text-[10px] font-medium text-[#6B7280]">{l('Code cannot be changed when editing', 'திருத்தும்போது குறியீட்டை மாற்ற முடியாது')}</p>
                      )}
                    </div>

                    {/* Discount & Min Order */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                          {l('Discount %', 'தள்ளுபடி %')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          className="w-full rounded-xl border border-gray-300 bg-[#FAFAFA] px-3.5 py-2.5 text-[13px] font-bold text-[#111111] outline-none transition-all focus:border-[#111111] focus:bg-white focus:ring-1 focus:ring-[#111111]"
                          placeholder="10"
                          value={couponForm.percentage}
                          onChange={e => setCouponForm(f => ({ ...f, percentage: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                          {l('Min Order (INR)', 'குறைந்த ஆர்டர் (INR)')}
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="w-full rounded-xl border border-gray-300 bg-[#FAFAFA] px-3.5 py-2.5 text-[13px] font-bold text-[#111111] outline-none transition-all focus:border-[#111111] focus:bg-white focus:ring-1 focus:ring-[#111111]"
                          placeholder="0 = no minimum"
                          value={couponForm.min_order_value}
                          onChange={e => setCouponForm(f => ({ ...f, min_order_value: e.target.value }))}
                        />
                      </div>
                    </div>

                    {/* Expiry & Usage Limit */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                          {l('Expiry Date', 'காலாவதி தேதி')}
                        </label>
                        <input
                          type="date"
                          className="w-full rounded-xl border border-gray-300 bg-[#FAFAFA] px-3.5 py-2.5 text-[13px] font-bold text-[#111111] outline-none transition-all focus:border-[#111111] focus:bg-white focus:ring-1 focus:ring-[#111111]"
                          value={couponForm.expiry_date}
                          onChange={e => setCouponForm(f => ({ ...f, expiry_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
                          {l('Usage Limit', 'பயன்பாட்டு வரம்பு')}
                        </label>
                        <input
                          type="number"
                          min="1"
                          className="w-full rounded-xl border border-gray-300 bg-[#FAFAFA] px-3.5 py-2.5 text-[13px] font-bold text-[#111111] outline-none transition-all focus:border-[#111111] focus:bg-white focus:ring-1 focus:ring-[#111111]"
                          placeholder="Unlimited"
                          value={couponForm.usage_limit}
                          onChange={e => setCouponForm(f => ({ ...f, usage_limit: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-primary border border-primary-soft text-primary-100 py-3 text-[10px] font-bold uppercase tracking-widerr shadow-md hover:bg-primary-hover hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Ticket size={15} className="text-primary-hover" />
                    <span>{editingCouponId !== null ? l('Update Coupon', 'கூப்பனை புதுப்பி') : l('Create Coupon', 'கூப்பனை உருவாக்கு')}</span>
                  </button>
                </div>
              </form>

              {/* Coupons List Card */}
              <div className="bg-white rounded-card border border-borderLight p-6 shadow-soft flex flex-col">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-black text-[#111111]">
                      {l('All Coupons', 'அனைத்து கூப்பன்கள்')}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary text-white text-[11px] font-black">
                      {coupons.length}
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#FAFAFA] border border-[#F3F4F6] text-primary-hover text-[10px] font-black uppercase tracking-wider">
                    {l('Admin Only', 'அட்மின் மட்டும்')}
                  </span>
                </div>

                <div className="space-y-3 max-h-[34rem] overflow-y-auto pr-1">
                  {coupons.map((coupon) => {
                    const isExpired = coupon.expiry_date ? new Date(coupon.expiry_date) < new Date() : false
                    const usedCount = couponUsageByCode.get(String(coupon.code || '').trim().toUpperCase()) ?? coupon.usage_count
                    const isExhausted = coupon.usage_limit !== null && usedCount >= coupon.usage_limit
                    const isEditing = editingCouponId === coupon.id
                    return (
                      <div
                        key={coupon.id}
                        className={`rounded-xl border p-4 shadow-xs transition-all ${
                          isEditing
                            ? 'border-primary-soft bg-[#FAFAFA] ring-2 ring-primary-soft/30'
                            : 'border-gray-200 bg-white hover:border-primary-soft/60 hover:shadow-md'
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[16px] font-mono font-black uppercase tracking-wider text-[#111111]">{coupon.code}</p>
                              <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider border ${
                                coupon.is_active
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-gray-100 text-gray-600 border-gray-200'
                              }`}>
                                {coupon.is_active ? l('Active', 'செயலில்') : l('Inactive', 'செயலற்ற')}
                              </span>
                              {isExpired && (
                                <span className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                                  Expired
                                </span>
                              )}
                              {!isExpired && isExhausted && (
                                <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                                  Limit reached
                                </span>
                              )}
                            </div>

                            <p className="text-[13px] font-black text-primary-hover">
                              {coupon.percentage}% OFF
                              {coupon.min_order_value > 0 && ` • min order ₹${coupon.min_order_value}`}
                            </p>

                            <p className="text-[11px] font-medium text-[#6B7280]">
                              Used {usedCount}{coupon.usage_limit ? `/${coupon.usage_limit}` : ''} times
                              {coupon.expiry_date ? ` • expires ${new Date(coupon.expiry_date).toLocaleDateString('en-IN')}` : ' • no expiry'}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => void toggleCoupon(coupon)}
                              className={`rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                coupon.is_active
                                  ? 'bg-primary text-primary-100 border border-primary-soft/40 hover:bg-primary-hover'
                                  : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                              }`}
                              title={coupon.is_active ? 'Click to deactivate' : 'Click to activate'}
                            >
                              {coupon.is_active ? l('Active', 'செயலில்') : l('Off', 'ஆஃப்')}
                            </button>
                            <button
                              onClick={() => startEditCoupon(coupon)}
                              className="w-8 h-8 rounded-lg border border-gray-200 bg-white hover:border-primary-soft hover:bg-[#FAFAFA] text-gray-700 hover:text-primary-hover flex items-center justify-center transition-all cursor-pointer shadow-xs"
                              title="Edit coupon"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => void deleteCoupon(coupon)}
                              className="w-8 h-8 rounded-lg border border-gray-200 bg-white hover:border-red-200 hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center transition-all cursor-pointer shadow-xs"
                              title="Delete coupon"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {coupons.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[#F3F4F6] bg-[#FAFAFA] py-12 text-center text-[13px] font-bold text-[#6B7280]">
                      {l('No coupons yet. Create your first coupon!', 'இன்னும் கூப்பன் இல்லை. முதல் கூப்பனை உருவாக்குங்கள்!')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}        {tab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-black text-[#111111]">{l('User Management', 'பயனர் மேலாண்மை')}</h2>
              <button onClick={() => void loadUsers()}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#F3F4F6] rounded-xl text-[13px] font-bold text-[#111111] hover:bg-[#FAFAFA] transition-colors shadow-sm">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]" />
              <input
                className="w-full pl-11 pr-4 py-3 bg-white border border-[#E5E7EB] rounded-xl text-[13px] font-bold text-[#111111] placeholder-[#6B7280] focus:outline-none focus:border-primary-soft transition-colors shadow-sm"
                placeholder={l('Search by name or email...', 'பெயர் அல்லது மின்னஞ்சலால் தேடுக...')}
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>

            {usersError && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700 font-bold shadow-sm">
                <AlertCircle size={15} /> {usersError}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-borderLight shadow-sm overflow-hidden">
              {usersLoading ? (
                <div className="p-10 text-center text-[13px] font-bold text-[#6B7280]">{l('Loading users...', 'பயனர்கள் ஏற்றுகிறது...')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="bg-[#FAFAFA] border-b border-borderLight uppercase tracking-wider text-[11px] text-[#6B7280]">
                        <th className="text-left px-6 py-4 font-black">{l('Name', 'பெயர்')}</th>
                        <th className="text-left px-6 py-4 font-black">{l('Email', 'மின்னஞ்சல்')}</th>
                        <th className="text-left px-6 py-4 font-black">{l('Mobile', 'மொபைல்')}</th>
                        <th className="text-left px-6 py-4 font-black">{l('Joined', 'சேர்ந்த தேதி')}</th>
                        <th className="text-center px-6 py-4 font-black">{l('Role', 'பங்கு')}</th>
                        <th className="text-center px-6 py-4 font-black">{l('Action', 'நடவடிக்கை')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {allUsers
                        .filter(u => {
                          if (!userSearch.trim()) return true
                          const q = userSearch.toLowerCase()
                          return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                        })
                        .map(u => (
                          <tr key={u.id} className="hover:bg-[#FAFAFA] transition-colors">
                            <td className="px-6 py-4 font-bold text-[#111111]">{u.name || '-'}</td>
                            <td className="px-6 py-4 text-[#6B7280]">{u.email || '-'}</td>
                            <td className="px-6 py-4 text-[#6B7280]">{u.mobile || '-'}</td>
                            <td className="px-6 py-4 text-[#6B7280] text-[12px]">
                              {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '-'}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                                u.role === 'admin'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-[#F3F4F6] text-[#6B7280]'
                              }`}>
                                {u.role === 'admin' ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                                {u.role === 'admin' ? l('Admin', 'நிர்வாகி') : l('Customer', 'வாடிக்கையாளர்')}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {u.id === user?.id ? (
                                <span className="text-[12px] text-[#6B7280] font-bold uppercase tracking-wider">{l('You', 'நீங்கள்')}</span>
                              ) : (
                                <button
                                  onClick={() => void toggleUserRole(u)}
                                  disabled={roleUpdating === u.id}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 ${
                                    u.role === 'admin'
                                      ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                                      : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                                  }`}
                                >
                                  {u.role === 'admin' ? <><ShieldOff size={12} /> Remove Admin</> : <><ShieldCheck size={12} /> {l('Make Admin', 'நிர்வாகி ஆக்கு')}</>}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {allUsers.length === 0 && !usersLoading && (
                    <p className="p-10 text-center text-[14px] font-bold text-[#6B7280] bg-[#FAFAFA]">{l('No users found.', 'பயனர் இல்லை.')}</p>
                  )}
                </div>
              )}
            </div>

            <p className="text-[12px] text-[#6B7280] font-bold">
              - {l('Role changes take effect upon next login.', 'பங்கு மாற்றம் அடுத்த முறை உள்நுழைந்தால் நடைமுறைக்கு வரும்.')}
            </p>
          </div>
        )}

        {/* ── EXPENSES TAB ── */}
        {tab === 'expenses' && (
          <ExpensesView />
        )}

        {/* ── BIRTHDAYS TAB ── */}
        {tab === 'birthdays' && (
          <BirthdaysView />
        )}

        {/* ── ATTENDANCE TAB ── */}
        {tab === 'attendance' && role === 'admin' && (
          <AttendanceView />
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && role === 'admin' && (
          <ShopSettingsView onOpenInventory={() => handleTabClick('inventory')} />
        )}
        {/* Footer: sits at the end of the scrolling content, visible only when scrolled to the bottom */}
        <footer className="mt-10 border-t border-black/10 pt-10 pb-2 flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-wider text-[#000000] text-center print:hidden">
          <span>© 2026 All rights reserved. {BRAND_EN}.</span>
          <span>Powered by <span className="font-black text-primary">Cenexa Systems</span> @2026</span>
          {BRAND_TAGLINE
            ? <span className="flex items-center gap-2 italic font-black tracking-[0.12em] text-[#9CA3AF]"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{BRAND_TAGLINE}</span>
            : <span className="hidden lg:block w-24" />}
        </footer>
        </div>
      </main>


      {invoicePreviewOrder && (() => {
        const preview = getOrderWhatsAppPreview(invoicePreviewOrder)
        if (!preview) return null

        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice ${invoicePreviewOrder.invoice_no || invoicePreviewOrder.id}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setInvoicePreviewOrder(null)
            }}
          >
            <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[#F9FAFB] shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-[#F3F4F6]/60 bg-white px-4 py-3 sm:px-6">
                <div>
                  <h2 className="text-base font-black text-[#111111]">Invoice Preview</h2>
                  <p className="text-xs font-semibold text-[#6B7280]">{formatInvoiceNo(invoicePreviewOrder.invoice_no || invoicePreviewOrder.id)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintReceipt(invoicePreviewOrder)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#F3F4F6]/70 px-3 text-xs font-black text-[#111111] hover:bg-[#F9FAFB]"
                  >
                    <Printer size={15} /> Print
                  </button>
                  <button
                    type="button"
                    onClick={() => void openOrderInvoice(invoicePreviewOrder, 'download')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-black text-white hover:bg-primary-soft"
                  >
                    <Download size={15} /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvoicePreviewOrder(null)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111111]"
                    aria-label="Close invoice preview"
                  >
                    <X size={19} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-5">
                <div className="mx-auto max-w-3xl overflow-hidden rounded-xl bg-white shadow-sm">
                  <Invoice
                    invoiceNo={formatInvoiceNo(invoicePreviewOrder.invoice_no || invoicePreviewOrder.id)}
                    date={invoicePreviewOrder.created_at}
                    customerName={invoicePreviewOrder.customer_name}
                    phone={invoicePreviewOrder.phone}
                    address={invoicePreviewOrder.address}
                    items={preview.items as unknown as import('../components/Invoice').InvoiceItem[]}
                    subtotal={preview.subtotal}
                    shipping={invoicePreviewOrder.delivery_charge}
                    deliveryCharge={invoicePreviewOrder.delivery_charge}
                    discountAmount={invoicePreviewOrder.discount_amount}
                    manualDiscountAmount={invoicePreviewOrder.manual_discount_amount}
                    gstAmount={invoicePreviewOrder.total_gst}
                    paymentMode={formatPaymentLabel(invoicePreviewOrder.payment_mode, invoicePreviewOrder.split_details) || invoicePreviewOrder.payment_mode}
                    total={invoicePreviewOrder.total}
                    status={invoicePreviewOrder.status}
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Edit Order Details Modal */}
      {editingOrder && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3 sm:p-6 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit Order ${editingOrder.invoice_no || editingOrder.id}`}
        >
          <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-100">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3.5 bg-[#FAFAFA]">
              <div>
                <h3 className="text-base font-black text-[#111111]">{l('Edit Order Details', 'ஆர்டர் விவரங்களை திருத்து')}</h3>
                <p className="text-xs font-semibold text-gray-500">{formatInvoiceNo(editingOrder.invoice_no || editingOrder.id)}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveOrderEdit} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                    {l('Customer Name', 'வாடிக்கையாளர் பெயர்')}
                  </label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-semibold text-gray-900 focus:outline-none focus:border-primary-soft focus:ring-1 focus:ring-primary-soft"
                    value={editOrderForm.customer_name}
                    onChange={e => setEditOrderForm(f => ({ ...f, customer_name: e.target.value }))}
                    placeholder="e.g. Lalith"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                    {l('Phone Number', 'தொலைபேசி எண்')}
                  </label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-semibold text-gray-900 focus:outline-none focus:border-primary-soft focus:ring-1 focus:ring-primary-soft"
                    value={editOrderForm.phone}
                    onChange={e => setEditOrderForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="e.g. 9876543210"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                    {l('Reference Number', 'குறிப்பு எண்')}
                  </label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-semibold text-gray-900 focus:outline-none focus:border-primary-soft focus:ring-1 focus:ring-primary-soft"
                    value={editOrderForm.reference_number}
                    onChange={e => setEditOrderForm(f => ({ ...f, reference_number: e.target.value }))}
                    placeholder="e.g. REF-1002"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                    {l('Status', 'நிலை')}
                  </label>
                  <select
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-bold text-gray-900 focus:outline-none focus:border-primary-soft bg-white cursor-pointer"
                    value={editOrderForm.status}
                    onChange={e => setEditOrderForm(f => ({ ...f, status: e.target.value }))}
                  >
                    <option value="pending">{l('Pending', 'நிலுவை')}</option>
                    <option value="completed">{l('Completed', 'முடிந்தது')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                  {l('Delivery Address', 'முகவரி')}
                </label>
                <textarea
                  rows={2}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-semibold text-gray-900 focus:outline-none focus:border-primary-soft focus:ring-1 focus:ring-primary-soft"
                  value={editOrderForm.address}
                  onChange={e => setEditOrderForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Delivery address or location..."
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                  {l('Remarks (Internal Notes)', 'குறிப்புகள்')}
                </label>
                <textarea
                  rows={2}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-xs sm:text-[13px] font-semibold text-gray-900 focus:outline-none focus:border-primary-soft focus:ring-1 focus:ring-primary-soft"
                  value={editOrderForm.remarks}
                  onChange={e => setEditOrderForm(f => ({ ...f, remarks: e.target.value }))}
                  placeholder="Optional remarks or customer requests..."
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="h-10 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  {l('Cancel', 'ரத்து')}
                </button>
                <button
                  type="submit"
                  disabled={savingOrderEdit}
                  className="h-10 px-5 rounded-xl bg-primary text-xs font-bold text-white hover:bg-black shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {savingOrderEdit && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  <span>{savingOrderEdit ? l('Saving...', 'சேமிக்கிறது...') : l('Save Changes', 'மாற்றங்களை சேமி')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Barcode Navigation Dialog */}
      <BarcodeRedirectDialog onNavigateToBilling={handleNavigateToBillingFromDialog} />
    </div>
  )
}

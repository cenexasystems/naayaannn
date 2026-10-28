
import { db } from '../lib/db'
export interface InventoryStockItem {
  id: string // compound id: prod-{id} or var-{id}
  product_id: number
  variant_id?: string | null
  entity_type: 'product' | 'variant'
  name: string
  name_ta?: string
  variant_name?: string
  sku?: string
  barcode?: string
  stock: number
  price: number
  purchase_price?: number
  cost_price?: number
  unit?: string
  unit_type?: string
  category?: string
  image_url?: string
  is_active: boolean
  low_stock_threshold?: number
  updated_at?: string
}

export interface InventoryMovement {
  id: number
  product_id: number
  variant_id?: string | null
  barcode_id?: string | null
  barcode?: { barcode_value: string } | null
  /** Barcode looked up from the registry by variant/product when barcode_id is missing */
  resolved_barcode?: string
  movement_type: 'INITIAL_BARCODE_STOCK' | 'RESTOCK' | 'SALE' | 'RETURN' | 'DAMAGE' | 'CORRECTION' | 'VOID'
  quantity_delta: number
  quantity_before: number
  quantity_after: number
  unit_cost?: number | null
  reference_type?: string | null
  reference_id?: string | null
  note?: string
  created_by_name: string
  created_at: string
  product?: {
    id: number
    name: string
    name_ta?: string
    image_url?: string
    barcode?: string | null
  }
  variant?: {
    id: string
    variant_name: string
    sku?: string
    barcode?: string | null
  }
}

export interface StockAdjustmentPayload {
  product_id: number
  variant_id?: string | null
  new_quantity: number
  reason: 'RESTOCK' | 'DAMAGE' | 'CORRECTION' | 'RETURN'
  note?: string
  created_by_name?: string
}

export interface CategoryRecord {
  id: number
  name_en: string
  name_ta?: string
  is_active: boolean
  sort_order: number
  product_count?: number
  created_at?: string
  updated_at?: string
}

export interface InventoryAnalyticsSummary {
  incomingStock: number
  unitsSold: number
  unitsDamaged: number
  unitsReturned: number
  netDelta: number
  totalMovementsCount: number
  movements: InventoryMovement[]
}

export const inventoryService = {
  /**
   * Fetch complete SKU/variant level inventory list.
   */
  async fetchInventoryItems(): Promise<InventoryStockItem[]> {
    // 1. Fetch products
    const { data: products, error: prodErr } = await db
      .from('products')
      .select('id, name, name_ta, price, purchase_price, stock_quantity, low_stock_alert, unit, unit_type, category, category_id, image_url, barcode, sku, is_active, updated_at')
      .order('name', { ascending: true })

    if (prodErr) {
      console.error('[inventoryService.fetchInventoryItems] Products error:', prodErr)
      throw prodErr
    }

    // 2. Fetch variants
    const { data: variants, error: varErr } = await db
      .from('product_variants')
      .select('id, product_id, variant_name, price, purchase_price, stock, barcode, sku, is_active, updated_at')
      .order('sort_order', { ascending: true })

    if (varErr) {
      console.error('[inventoryService.fetchInventoryItems] Variants error:', varErr)
      throw varErr
    }

    // 3. Fetch active categories for taxonomy validation
    const { data: categories } = await db
      .from('categories')
      .select('id, name_en')
      .order('sort_order', { ascending: true })

    const activeCatMap = new Map<number, string>()
    const activeCatNames = new Set<string>()
    let generalCatId: number | null = null

    for (const c of categories || []) {
      activeCatMap.set(c.id, c.name_en)
      activeCatNames.add(c.name_en.trim().toLowerCase())
      if (c.name_en.trim().toLowerCase() === 'general') {
        generalCatId = c.id
      }
    }

    const items: InventoryStockItem[] = []
    const variantsByProduct = new Map<number, typeof variants>()
    const orphanedProdIds: number[] = []

    for (const v of variants || []) {
      const list = variantsByProduct.get(v.product_id) || []
      list.push(v)
      variantsByProduct.set(v.product_id, list)
    }

    for (const p of products || []) {
      // Exclude ad-hoc non-inventory unregistered items
      if (
        (p.category && p.category.trim().toLowerCase() === 'unregistered') ||
        p.category_id === 4
      ) {
        continue
      }

      // Determine valid category (fallback to 'General' if deleted or missing)
      let resolvedCategory = 'General'
      if (p.category_id && activeCatMap.has(p.category_id)) {
        resolvedCategory = activeCatMap.get(p.category_id)!
      } else if (p.category && activeCatNames.has(p.category.trim().toLowerCase())) {
        resolvedCategory = p.category
      } else {
        resolvedCategory = 'General'
        // If product still holds an old deleted category name, mark for database self-healing
        if (p.category && p.category.trim().toLowerCase() !== 'unregistered') {
          orphanedProdIds.push(p.id)
        }
      }

      const threshold = Number(p.low_stock_alert) > 0 ? Number(p.low_stock_alert) : 5
      const prodVariants = variantsByProduct.get(p.id)

      if (prodVariants && prodVariants.length > 0) {
        // Multi-variant product: each variant is a sellable SKU
        for (const v of prodVariants) {
          // Variants removed in the product editor are switched off, not deleted
          if (v.is_active === false) continue
          const variantCost = v.purchase_price != null ? Number(v.purchase_price) : (p.purchase_price != null ? Number(p.purchase_price) : undefined)
          items.push({
            id: `var-${v.id}`,
            product_id: p.id,
            variant_id: v.id,
            entity_type: 'variant',
            name: p.name,
            name_ta: p.name_ta,
            variant_name: v.variant_name,
            sku: v.sku || p.sku,
            barcode: v.barcode,
            stock: Number(v.stock) || 0,
            low_stock_threshold: threshold,
            price: Number(v.price) || Number(p.price) || 0,
            purchase_price: variantCost,
            cost_price: variantCost,
            unit: p.unit,
            unit_type: p.unit_type,
            category: resolvedCategory,
            image_url: p.image_url,
            is_active: v.is_active && p.is_active,
            updated_at: v.updated_at || p.updated_at
          })
        }
      } else {
        // Non-variant product
        items.push({
          id: `prod-${p.id}`,
          product_id: p.id,
          variant_id: null,
          entity_type: 'product',
          name: p.name,
          name_ta: p.name_ta,
          variant_name: undefined,
          sku: p.sku,
          barcode: p.barcode,
          stock: Number(p.stock_quantity) || 0,
          low_stock_threshold: threshold,
          price: Number(p.price) || 0,
          purchase_price: p.purchase_price != null ? Number(p.purchase_price) : undefined,
          cost_price: p.purchase_price != null ? Number(p.purchase_price) : undefined,
          unit: p.unit,
          unit_type: p.unit_type,
          category: resolvedCategory,
          image_url: p.image_url,
          is_active: p.is_active,
          updated_at: p.updated_at
        })
      }
    }

    // Self-heal orphaned products in background so database stays consistent
    if (orphanedProdIds.length > 0) {
      void db
        .from('products')
        .update({
          category: 'General',
          category_id: generalCatId
        })
        .in('id', orphanedProdIds)
    }

    return items.filter((i) => i.is_active !== false)
  },

  /**
   * Deactivate / delete a product or variant from inventory and catalog.
   */
  async deleteInventoryItem(productId: number, variantId?: string | null): Promise<void> {
    if (variantId) {
      const { error: vErr } = await db
        .from('product_variants')
        .update({ is_active: false })
        .eq('id', variantId)
      if (vErr) throw vErr

      await db
        .from('barcode_registry')
        .update({ is_active: false })
        .eq('variant_id', variantId)
    } else {
      const { error: pErr } = await db
        .from('products')
        .update({ is_active: false })
        .eq('id', productId)
      if (pErr) throw pErr

      await db
        .from('product_variants')
        .update({ is_active: false })
        .eq('product_id', productId)

      await db
        .from('barcode_registry')
        .update({ is_active: false })
        .eq('product_id', productId)
    }
  },

  /**
   * Adjust stock for an item with an audit log reason.
   */
  async adjustStock(payload: StockAdjustmentPayload) {
    const { data, error } = await db.rpc('adjust_inventory_stock', {
      p_product_id: payload.product_id,
      p_variant_id: payload.variant_id || null,
      p_new_quantity: payload.new_quantity,
      p_reason: payload.reason,
      p_note: payload.note || '',
      p_created_by_name: payload.created_by_name || 'Admin'
    })

    if (error) {
      console.error('[inventoryService.adjustStock] Error:', error)
      throw error
    }

    return data
  },

  /**
   * Fetch movement audit ledger logs.
   */
  async fetchMovements(params?: {
    product_id?: number
    variant_id?: string | null
    movement_type?: string
    start_date?: string
    end_date?: string
    limit?: number
    offset?: number
  }): Promise<{ movements: InventoryMovement[]; total: number }> {
    let query = db
      .from('inventory_movements')
      .select(`
        id, product_id, variant_id, barcode_id, movement_type, quantity_delta, quantity_before, quantity_after,
        unit_cost, reference_type, reference_id, note, created_by_name, created_at,
        barcode:barcode_registry (barcode_value),
        product:products (id, name, name_ta, image_url, barcode),
        variant:product_variants (id, variant_name, sku, barcode)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (params?.product_id) {
      query = query.eq('product_id', params.product_id)
    }

    if (params?.variant_id) {
      query = query.eq('variant_id', params.variant_id)
    }

    if (params?.movement_type) {
      query = query.eq('movement_type', params.movement_type)
    }

    if (params?.start_date) {
      query = query.gte('created_at', params.start_date)
    }

    if (params?.end_date) {
      query = query.lte('created_at', params.end_date)
    }

    if (params?.limit) {
      const from = params.offset || 0
      const to = from + params.limit - 1
      query = query.range(from, to)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[inventoryService.fetchMovements] Error:', error)
      throw error
    }

    const movements = (data || []).map((m) => ({
      ...m,
      barcode: Array.isArray(m.barcode) ? m.barcode[0] : m.barcode,
      product: Array.isArray(m.product) ? m.product[0] : m.product,
      variant: Array.isArray(m.variant) ? m.variant[0] : m.variant
    })) as InventoryMovement[]

    // Older movements (or ones logged before a barcode existed) have no barcode_id.
    // Resolve them from the registry so the history shows the real barcode, not blanks or ids.
    const productIds = Array.from(new Set(movements.map((m) => m.product_id).filter(Boolean)))
    if (productIds.length > 0) {
      const { data: registry } = await db
        .from('barcode_registry')
        .select('barcode_value, product_id, variant_id')
        .eq('is_active', true)
        .in('product_id', productIds)
      const byVariant = new Map<string, string>()
      const byProduct = new Map<number, string>()
      ;(registry || []).forEach((r) => {
        if (r.variant_id) byVariant.set(String(r.variant_id), String(r.barcode_value))
        else if (r.product_id != null) byProduct.set(Number(r.product_id), String(r.barcode_value))
      })
      movements.forEach((m) => {
        m.resolved_barcode =
          (m.variant_id ? byVariant.get(String(m.variant_id)) : undefined) ?? byProduct.get(m.product_id)
      })
    }

    return { movements, total: count || 0 }
  },

  /**
   * Aggregate stock movements math for Analytics & Reports.
   */
  async fetchInventoryAnalytics(startDate?: string, endDate?: string): Promise<InventoryAnalyticsSummary> {
    const { movements } = await this.fetchMovements({
      start_date: startDate,
      end_date: endDate,
      limit: 1000,
    })

    let incomingStock = 0
    let unitsSold = 0
    let unitsDamaged = 0
    let unitsReturned = 0

    for (const m of movements) {
      const delta = Number(m.quantity_delta) || 0
      if (m.movement_type === 'INITIAL_BARCODE_STOCK') {
        incomingStock += delta
      } else if (m.movement_type === 'RESTOCK') {
        if (delta > 0) {
          incomingStock += delta
        }
      } else if (m.movement_type === 'SALE') {
        unitsSold += Math.abs(delta)
      } else if (m.movement_type === 'DAMAGE') {
        unitsDamaged += Math.abs(delta)
      } else if (m.movement_type === 'RETURN') {
        unitsReturned += Math.abs(delta)
      } else if (m.movement_type === 'CORRECTION') {
        if (delta > 0) {
          incomingStock += delta
        } else if (delta < 0) {
          unitsDamaged += Math.abs(delta)
        }
      } else if (m.movement_type === 'VOID') {
        if (delta > 0) {
          unitsReturned += delta
        }
      }
    }

    const netDelta = incomingStock + unitsReturned - unitsSold - unitsDamaged

    return {
      incomingStock,
      unitsSold,
      unitsDamaged,
      unitsReturned,
      netDelta,
      totalMovementsCount: movements.length,
      movements,
    }
  },

  /**
   * Fetch all categories with product counts.
   */
  async fetchCategories(): Promise<CategoryRecord[]> {
    const { data: categories, error: catErr } = await db
      .from('categories')
      .select('id, name_en, name_ta, is_active, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true })

    if (catErr) {
      console.error('[inventoryService.fetchCategories] Error:', catErr)
      throw catErr
    }

    // Get count of active products per category
    const { data: products, error: prodErr } = await db
      .from('products')
      .select('category_id')
      .neq('is_active', false)

    const countMap: Record<number, number> = {}
    if (!prodErr && products) {
      for (const p of products) {
        if (p.category_id) {
          countMap[p.category_id] = (countMap[p.category_id] || 0) + 1
        }
      }
    }

    return (categories || []).map((c) => ({
      ...c,
      product_count: countMap[c.id] || 0,
    }))
  },

  /**
   * Create category.
   */
  async createCategory(payload: { name_en: string; name_ta?: string; sort_order?: number; is_active?: boolean }): Promise<CategoryRecord> {
    const { data, error } = await db
      .from('categories')
      .insert({
        name_en: payload.name_en.trim(),
        name_ta: payload.name_ta?.trim() || '',
        sort_order: payload.sort_order ?? 0,
        is_active: payload.is_active !== false,
      })
      .select()
      .single()

    if (error) {
      console.error('[inventoryService.createCategory] Error:', error)
      if (error.code === '23505') {
        throw new Error(`A category named "${payload.name_en.trim()}" already exists.`)
      }
      throw error
    }

    return { ...data, product_count: 0 }
  },

  /**
   * Update category.
   */
  async updateCategory(id: number, payload: Partial<{ name_en: string; name_ta?: string; sort_order?: number; is_active?: boolean }>): Promise<CategoryRecord> {
    const updateData: Record<string, unknown> = {}
    if (payload.name_en !== undefined) updateData.name_en = payload.name_en.trim()
    if (payload.name_ta !== undefined) updateData.name_ta = payload.name_ta.trim() || ''
    if (payload.sort_order !== undefined) updateData.sort_order = payload.sort_order
    if (payload.is_active !== undefined) updateData.is_active = payload.is_active

    const { data, error } = await db
      .from('categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[inventoryService.updateCategory] Error:', error)
      if (error.code === '23505') {
        throw new Error(`A category named "${payload.name_en?.trim()}" already exists.`)
      }
      throw error
    }

    return data
  },

  /**
   * Delete category and automatically reassign all associated products to 'General'.
   */
  async deleteCategory(id: number, categoryName?: string): Promise<void> {
    // 1. Resolve category name if not provided
    let catName = categoryName
    if (!catName) {
      const { data } = await db
        .from('categories')
        .select('name_en')
        .eq('id', id)
        .maybeSingle()
      if (data) catName = data.name_en
    }

    // 2. Ensure 'General' category exists in database
    let generalCatId: number | null = null
    const { data: generalCat } = await db
      .from('categories')
      .select('id')
      .ilike('name_en', 'General')
      .maybeSingle()

    if (generalCat) {
      generalCatId = generalCat.id
    } else {
      const { data: newGen } = await db
        .from('categories')
        .insert({ name_en: 'General', is_active: true, sort_order: 0 })
        .select('id')
        .maybeSingle()
      if (newGen) generalCatId = newGen.id
    }

    // 3. Move all products that belonged to this category to 'General'
    if (id) {
      await db
        .from('products')
        .update({
          category: 'General',
          category_id: generalCatId
        })
        .eq('category_id', id)
    }

    if (catName) {
      await db
        .from('products')
        .update({
          category: 'General',
          category_id: generalCatId
        })
        .ilike('category', catName)
    }

    // 4. Delete the category record
    const { error } = await db
      .from('categories')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[inventoryService.deleteCategory] Error:', error)
      throw error
    }
  }
}

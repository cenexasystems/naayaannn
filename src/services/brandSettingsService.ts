import {
  BRAND_EN,
  BRAND_FAVICON,
  BRAND_SETTINGS,
  applyBrandSettings,
  cacheBrandSettings,
  type BrandSettings,
} from '../lib/brand'
import { db, isDatabaseConfigured } from '../lib/db'

type StoreSettingsRow = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const fromRow = (row: StoreSettingsRow): Partial<BrandSettings> => ({
  name: str(row.name),
  nameTa: str(row.name_ta),
  tagline: str(row.tagline),
  ownerName: str(row.owner_name),
  ownerPhone: str(row.owner_phone),
  shopPhone: str(row.phone),
  whatsapp: str(row.whatsapp),
  email: str(row.email),
  address: str(row.address),
  instagram: str(row.instagram),
  logo: str(row.logo_data),
  accentColor: str(row.accent_color),
  city: str(row.city),
  businessHours: str(row.business_hours),
  catalogueHeadline: str(row.catalogue_headline),
  gstin: str(row.gstin),
})

const toRow = (s: BrandSettings) => ({
  id: 1,
  name: s.name,
  name_ta: s.nameTa,
  tagline: s.tagline,
  owner_name: s.ownerName,
  owner_phone: s.ownerPhone,
  phone: s.shopPhone,
  whatsapp: s.whatsapp,
  email: s.email,
  address: s.address,
  instagram: s.instagram,
  logo_data: s.logo,
  accent_color: s.accentColor,
  city: s.city,
  business_hours: s.businessHours,
  catalogue_headline: s.catalogueHeadline,
  gstin: s.gstin,
  updated_at: new Date().toISOString(),
})

const sameSettings = (a: BrandSettings, b: BrandSettings) => JSON.stringify(a) === JSON.stringify(b)

/** Updates the browser tab title and favicon to the current brand. */
export function applyBrandToDocument(): void {
  if (typeof document === 'undefined') return
  document.title = `${BRAND_EN} - POS Billing`
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]').forEach((link) => {
    link.href = BRAND_FAVICON
  })
}

/**
 * Pulls the saved settings from Supabase. If they differ from what this device has cached,
 * the cache is updated and the page reloads once so every screen shows the new details.
 * Rows from before the settings migration (no `instagram` column) are ignored.
 */
export async function syncBrandSettingsFromServer(): Promise<void> {
  if (!isDatabaseConfigured) return
  const { data, error } = await db.from('store_settings').select('*').eq('id', 1).maybeSingle()
  if (error || !data || !('instagram' in data)) return

  const before = BRAND_SETTINGS
  applyBrandSettings(fromRow(data))
  if (sameSettings(before, BRAND_SETTINGS)) return
  cacheBrandSettings(BRAND_SETTINGS)
  window.location.reload()
}

export interface SaveBrandResult {
  savedToServer: boolean
  error?: string
}

/** Saves settings on this device and, when Supabase is set up, for every device. */
export async function saveBrandSettings(settings: BrandSettings): Promise<SaveBrandResult> {
  applyBrandSettings(settings)
  cacheBrandSettings(BRAND_SETTINGS)
  if (!isDatabaseConfigured) return { savedToServer: false }

  const { error } = await db.from('store_settings').upsert(toRow(BRAND_SETTINGS), { onConflict: 'id' })
  if (!error) return { savedToServer: true }

  // Database without the settings migration: save the columns that exist
  const s = BRAND_SETTINGS
  const fallback = await db.from('store_settings').upsert(
    { id: 1, name: s.name, owner_name: s.ownerName, phone: s.shopPhone, email: s.email, address: s.address, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  return {
    savedToServer: false,
    error: fallback.error
      ? fallback.error.message
      : 'Database migration neon/migrations/20261019_0030_shop_settings.sql has not been applied, so some details were saved on this device only.',
  }
}

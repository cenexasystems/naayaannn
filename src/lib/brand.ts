import { LOGO_BASE64 } from './logoBase64'

/**
 * Shop branding & contact details.
 *
 * The values below are the defaults. The admin can change every one of them from
 * Dashboard → Settings; the saved values are kept in Supabase (`store_settings`) and
 * cached in localStorage, then applied here before the app renders. The exports are
 * `let` bindings, so every module that imports them sees the saved values.
 */

export interface BrandSettings {
  name: string
  nameTa: string
  tagline: string
  ownerName: string
  ownerPhone: string // digits, E.164 without "+", e.g. 919876543210
  shopPhone: string
  whatsapp: string
  email: string
  address: string
  instagram: string // handle without "@"
  logo: string // data URL of an uploaded logo, '' = bundled default logo
  accentColor: string // hex, drives the whole app theme
  city: string
  businessHours: string
  catalogueHeadline: string
  gstin: string
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  name: 'NAAYAN',
  nameTa: 'நாயன்',
  tagline: '',
  ownerName: 'Balaji K',
  ownerPhone: '',
  shopPhone: '',
  whatsapp: '',
  email: '',
  address: '14/1 West Car Street, Nehru Maidhanam, Chokkalingapuram, Aruppukottai - 626101',
  instagram: '',
  logo: '',
  accentColor: '#3F3F46',
  city: 'Aruppukottai, Tamil Nadu',
  businessHours: '',
  catalogueHeadline: '',
  gstin: '',
}

const CACHE_KEY = 'naayan_brand_settings_v1'
export const DEFAULT_LOGO = '/naayan-logo.png'

/** Digits only, with the 91 country code added to 10-digit Indian numbers. */
export const toE164 = (input: string): string => {
  const digits = (input || '').replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  return digits
}

/** "919876543210" → "+91 98765 43210". */
export const toPhoneDisplay = (input: string): string => {
  const digits = toE164(input)
  if (!digits) return ''
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return `+${digits}`
}

export let BRAND_SETTINGS: BrandSettings = { ...DEFAULT_BRAND_SETTINGS }

export let BRAND_EN = ''
export let BRAND_TA = ''
export let BRAND_SHORT = ''
export const BRAND_SUBTITLE: string = ''
export let BRAND_TAGLINE = ''
export const BRAND_ESTABLISHED: string = ''
export let BRAND_LOGO = DEFAULT_LOGO
export let BRAND_ICON = DEFAULT_LOGO
export let BRAND_FAVICON = '/naayan-favicon.png'
/** PNG data URI used by the PDF / thermal / print templates. */
export let BRAND_PRINT_LOGO = LOGO_BASE64
export const BRAND_PRODUCTION_DOMAIN: string = 'https://naayan.vercel.app'

export let BRAND_OWNER_NAME = ''
export let BRAND_OWNER_PHONE_DISPLAY = ''
export let BRAND_OWNER_PHONE_E164 = ''

export let BRAND_SHOP_PHONE_DISPLAY = ''
export let BRAND_SHOP_PHONE_E164 = ''

// Primary = shop phone, secondary = owner phone, third = WhatsApp
export let BRAND_PRIMARY_PHONE_DISPLAY = ''
export let BRAND_PRIMARY_PHONE_E164 = ''
export let BRAND_SECONDARY_PHONE_DISPLAY = ''
export let BRAND_SECONDARY_PHONE_E164 = ''
export let BRAND_THIRD_PHONE_DISPLAY = ''
export let BRAND_THIRD_PHONE_E164 = ''

export let BRAND_PHONE_DISPLAY = ''
export let BRAND_PHONE_E164 = ''

export let BRAND_WHATSAPP = ''
export let WHATSAPP_NUM = ''
export let BRAND_WHATSAPP_LINK = ''

export let BRAND_EMAIL = ''
export let BRAND_ADDRESS = ''
export let BRAND_INSTAGRAM = ''
export let BRAND_INSTAGRAM_URL = ''
export let BRAND_LOCATION_LINK = '#'
export let BRAND_CITY = ''
export let BRAND_HOURS = ''
export let BRAND_CATALOGUE_HEADLINE = ''
export let BRAND_GSTIN = ''

export const BRAND_CATEGORIES = ['Mens Wear', 'Womens Wear', 'Kids Wear'] as const

export const DEFAULT_ACCENT = '#3F3F46'

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const isValidAccent = (hex: string) => parseHex(hex) !== null

/** Sets the --primary-* CSS variables (RGB channels) used by every `primary` Tailwind colour. */
export function applyAccentColor(hex: string): void {
  if (typeof document === 'undefined') return
  const rgb = parseHex(hex) || parseHex(DEFAULT_ACCENT)!
  const mix = (t: number) => rgb.map((c) => Math.round(c + (255 - c) * t)).join(' ')
  const [r, g, b] = rgb
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const vars: Record<string, string> = {
    '--primary': rgb.join(' '),
    '--primary-hover': mix(0.15),
    '--primary-muted': mix(0.3),
    '--primary-soft': mix(0.5),
    '--primary-200': mix(0.75),
    '--primary-100': mix(0.85),
    '--primary-50': mix(0.94),
    '--primary-ink': luminance > 0.62 ? '17 17 17' : '255 255 255',
  }
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`)
}

/** Applies settings to every BRAND_* export (in memory only). */
export function applyBrandSettings(input: Partial<BrandSettings>): void {
  const s: BrandSettings = { ...DEFAULT_BRAND_SETTINGS }
  for (const key of Object.keys(s) as Array<keyof BrandSettings>) {
    const value = input[key]
    if (typeof value === 'string') s[key] = value.trim()
  }
  s.name = s.name || DEFAULT_BRAND_SETTINGS.name
  s.instagram = s.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '')
  if (!isValidAccent(s.accentColor)) s.accentColor = DEFAULT_ACCENT
  BRAND_SETTINGS = s
  applyAccentColor(s.accentColor)

  BRAND_EN = s.name
  BRAND_TA = s.nameTa
  BRAND_SHORT = s.name
  BRAND_TAGLINE = s.tagline
  BRAND_LOGO = s.logo || DEFAULT_LOGO
  BRAND_ICON = BRAND_LOGO
  BRAND_FAVICON = s.logo || '/naayan-favicon.png'
  BRAND_PRINT_LOGO = s.logo || LOGO_BASE64

  const shop = toE164(s.shopPhone)
  const owner = toE164(s.ownerPhone)
  const whatsapp = toE164(s.whatsapp) || shop || owner
  const primary = shop || owner || whatsapp

  BRAND_OWNER_NAME = s.ownerName
  BRAND_OWNER_PHONE_E164 = owner
  BRAND_OWNER_PHONE_DISPLAY = toPhoneDisplay(owner)
  BRAND_SHOP_PHONE_E164 = shop
  BRAND_SHOP_PHONE_DISPLAY = toPhoneDisplay(shop)

  BRAND_PRIMARY_PHONE_E164 = primary
  BRAND_PRIMARY_PHONE_DISPLAY = toPhoneDisplay(primary)
  BRAND_SECONDARY_PHONE_E164 = owner || primary
  BRAND_SECONDARY_PHONE_DISPLAY = toPhoneDisplay(owner || primary)
  BRAND_THIRD_PHONE_E164 = whatsapp
  BRAND_THIRD_PHONE_DISPLAY = toPhoneDisplay(whatsapp)
  BRAND_PHONE_E164 = primary
  BRAND_PHONE_DISPLAY = toPhoneDisplay(primary)

  WHATSAPP_NUM = whatsapp
  BRAND_WHATSAPP = toPhoneDisplay(whatsapp)
  BRAND_WHATSAPP_LINK = whatsapp ? `https://wa.me/${whatsapp}` : ''

  BRAND_EMAIL = s.email
  BRAND_ADDRESS = s.address
  BRAND_INSTAGRAM = s.instagram
  BRAND_INSTAGRAM_URL = s.instagram ? `https://instagram.com/${s.instagram}` : ''
  BRAND_CITY = s.city
  BRAND_HOURS = s.businessHours
  BRAND_CATALOGUE_HEADLINE = s.catalogueHeadline
  BRAND_GSTIN = s.gstin.toUpperCase()
  BRAND_LOCATION_LINK = s.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`
    : '#'
}

export function readCachedBrandSettings(): Partial<BrandSettings> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Partial<BrandSettings>) : null
  } catch {
    return null
  }
}

export function cacheBrandSettings(s: BrandSettings): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s))
  } catch {
    // Storage full or blocked; settings still apply for this session
  }
}

applyBrandSettings(readCachedBrandSettings() || {})

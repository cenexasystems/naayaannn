import JsBarcode from 'jsbarcode'

/** Normalize any scanned or user-entered barcode to a consistent UPPERCASE trimmed string. */
export const normalizeBarcode = (code: string | null | undefined): string => {
  return (code ?? '').trim().toUpperCase()
}

export interface LabelSizeConfig {
  id: string
  name: string
  labelsPerRow: number
  widthMm: number
  heightMm: number
  horizontalGapMm: number
  /** Blank space after each row on the roll (die-cut gap). Added to the page height. */
  verticalGapMm?: number
  isCustom?: boolean
}

export const DEFAULT_LABEL_SIZES: LabelSizeConfig[] = [
  { id: '2_38x25', name: '38 × 25 mm (Tag / Jewelry)', labelsPerRow: 1, widthMm: 38, heightMm: 25, horizontalGapMm: 0 },
  { id: '1_50x25', name: '50 × 25 mm (Standard Compact)', labelsPerRow: 1, widthMm: 50, heightMm: 25, horizontalGapMm: 0 },
  { id: '2_50x25', name: '50 × 38 mm (Retail Standard)', labelsPerRow: 1, widthMm: 50, heightMm: 38, horizontalGapMm: 0 },
  { id: '1_60x40', name: '60 × 40 mm (Shipping)', labelsPerRow: 1, widthMm: 60, heightMm: 40, horizontalGapMm: 0 },
  { id: '1_100x50', name: '100 × 50 mm (Large Carton / Box)', labelsPerRow: 1, widthMm: 100, heightMm: 50, horizontalGapMm: 0 },
  { id: '2up_50x25', name: '50 × 25 mm × 2 (2-Up Roll, Candidate A)', labelsPerRow: 2, widthMm: 50, heightMm: 25, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '2up_50x30', name: '50 × 30 mm × 2 (2-Up Roll, Candidate B)', labelsPerRow: 2, widthMm: 50, heightMm: 30, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '3up_33x22', name: '33 × 22 mm (3-Up Triple Roll)', labelsPerRow: 3, widthMm: 33, heightMm: 22, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '3up_33x25', name: '33 × 25 mm × 3 (3-Up Roll, Candidate A)', labelsPerRow: 3, widthMm: 33, heightMm: 25, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '3up_38x25', name: '38 × 25 mm × 3 (3-Up Roll, Candidate B)', labelsPerRow: 3, widthMm: 38, heightMm: 25, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '4up_25x25', name: '25 × 25 mm × 4 (4-Up Roll, Candidate A)', labelsPerRow: 4, widthMm: 25, heightMm: 25, horizontalGapMm: 2, verticalGapMm: 0 },
  { id: '4up_30x20', name: '30 × 20 mm × 4 (4-Up Roll, Candidate B)', labelsPerRow: 4, widthMm: 30, heightMm: 20, horizontalGapMm: 2, verticalGapMm: 0 },
]

export interface BarcodeSettings {
  printerType: 'label' | 'regular'
  selectedSizeId: string
  showSalePrice: boolean
  showCompanyName: boolean
  showItemName: boolean
  showDiscount: boolean
}

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  printerType: 'label',
  selectedSizeId: '2_38x25',
  showSalePrice: true,
  showCompanyName: true,
  showItemName: true,
  showDiscount: false,
}

const SETTINGS_KEY = 'universallook_barcode_settings'
const LEGACY_SETTINGS_KEY = 'ul_legacy1_barcode_settings'
const OLD_LEGACY_SETTINGS_KEY = 'ul_legacy2_barcode_settings'
const CUSTOM_SIZES_KEY = 'universallook_custom_label_sizes'
const LEGACY_CUSTOM_SIZES_KEY = 'ul_legacy1_custom_label_sizes'
const OLD_LEGACY_CUSTOM_SIZES_KEY = 'ul_legacy2_custom_label_sizes'

export function getStoredBarcodeSettings(): BarcodeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || localStorage.getItem(OLD_LEGACY_SETTINGS_KEY)
    if (raw) {
      const parsed = { ...DEFAULT_BARCODE_SETTINGS, ...JSON.parse(raw) }
      return parsed
    }
  } catch (e) {
    console.error('Failed to parse barcode settings:', e)
  }
  return DEFAULT_BARCODE_SETTINGS
}

export function saveStoredBarcodeSettings(settings: BarcodeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save barcode settings:', e)
  }
}

export function getStoredCustomSizes(): LabelSizeConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SIZES_KEY) || localStorage.getItem(LEGACY_CUSTOM_SIZES_KEY) || localStorage.getItem(OLD_LEGACY_CUSTOM_SIZES_KEY)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        const seenNames = new Set(DEFAULT_LABEL_SIZES.map(d => d.name.trim().toLowerCase()))
        const seenIds = new Set(DEFAULT_LABEL_SIZES.map(d => d.id))
        const seenSignatures = new Set(DEFAULT_LABEL_SIZES.map(d => `${d.widthMm}x${d.heightMm}_${d.labelsPerRow}`))
        const unique: LabelSizeConfig[] = []
        for (const item of list) {
          if (!item || !item.name) continue
          const lower = String(item.name).trim().toLowerCase()
          const sig = `${item.widthMm}x${item.heightMm}_${item.labelsPerRow || 1}`
          // Ignore legacy test candidates
          if (lower.includes('candidate a') || lower.includes('candidate b')) continue
          if (!seenNames.has(lower) && !seenIds.has(item.id) && !seenSignatures.has(sig)) {
            seenNames.add(lower)
            seenIds.add(item.id)
            seenSignatures.add(sig)
            unique.push({ ...item, isCustom: true })
          }
        }
        return unique
      }
    }
  } catch (e) {
    console.error('Failed to parse custom label sizes:', e)
  }
  return []
}

export function saveStoredCustomSize(size: LabelSizeConfig): LabelSizeConfig[] {
  const lowerName = size.name.trim().toLowerCase()
  const sig = `${size.widthMm}x${size.heightMm}_${size.labelsPerRow}`
  const existing = getStoredCustomSizes().filter(
    (s) => s.id !== size.id &&
           s.name.trim().toLowerCase() !== lowerName &&
           `${s.widthMm}x${s.heightMm}_${s.labelsPerRow}` !== sig
  )
  const updated = [...existing, { ...size, isCustom: true }]
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save custom label size:', e)
  }
  return updated
}

export function deleteStoredCustomSize(id: string): LabelSizeConfig[] {
  const existing = getStoredCustomSizes().filter((s) => s.id !== id)
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Failed to delete custom label size:', e)
  }
  return existing
}

export function getAllLabelSizes(): LabelSizeConfig[] {
  return [...DEFAULT_LABEL_SIZES, ...getStoredCustomSizes()]
}

export interface BarcodeQueueItem {
  id: string
  productId: number
  productName: string
  variantId?: string | null
  variantName?: string
  barcodeValue: string
  price: number
  costPrice?: number
  noOfLabels: number
  header: string
  line1: string
  line2: string
  line3: string
  line4: string
  selected: boolean
}

export interface BarcodeRenderOptions {
  width?: number
  height?: number
  displayValue?: boolean
  fontSize?: number
  font?: string
  textMargin?: number
  margin?: number
  lineColor?: string
  background?: string
}

/**
 * Render a CODE128 barcode directly into an SVG element.
 */
export function renderBarcodeSvg(
  svgElement: SVGSVGElement,
  value: string,
  options?: BarcodeRenderOptions
) {
  if (!svgElement || !value) return

  try {
    JsBarcode(svgElement, value.trim(), {
      format: 'CODE128',
      width: options?.width ?? 1.5,
      height: options?.height ?? 36,
      displayValue: options?.displayValue ?? true,
      fontSize: options?.fontSize ?? 11,
      font: options?.font ?? 'monospace',
      textMargin: options?.textMargin ?? 1,
      margin: options?.margin ?? 4,
      lineColor: options?.lineColor ?? '#000000',
      background: options?.background ?? '#ffffff',
    })
  } catch (err) {
    console.error('[renderBarcodeSvg] Failed to generate barcode:', err)
  }
}

/**
 * Generate a standalone SVG string for a CODE128 barcode.
 * Executes synchronously in the browser without requiring external CDN scripts.
 */
export function generateBarcodeSvgString(
  value: string,
  options?: BarcodeRenderOptions
): string {
  if (typeof document === 'undefined' || !value) return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    renderBarcodeSvg(svg, value, options)
    return svg.outerHTML || new XMLSerializer().serializeToString(svg)
  } catch (err) {
    console.error('[generateBarcodeSvgString] Failed to generate barcode SVG string:', err)
    return ''
  }
}

/**
 * Format barcode for UI display.
 */
export function formatBarcodeDisplay(value?: string | null): string {
  if (!value) return '—'
  return String(value).trim()
}

/**
 * Validate barcode format (alphanumeric, 4 to 32 chars).
 */
export function isValidBarcodeValue(value: string): boolean {
  return /^[A-Z0-9_-]{4,32}$/i.test(value.trim())
}

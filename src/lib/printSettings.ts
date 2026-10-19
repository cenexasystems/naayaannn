// Remembers the counter's printer choice (thermal roll 58/80 mm or A4/A5 sheet) on this device.

export type PrinterType = 'thermal' | 'sheet'
export type ThermalWidth = '58' | '80'
export type SheetSize = 'A4' | 'A5'

export interface PrintSettings {
  printer: PrinterType
  thermalWidth: ThermalWidth
  sheetSize: SheetSize
}

const KEY = 'naayan.printSettings'
export const DEFAULT_PRINT_SETTINGS: PrintSettings = { printer: 'thermal', thermalWidth: '80', sheetSize: 'A4' }

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<PrintSettings> | null
    if (!raw) return { ...DEFAULT_PRINT_SETTINGS }
    return {
      printer: raw.printer === 'sheet' ? 'sheet' : 'thermal',
      thermalWidth: raw.thermalWidth === '58' ? '58' : '80',
      sheetSize: raw.sheetSize === 'A5' ? 'A5' : 'A4',
    }
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS }
  }
}

export function savePrintSettings(settings: PrintSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
}

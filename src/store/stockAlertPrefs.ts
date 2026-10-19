import { create } from 'zustand'

/** Low-stock alert preferences for this device (Settings → Stock Alerts). */
interface StockAlertPrefs {
  /** Show the low-stock popup when items run low */
  notify: boolean
  /** Play the alarm sound with the popup */
  sound: boolean
  setNotify: (on: boolean) => void
  setSound: (on: boolean) => void
}

const KEY = 'naayan.stockAlertPrefs'

function load(): { notify: boolean; sound: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<{ notify: boolean; sound: boolean }> | null
    return { notify: raw?.notify !== false, sound: raw?.sound !== false }
  } catch {
    return { notify: true, sound: true }
  }
}

function persist(prefs: { notify: boolean; sound: boolean }) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* storage unavailable */ }
}

export const useStockAlertPrefs = create<StockAlertPrefs>((set, get) => ({
  ...load(),
  setNotify: (notify) => { set({ notify }); persist({ notify, sound: get().sound }) },
  setSound: (sound) => { set({ sound }); persist({ notify: get().notify, sound }) },
}))

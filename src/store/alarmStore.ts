import { create } from 'zustand'
import { alarmSound } from '../lib/alarmAudio'
import { useStockAlertPrefs } from './stockAlertPrefs'

export interface LowStockItem {
  id: string | number
  name: string
  variantName?: string
  stock: number
  alertThreshold: number
  barcode?: string
  category?: string
}

interface AlarmState {
  lowStockItems: LowStockItem[]
  isAlarmActive: boolean
  silencedItemIds: Set<string | number>
  setLowStockItems: (items: LowStockItem[]) => void
  silenceAlarm: () => void
  resetSilencedState: () => void
}

// Silenced items are remembered across reloads and tabs, so an acknowledged alarm stays quiet
const SILENCED_KEY = 'naayan-silenced-low-stock'
const loadSilenced = (): Set<string | number> => {
  try {
    const raw = localStorage.getItem(SILENCED_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.map(String) : [])
  } catch {
    return new Set()
  }
}
const saveSilenced = (ids: Set<string | number>) => {
  try {
    localStorage.setItem(SILENCED_KEY, JSON.stringify(Array.from(ids, String)))
  } catch {
    // storage unavailable: silencing still works for this tab
  }
}

export const useAlarmStore = create<AlarmState>((set, get) => ({
  lowStockItems: [],
  isAlarmActive: false,
  silencedItemIds: loadSilenced(),

  setLowStockItems: (items) => {
    // Forget silenced ids that are no longer low, so an item that recovers and drops again alarms as new
    const currentIds = new Set(items.map((item) => String(item.id)))
    const silencedItemIds = new Set(Array.from(get().silencedItemIds).filter((id) => currentIds.has(String(id))))
    set({ silencedItemIds })
    saveSilenced(silencedItemIds)
    
    // Alarm triggers only if there is at least one low-stock item that has not been acknowledged
    const hasUnsilencedLowStock = items.some(
      (item) => !silencedItemIds.has(String(item.id)) && !silencedItemIds.has(item.id)
    )

    const { notify, sound } = useStockAlertPrefs.getState()

    if (!notify) {
      // Stock notifications switched off in Settings: keep the list (badges, inventory) but never alarm
      alarmSound.stopAlert()
      set({ lowStockItems: items, isAlarmActive: false })
    } else if (items.length > 0 && hasUnsilencedLowStock) {
      // Check if alarm was already active - if not, make sure to start it
      const wasAlarmActive = get().isAlarmActive
      
      // Always start/restart the alert to ensure sound plays (unless the sound is switched off)
      if (sound) alarmSound.startAlert()
      else alarmSound.stopAlert()
      set({ lowStockItems: items, isAlarmActive: true })
      
      // If alarm wasn't active before, this is a new alert - log it for debugging
      if (!wasAlarmActive) {
        console.log('[Low Stock Alert] New low stock items detected:', items.length)
      }
    } else {
      // If no items or all items are acknowledged/silenced, ensure alert is stopped
      alarmSound.stopAlert()
      set({ lowStockItems: items, isAlarmActive: false })
      if (items.length === 0) {
        set({ silencedItemIds: new Set() })
      }
    }
  },

  silenceAlarm: () => {
    const currentItemIds = get().lowStockItems.map((i) => String(i.id))
    alarmSound.stopAlert()
    const silencedItemIds = new Set<string | number>(currentItemIds)
    set({ isAlarmActive: false, silencedItemIds })
    saveSilenced(silencedItemIds)
  },

  resetSilencedState: () => {
    set({ silencedItemIds: new Set() })
    saveSilenced(new Set())
  },
}))

// Apply Settings changes straight away: turning notifications or sound off stops a ringing alarm
useStockAlertPrefs.subscribe((prefs, prev) => {
  if (prefs.notify === prev.notify && prefs.sound === prev.sound) return
  const state = useAlarmStore.getState()
  if (!prefs.notify) {
    alarmSound.stopAlert()
    useAlarmStore.setState({ isAlarmActive: false })
  } else if (!prefs.sound) {
    alarmSound.stopAlert()
  } else {
    state.setLowStockItems(state.lowStockItems)
  }
})

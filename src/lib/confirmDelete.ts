import { create } from 'zustand'

export type ImpactTone = 'default' | 'danger' | 'success' | 'warning'

export interface ImpactRow {
  label: string
  value: string
  tone?: ImpactTone
}

export interface ConfirmDeleteOptions {
  /** e.g. "Permanently Delete Bill #INV10000078" */
  title: string
  /** e.g. "Customer: test • Date: 18/10/2026" */
  subtitle?: string
  /** Amber notice describing what will be removed */
  warning: string
  /** "Deletion impact summary" rows */
  impact?: ImpactRow[]
  /** Word the user must type; defaults to DELETE */
  confirmText?: string
  /** Button label; defaults to "Permanently Delete" */
  confirmLabel?: string
}

interface DialogState {
  options: ConfirmDeleteOptions | null
  /** Increments per request so the dialog remounts with an empty input */
  requestId: number
  resolve: ((ok: boolean) => void) | null
  open: (options: ConfirmDeleteOptions) => Promise<boolean>
  close: (ok: boolean) => void
}

export const useConfirmDeleteStore = create<DialogState>()((set, get) => ({
  options: null,
  requestId: 0,
  resolve: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      get().resolve?.(false)
      set({ options, resolve, requestId: get().requestId + 1 })
    }),
  close: (ok) => {
    get().resolve?.(ok)
    set({ options: null, resolve: null })
  },
}))

/** Shows the delete confirmation dialog; resolves true only after the user types the confirm word. */
export const confirmDelete = (options: ConfirmDeleteOptions) => useConfirmDeleteStore.getState().open(options)


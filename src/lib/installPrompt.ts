/**
 * Holds the browser's PWA install offer. The beforeinstallprompt event fires once, early
 * in page load, so it is captured here at startup and shown later by the login page.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export const getInstallPrompt = () => deferred

export function clearInstallPrompt() {
  deferred = null
  notify()
}

export function subscribeInstallPrompt(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

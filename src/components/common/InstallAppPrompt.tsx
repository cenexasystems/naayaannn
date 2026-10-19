import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { BRAND_EN, BRAND_ICON } from '../../lib/brand'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'naayan_install_prompt_dismissed_at'
const DISMISS_DAYS = 7

const recentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

/** "Install app" card shown when the browser offers PWA installation. */
export function InstallAppPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      if (!recentlyDismissed()) setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!deferred) return null

  const install = async () => {
    await deferred.prompt()
    await deferred.userChoice.catch(() => null)
    setDeferred(null)
  }

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setDeferred(null)
  }

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:w-[440px] print:hidden">
      <div className="relative flex items-center gap-3.5 rounded-[22px] border border-primary/40 bg-[#111111] p-3.5 pr-4 text-white shadow-[0_20px_45px_-12px_rgba(0,0,0,0.55)]">
        <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-xl bg-primary p-1 ring-1 ring-white/10">
          <img src={BRAND_ICON} alt="" className="h-full w-full object-contain rounded-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-black uppercase tracking-tight">Install {BRAND_EN}</p>
          <p className="truncate text-[12.5px] font-semibold text-white/75">Add app for fast offline access</p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[12px] font-black uppercase tracking-wide text-primary-ink ring-1 ring-white/10 hover:bg-primary-hover"
        >
          <Download size={16} /> Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#111111] shadow ring-1 ring-black/10 hover:bg-gray-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

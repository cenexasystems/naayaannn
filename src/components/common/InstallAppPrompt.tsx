import { useState, useSyncExternalStore } from 'react'
import { Download, Share, X } from 'lucide-react'
import { BRAND_EN, BRAND_ICON } from '../../lib/brand'
import { clearInstallPrompt, getInstallPrompt, subscribeInstallPrompt } from '../../lib/installPrompt'

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

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

// iPhone / iPad Safari never fires beforeinstallprompt; the app is added from the Share menu
const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** "Install app" card for phones, tablets and desktops; hidden once the app is installed. */
export function InstallAppPrompt() {
  const offer = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, () => null)
  const [dismissed, setDismissed] = useState(recentlyDismissed)
  const ios = isIos()

  if (dismissed || isStandalone() || (!offer && !ios)) return null
  const deferred = offer

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice.catch(() => null)
    clearInstallPrompt()
  }

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="fixed right-4 left-4 sm:left-auto z-[60] sm:w-[360px] print:hidden" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
      <div className="relative flex items-center gap-3 rounded-[18px] border border-primary/40 bg-[#111111] p-2.5 pr-3 text-white shadow-[0_20px_45px_-12px_rgba(0,0,0,0.55)]">
        <div className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-lg">
          <img src={BRAND_ICON} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-black uppercase tracking-tight">Install {BRAND_EN}</p>
          <p className={`text-[11px] font-semibold text-white/75 ${deferred ? 'truncate' : ''}`}>
            {deferred ? 'Add app to your phone or desktop' : <>Tap <Share size={11} className="inline -mt-0.5" /> Share, then "Add to Home Screen"</>}
          </p>
        </div>
        {deferred && (
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-wide text-primary-ink ring-1 ring-white/10 hover:bg-primary-hover"
          >
            <Download size={14} /> Install
          </button>
        )}
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

/**
 * Universal CSV download and export utility.
 * Optimised for Desktop, Android, and iOS Safari / iPhone.
 *
 * iOS Safari blocks simulated downloads on `data:` URIs and sometimes drops blob anchor clicks.
 * Using navigator.share({ files: [file] }) invokes the native iOS share sheet (Save to Files, Numbers, etc.),
 * with seamless fallback to Blob object URLs for desktop and other browsers.
 */
export async function downloadCsv(filename: string, csvContent: string): Promise<void> {
  // Prefix UTF-8 BOM so Excel & Apple Numbers display Tamil and Unicode characters correctly
  const contentWithBom = csvContent.startsWith('\uFEFF') ? csvContent : '\uFEFF' + csvContent
  const blob = new Blob([contentWithBom], { type: 'text/csv;charset=utf-8;' })

  // 1. Web Share API with File support — only on iPhone / iPad, where blob downloads are unreliable.
  // Desktop and Android browsers also expose navigator.share, but should download directly.
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  if (isIOS && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], filename, { type: 'text/csv' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        })
        return
      }
    } catch (err: unknown) {
      // If user cancelled/dismissed iOS share sheet, return silently
      if ((err as Error)?.name === 'AbortError') {
        return
      }
      console.warn('Share API error, falling back to anchor download:', err)
    }
  }

  // 2. Blob URL with hidden anchor (Desktop & Android Chrome fallback)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  // Allow browser time to initiate download before revoking
  setTimeout(() => {
    try {
      if (document.body.contains(link)) {
        document.body.removeChild(link)
      }
      URL.revokeObjectURL(url)
    } catch {
      // Ignore cleanup error
    }
  }, 2000)
}

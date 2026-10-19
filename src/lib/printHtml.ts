/**
 * Prints a standalone HTML document.
 *
 * Mobile Chrome / Samsung Internet print a hidden zero-size iframe as a blank page, so on
 * touch devices the document is opened in its own tab and printed from there. Desktop keeps
 * the invisible-iframe approach so no extra tab flashes open.
 */
export function printHtmlDocument(html: string): void {
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  if (isMobile) {
    // Must be opened synchronously inside the click handler or the popup is blocked.
    const win = window.open('', '_blank')
    if (win) {
      const autoPrint =
        '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},350)})</script>'
      win.document.open()
      win.document.write(html.replace('</body>', `${autoPrint}</body>`))
      win.document.close()
      return
    }
  }

  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  document.body.appendChild(frame)

  const doc = frame.contentWindow?.document
  if (!doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    try { frame.remove() } catch { /* ignore */ }
  }
  setTimeout(() => {
    try {
      if (frame.contentWindow) {
        frame.contentWindow.onafterprint = cleanup
        frame.contentWindow.focus()
        frame.contentWindow.print()
      }
    } catch (err) {
      console.warn('[printHtml] Print error:', err)
    } finally {
      setTimeout(cleanup, 2000)
    }
  }, 300)
}

import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { formatInvoiceNo } from './retail'

/** Captures the rendered invoice so the downloaded PDF matches the visible view and anchors footer to the bottom. */
export async function invoicePdfFileFromElement(
  element: HTMLElement,
  invoiceNo: string,
): Promise<File> {
  const formattedNo = formatInvoiceNo(invoiceNo)
  const invoiceRoot = (element.querySelector('#invoice-print-root') as HTMLElement) || element
  const canonicalWidth = 680
  const targetMinHeight = Math.round(canonicalWidth * (297 / 210)) // 962px (exact A4 ratio)

  try {
    const canvas = await html2canvas(invoiceRoot, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: 1024,
      onclone: (_clonedDoc, clonedElement) => {
        const clonedInvoice =
          clonedElement.id === 'invoice-print-root'
            ? clonedElement
            : (clonedElement.querySelector('#invoice-print-root') as HTMLElement) || clonedElement
        clonedInvoice.style.width = `${canonicalWidth}px`
        clonedInvoice.style.minWidth = `${canonicalWidth}px`
        clonedInvoice.style.maxWidth = `${canonicalWidth}px`
        clonedInvoice.style.minHeight = `${targetMinHeight}px`
        clonedInvoice.style.boxSizing = 'border-box'
        clonedInvoice.style.margin = '0 auto'
      },
    })

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageWidth = 210
    const pageHeight = 297
    const imageHeight = (canvas.height * pageWidth) / canvas.width
    const image = canvas.toDataURL('image/png')

    if (imageHeight <= pageHeight + 5) {
      doc.addImage(image, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
    } else {
      let offset = 0
      let page = 0
      while (offset < imageHeight) {
        if (page > 0) doc.addPage()
        doc.addImage(image, 'PNG', 0, -offset, pageWidth, imageHeight, undefined, 'FAST')
        offset += pageHeight
        page += 1
      }
    }

    return new File([doc.output('blob')], `Invoice-${formattedNo}.pdf`, { type: 'application/pdf' })
  } catch (error) {
    console.error('Failed to generate invoice PDF from element:', error)
    throw error
  }
}

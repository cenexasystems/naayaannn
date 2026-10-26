import { formatCurrency, variantOfferPrice } from '../../lib/retail'

/**
 * What one variant sells for once the product's special offer applies: every variant gets the same
 * % off as the product, whatever its own price is. Renders nothing when there is no valid offer.
 */
export default function VariantOfferSummary({ productPrice, offerPrice, variantPrice }: {
  /** The product's actual rate the offer was entered against */
  productPrice: number
  offerPrice: string | number
  variantPrice: number
}) {
  const pays = variantOfferPrice(productPrice, Number(offerPrice), variantPrice)
  if (pays === null) return null
  const off = Math.round((variantPrice - pays) * 100) / 100
  const pct = Math.round((1 - Number(offerPrice) / productPrice) * 10000) / 100
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-amber-50 px-3 py-1.5 text-[11.5px] font-bold text-amber-800">
      <span>Actual <span className="text-gray-500 line-through tabular-nums">{formatCurrency(variantPrice)}</span></span>
      <span>Offer <span className="tabular-nums">{pct}% · −{formatCurrency(off)}</span></span>
      <span>Customer pays <span className="text-emerald-700 tabular-nums">{formatCurrency(pays)}</span></span>
    </p>
  )
}

/**
 * How a stock shortfall is written for people. Every screen that shows one (POS, Log Order,
 * Walk-in, the stock-risk toast) uses these, so a bare "need 0.25" without a unit cannot
 * come back on one screen while the others are fixed.
 */
import type { StockShortfall } from './socket'

const qtyFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 })

/** "0.25 kg", "1,200 g". A negative balance (more reserved than on hand) reads as 0. */
export function formatStockQty(quantity: number, unit: string | undefined): string {
  const n = qtyFormat.format(Math.max(0, quantity))
  return unit ? `${n} ${unit}` : n
}

/** How much is missing: required minus what is available. */
export function shortBy(s: StockShortfall): number {
  return s.required - Math.max(0, s.available)
}

/** "250 g per Large Fries × 2": the recipe amount as it was typed, else in the stock unit. */
export function perServingText(use: NonNullable<StockShortfall['used_by']>[number], unit: string | undefined): string {
  const amount = use.entered ? `${qtyFormat.format(use.entered.quantity)} ${use.entered.unit}` : formatStockQty(use.per_serving, unit)
  return `${amount} per ${use.name}${use.qty > 1 ? ` × ${use.qty}` : ''}`
}

/** One line for toasts and compact lists: "Potato: need 0.25 kg, have 0 kg". */
export function shortfallSummary(s: StockShortfall): string {
  return `${s.ingredient_name}: need ${formatStockQty(s.required, s.unit)}, have ${formatStockQty(s.available, s.unit)}`
}

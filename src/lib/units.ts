/**
 * Units of measure on the screen (D57). Mirrors ckitchen_backend src/modules/units/catalog.ts
 * so pickers and previews ("250 g = 0.25 kg") work without a round trip. The SERVER is the
 * authority: it converts every typed quantity into the ingredient's stock unit with exact
 * decimals; numbers here are previews only.
 */

export type Dimension = 'mass' | 'volume' | 'count'

export interface StandardUnit {
  code: string
  label: string
  dimension: Dimension
  /** How many g / mL / pc one of this unit is. */
  base: number
}

export const STANDARD_UNITS: readonly StandardUnit[] = [
  { code: 'kg', label: 'kilogram', dimension: 'mass', base: 1000 },
  { code: 'g', label: 'gram', dimension: 'mass', base: 1 },
  { code: 'mg', label: 'milligram', dimension: 'mass', base: 0.001 },
  { code: 'lb', label: 'pound', dimension: 'mass', base: 453.59237 },
  { code: 'oz', label: 'ounce', dimension: 'mass', base: 28.349523125 },
  { code: 'L', label: 'litre', dimension: 'volume', base: 1000 },
  { code: 'mL', label: 'millilitre', dimension: 'volume', base: 1 },
  { code: 'gal', label: 'gallon (US)', dimension: 'volume', base: 3785.411784 },
  { code: 'cup', label: 'cup (US)', dimension: 'volume', base: 236.5882365 },
  { code: 'tbsp', label: 'tablespoon', dimension: 'volume', base: 14.78676478125 },
  { code: 'tsp', label: 'teaspoon', dimension: 'volume', base: 4.92892159375 },
  { code: 'pc', label: 'piece', dimension: 'count', base: 1 },
  { code: 'dozen', label: 'dozen', dimension: 'count', base: 12 },
]

export const DIMENSION_LABEL: Record<Dimension, string> = { mass: 'Weight', volume: 'Volume', count: 'Count' }

const BY_CODE = new Map(STANDARD_UNITS.map((u) => [u.code, u]))

const ALIASES: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gr: 'g', gram: 'g', grams: 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  l: 'L', lt: 'L', ltr: 'L', ltrs: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  ml: 'mL', milliliter: 'mL', milliliters: 'mL', millilitre: 'mL', millilitres: 'mL',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  pc: 'pc', pcs: 'pc', pce: 'pc', piece: 'pc', pieces: 'pc', ea: 'pc', each: 'pc',
  dozen: 'dozen', doz: 'dozen', dz: 'dozen',
}

export function standardUnitCode(unit: string | null | undefined): string | null {
  return unit ? ALIASES[unit.trim().toLowerCase()] ?? null : null
}

export function standardUnit(unit: string | null | undefined): StandardUnit | undefined {
  const code = standardUnitCode(unit)
  return code ? BY_CODE.get(code) : undefined
}

/** A custom unit of one ingredient: `toStock` stock units in one of it ("sack" = 25 kg). */
export interface CustomUnit {
  name: string
  toStock: string
}

export interface UnitChoice {
  code: string
  label: string
  kind: 'stock' | 'standard' | 'custom'
  /** Stock units in one of this unit. */
  toStock: number
}

/** Every unit a quantity of an ingredient stocked in `stockUnit` may be typed in. */
export function unitChoices(stockUnit: string, custom: CustomUnit[] = []): UnitChoice[] {
  const stock = standardUnit(stockUnit)
  const choices: UnitChoice[] = [{ code: stock?.code ?? stockUnit, label: stock?.label ?? stockUnit, kind: 'stock', toStock: 1 }]
  if (stock) {
    for (const unit of STANDARD_UNITS) {
      if (unit.dimension === stock.dimension && unit.code !== stock.code) {
        choices.push({ code: unit.code, label: unit.label, kind: 'standard', toStock: unit.base / stock.base })
      }
    }
  }
  for (const c of custom) choices.push({ code: c.name, label: c.name, kind: 'custom', toStock: Number(c.toStock) })
  return choices
}

/** Preview of a typed amount in stock units, or null when it cannot be converted. */
export function previewInStock(quantity: string | number, unit: string | undefined, stockUnit: string, custom: CustomUnit[] = []): number | null {
  const value = typeof quantity === 'number' ? quantity : Number(quantity)
  if (!Number.isFinite(value)) return null
  if (!unit) return value
  const match = unitChoices(stockUnit, custom).find((c) => c.code.toLowerCase() === (standardUnitCode(unit) ?? unit).toLowerCase())
  return match ? value * match.toStock : null
}

/** "0.25 kg", "1,250 g": up to 6 decimals, trailing zeros dropped, grouped thousands. */
export function formatQuantity(value: number | string | null | undefined, unit?: string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '—'
  const text = n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return unit ? `${text} ${unit}` : text
}

/** Rescales a typed number (keeps "" as ""), trimmed to 6 decimals: 0.25 / 0.001 -> "250". */
export function rescaleTyped(value: string, factor: number): string {
  if (value.trim() === '' || !Number.isFinite(Number(value)) || !(factor > 0)) return value
  return String(Number((Number(value) * factor).toFixed(6)))
}

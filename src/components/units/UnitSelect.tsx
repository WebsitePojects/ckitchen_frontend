import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../lib/api'
import { DIMENSION_LABEL, STANDARD_UNITS, standardUnit, unitChoices, type CustomUnit } from '../../lib/units'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

/** GET /ingredients/:id/units (ckitchen_backend src/modules/units/routes.ts). */
interface IngredientUnitsResponse {
  stockUnit: string
  custom: CustomUnit[]
}

/** The custom units of one ingredient (cached; refreshed when they are edited). */
export function useIngredientCustomUnits(ingredientId: string | undefined) {
  return useQuery({
    queryKey: ['ingredient-units', ingredientId],
    queryFn: async () => (await get<IngredientUnitsResponse>(`/ingredients/${ingredientId}/units`)).data.custom,
    enabled: Boolean(ingredientId),
    staleTime: 5 * 60_000,
  })
}

/**
 * Picks the unit a quantity is typed in, for one ingredient: its stock unit, the standard
 * units of the same kind (g / mg for an ingredient stocked in kg), and its custom units.
 *
 * Picking a unit never changes the amount typed: people type "250" already meaning 250 g
 * (converting it to 250,000 when g is picked after kg was the bug). onChange also gives
 * `ratio` = (new unit in stock units) / (old unit in stock units) for a PER-UNIT PRICE on the
 * same line, which must follow the unit: ₱40/kg becomes ₱0.04/g (price × ratio).
 */
export function UnitSelect({
  ingredientId,
  stockUnit,
  value,
  onChange,
  disabled,
  className,
}: {
  ingredientId: string | undefined
  stockUnit: string | undefined
  value: string | undefined
  onChange: (unit: string, ratio: number) => void
  disabled?: boolean
  className?: string
}) {
  const { data: custom = [] } = useIngredientCustomUnits(ingredientId)
  if (!stockUnit) {
    return <span className={cn('inline-flex h-9 min-w-14 items-center px-2 text-xs text-muted-foreground', className)}>unit</span>
  }
  const choices = unitChoices(stockUnit, custom)
  const current = choices.find((c) => c.code.toLowerCase() === (value ?? '').toLowerCase()) ?? choices[0]!
  return (
    <Select
      value={current.code}
      onValueChange={(code) => {
        const next = choices.find((c) => c.code === code)
        onChange(code, next && current.toStock > 0 ? next.toStock / current.toStock : 1)
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-9 w-auto min-w-16 gap-1 px-2 text-sm', className)} aria-label="Unit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            {c.code}
            {c.kind === 'custom' && <span className="ml-1.5 text-xs text-muted-foreground">= {Number(c.toStock.toFixed(6))} {stockUnit}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const OTHER = '__other__'

/**
 * Chooses an ingredient's STOCK unit: a standard unit (grouped by kind), or "Other" for a
 * business-specific unit such as "tray" or "bottle". Prefer a standard unit: the others
 * then convert automatically everywhere.
 */
export function StockUnitPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string
  onChange: (unit: string) => void
  disabled?: boolean
  id?: string
}) {
  const isStandard = Boolean(standardUnit(value))
  // "Other" is a choice the person makes; an empty new ingredient is not "other" yet.
  const [otherMode, setOtherMode] = useState(value !== '' && !isStandard)
  return (
    <div className="flex gap-2">
      <Select
        value={isStandard && !otherMode ? standardUnit(value)!.code : otherMode ? OTHER : ''}
        onValueChange={(v) => {
          setOtherMode(v === OTHER)
          onChange(v === OTHER ? '' : v)
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9 text-sm">
          <SelectValue placeholder="Choose a unit" />
        </SelectTrigger>
        <SelectContent>
          {(['mass', 'volume', 'count'] as const).map((dimension) => (
            <SelectGroup key={dimension}>
              <SelectLabel>{DIMENSION_LABEL[dimension]}</SelectLabel>
              {STANDARD_UNITS.filter((u) => u.dimension === dimension).map((u) => (
                <SelectItem key={u.code} value={u.code}>
                  {u.code} <span className="ml-1 text-xs text-muted-foreground">{u.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value={OTHER}>Other unit (tray, bottle…)</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {otherMode && (
        <Input
          aria-label="Other unit name"
          className="h-9 w-28 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="e.g. tray"
          maxLength={24}
          autoFocus
        />
      )}
    </div>
  )
}

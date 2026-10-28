/**
 * RecipeEditor — the "an item = name + linked ingredients consumed per serving"
 * builder embedded in the Menu Add/Edit dialogs (src/pages/Menu.tsx).
 *
 * Each recipe line = an ingredient + a per-serving portion quantity. The parent
 * owns the `lines` array; RecipeEditor reports every mutation via `onChange`
 * (the parent uses that to mark the section "touched" so an untouched editor
 * never wipes an existing recipe on save).
 *
 * Backend contract (coded against defensively):
 *   GET  /ingredients                      → [{ id, name, unit, unitCost, lowStockThreshold, suppliers? }]
 *   GET  /inventory?warehouse=KITCHEN       → stock rows (joined client-side for "available" hint)
 *   GET  /suppliers?active=true            → [{ id, code, name, isActive }]
 *   POST /ingredients { name, unit, unit_cost, low_stock_threshold, supplier_id, supplier_sku? } → created row
 *
 * The parent issues PUT /menu/:id/recipe { lines: [{ ingredient_id, quantity, unit }] } on save.
 * A line may be typed in any unit the ingredient accepts (250 g for potatoes stocked in kg, or
 * a custom unit like "scoop"); the server converts it to the stock unit (D57). Previews and the
 * cost here use the same factors but are display only.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { formatQuantity, previewInStock, rescaleTyped, type CustomUnit } from '../lib/units'
import { StockUnitPicker, UnitSelect } from './units/UnitSelect'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecipeLine {
  ingredientId: string
  /** The typed amount, kept as a string: exact, and the input can hold partial values. */
  portionQty: string
  /** The unit it was typed in; undefined = the ingredient's stock unit. */
  unit?: string
}

interface Ingredient {
  id: string
  name: string
  unit: string
  unitCost: string
  lowStockThreshold: string
}

interface KitchenStockRow {
  ingredientId: string
  quantity: string
  available?: number | string
  ingredient?: { id: string; unit: string }
}

interface SupplierParty {
  id: string
  code: string
  name: string
  isActive: boolean
}

interface RecipeEditorProps {
  lines: RecipeLine[]
  onChange: (lines: RecipeLine[]) => void
  disabled?: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : undefined
}

function fmtQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

// ─── Ingredient combobox (searchable) ───────────────────────────────────────

interface IngredientComboboxProps {
  value: string
  ingredients: Ingredient[]
  availableFor: (ingredientId: string) => number | null
  onSelect: (ingredientId: string) => void
  onNew: () => void
  disabled?: boolean
}

function IngredientCombobox({
  value,
  ingredients,
  availableFor,
  onSelect,
  onNew,
  disabled,
}: IngredientComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = ingredients.find(i => i.id === value)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ingredients
    return ingredients.filter(i => i.name.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q))
  }, [ingredients, query])

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          !selected && 'text-muted-foreground',
        )}
      >
        <span className="truncate">
          {selected ? `${selected.name} (${selected.unit})` : 'Select ingredient…'}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[16rem] rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Enter must never submit the surrounding item form. If the
                // search narrows to exactly one match, Enter picks it.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (filtered.length === 1) {
                    onSelect(filtered[0].id)
                    setOpen(false)
                    setQuery('')
                  }
                } else if (e.key === 'Escape') {
                  // Close only the combobox — stopPropagation keeps the
                  // surrounding Radix dialog open.
                  e.preventDefault()
                  e.stopPropagation()
                  setOpen(false)
                }
              }}
              placeholder="Search ingredients…"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setQuery('')
                  onNew()
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium text-ink-accent hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New ingredient…
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">No ingredient matches.</li>
            ) : (
              filtered.map(ing => {
                const avail = availableFor(ing.id)
                return (
                  <li key={ing.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(ing.id)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
                        ing.id === value ? 'text-ink-accent' : 'text-foreground',
                      )}
                    >
                      <span className="truncate">
                        {ing.name} <span className="text-muted-foreground">({ing.unit})</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {avail === null ? 'no stock' : `${fmtQty(avail)} ${ing.unit}`}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── New-ingredient inline sub-form ─────────────────────────────────────────

interface NewIngredientFormProps {
  suppliers: SupplierParty[]
  onCancel: () => void
  onCreated: (ingredient: Ingredient) => void
}

function NewIngredientForm({ suppliers, onCancel, onCreated }: NewIngredientFormProps) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [threshold, setThreshold] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [sku, setSku] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const noSuppliers = suppliers.length === 0

  async function submit() {
    if (submitting) return
    if (!name.trim()) {
      toast.error('Ingredient name is required.')
      return
    }
    if (!unit.trim()) {
      toast.error('Unit is required (e.g. kg, g, L, pcs).')
      return
    }
    const costNum = Number(unitCost)
    if (unitCost === '' || !Number.isFinite(costNum) || costNum < 0) {
      toast.error('Unit cost must be a number ≥ 0.')
      return
    }
    const thresholdNum = Number(threshold)
    if (threshold === '' || !Number.isFinite(thresholdNum) || thresholdNum < 0) {
      toast.error('Low-stock threshold must be a number ≥ 0.')
      return
    }
    // ERP discipline: every new ingredient states where it comes from.
    if (!supplierId) {
      toast.error('Select the supplier this ingredient is purchased from.')
      return
    }
    setSubmitting(true)
    try {
      const res = await post<Ingredient>('/ingredients', {
        name: name.trim(),
        unit: unit.trim(),
        unit_cost: costNum,
        low_stock_threshold: thresholdNum,
        supplier_id: supplierId,
        supplier_sku: sku.trim() || undefined,
      })
      toast.success(`"${res.data.name}" created.`)
      onCreated(res.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create ingredient.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
      onKeyDown={e => {
        // This sub-form lives inside the item <form>: Enter in any of its
        // inputs must create the ingredient, not submit the whole item.
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          if (!noSuppliers && !submitting) void submit()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-accent">
          New ingredient
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel new ingredient"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {noSuppliers ? (
        <p className="mb-2 rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-warn-text">
          Add a supplier in Master Data first — a new ingredient must state where it comes from.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-muted-foreground">Name</label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={noSuppliers || submitting}
            placeholder="e.g. Garlic"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Stock unit</label>
          <StockUnitPicker value={unit} onChange={setUnit} disabled={noSuppliers || submitting} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Unit cost (₱)</label>
          <Input
            type="number"
            min="0"
            step="any"
            value={unitCost}
            onChange={e => setUnitCost(e.target.value)}
            disabled={noSuppliers || submitting}
            placeholder="0.00"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Low-stock threshold</label>
          <Input
            type="number"
            min="0"
            step="any"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            disabled={noSuppliers || submitting}
            placeholder="0"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Supplier item code (optional)</label>
          <Input
            value={sku}
            onChange={e => setSku(e.target.value)}
            disabled={noSuppliers || submitting}
            placeholder="optional"
            className="h-8 text-sm"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-muted-foreground">
            Supplier <span className="text-emerald-500">*</span>
          </label>
          <Select
            value={supplierId || '_none'}
            onValueChange={v => setSupplierId(v === '_none' ? '' : v)}
            disabled={noSuppliers || submitting}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select supplier…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Select supplier…</SelectItem>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-2.5 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={noSuppliers || submitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create & use'}
        </Button>
      </div>
    </div>
  )
}

// ─── RecipeEditor ───────────────────────────────────────────────────────────

export default function RecipeEditor({ lines, onChange, disabled }: RecipeEditorProps) {
  const { selectedOutletId } = useOutlet()
  const queryClient = useQueryClient()

  // Which line index (if any) currently shows the inline new-ingredient form.
  const [newFormFor, setNewFormFor] = useState<number | null>(null)

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => (await get<Ingredient[]>('/ingredients')).data,
  })

  const { data: kitchenStock = [] } = useQuery({
    queryKey: ['inventory', 'KITCHEN', selectedOutletId],
    queryFn: async () => (await get<KitchenStockRow[]>('/inventory?warehouse=KITCHEN')).data,
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => (await get<SupplierParty[]>('/suppliers?active=true')).data,
  })

  const ingredientsById = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients])

  // ingredientId → available KITCHEN qty (available ?? on-hand). null when there's no stock row.
  const availableByIngredient = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of kitchenStock) {
      const avail = toNum(row.available) ?? toNum(row.quantity) ?? 0
      m.set(row.ingredientId, avail)
    }
    return m
  }, [kitchenStock])

  const availableFor = (ingredientId: string): number | null =>
    availableByIngredient.has(ingredientId) ? availableByIngredient.get(ingredientId)! : null

  // ── Line mutations ────────────────────────────────────────────────────────
  function updateLine(index: number, patch: Partial<RecipeLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function removeLine(index: number) {
    if (newFormFor === index) setNewFormFor(null)
    onChange(lines.filter((_, i) => i !== index))
  }
  function addLine() {
    onChange([...lines, { ingredientId: '', portionQty: '', unit: undefined }])
  }

  function handleCreated(index: number, created: Ingredient) {
    // Optimistically add to the shared ingredients cache so the combobox can
    // resolve the new id immediately, then invalidate for the authoritative list.
    queryClient.setQueryData<Ingredient[]>(['ingredients'], prev => {
      if (!prev) return [created]
      return prev.some(i => i.id === created.id) ? prev : [...prev, created]
    })
    void queryClient.invalidateQueries({ queryKey: ['ingredients'] })
    updateLine(index, { ingredientId: created.id })
    setNewFormFor(null)
  }

  // The custom units UnitSelect loaded for each line's ingredient (same query cache).
  const customUnitsFor = (ingredientId: string): CustomUnit[] =>
    queryClient.getQueryData<CustomUnit[]>(['ingredient-units', ingredientId]) ?? []

  /** A line's amount in its ingredient's stock unit (preview; the server converts on save). */
  const stockAmount = (line: RecipeLine): number | null => {
    const ing = ingredientsById.get(line.ingredientId)
    if (!ing || line.portionQty.trim() === '') return null
    return previewInStock(line.portionQty, line.unit, ing.unit, customUnitsFor(line.ingredientId))
  }

  // ── Recipe cost (Σ amount in stock unit × unit_cost, per serving) ────────
  const recipeCost = lines.reduce((total, l) => {
    const amount = stockAmount(l)
    const cost = toNum(ingredientsById.get(l.ingredientId)?.unitCost)
    return amount !== null && cost !== undefined ? total + amount * cost : total
  }, 0)

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Recipe</p>
          <p className="text-[11px] text-muted-foreground">Ingredients consumed / reserved per serving.</p>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No ingredients yet — add the ingredients this item consumes per order.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => {
            const ing = ingredientsById.get(line.ingredientId)
            return (
              <li key={index} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <IngredientCombobox
                      value={line.ingredientId}
                      ingredients={ingredients}
                      availableFor={availableFor}
                      onSelect={id => updateLine(index, { ingredientId: id, unit: undefined })}
                      onNew={() => setNewFormFor(index)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={line.portionQty}
                      onChange={e => updateLine(index, { portionQty: e.target.value })}
                      disabled={disabled}
                      placeholder="qty"
                      className="h-9 w-24 text-sm"
                      aria-label="Amount per serving"
                    />
                    <UnitSelect
                      ingredientId={line.ingredientId || undefined}
                      stockUnit={ing?.unit}
                      value={line.unit}
                      onChange={(unit, ratio) => updateLine(index, { unit, portionQty: rescaleTyped(line.portionQty, 1 / ratio) })}
                      disabled={disabled || !ing}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(index)}
                    disabled={disabled}
                    aria-label="Remove ingredient"
                    className="h-9 w-9 flex-none text-muted-foreground hover:text-danger-text hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {ing && line.unit && line.unit !== ing.unit && line.portionQty.trim() !== '' && (
                  <p className="pl-1 text-[11px] text-muted-foreground">
                    = {formatQuantity(stockAmount(line), ing.unit)} from stock per serving
                  </p>
                )}

                {newFormFor === index && (
                  <NewIngredientForm
                    suppliers={suppliers}
                    onCancel={() => setNewFormFor(null)}
                    onCreated={created => handleCreated(index, created)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={disabled}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add ingredient
        </Button>
        <div className="text-right">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Recipe cost / serving</span>
          <span className="ml-2 font-mono text-sm font-semibold text-ink-accent tabular-nums">
            ₱{recipeCost.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus, Ruler, Trash2 } from 'lucide-react'
import { put } from '../../lib/api'
import { formatQuantity, standardUnit, unitChoices } from '../../lib/units'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useIngredientCustomUnits } from './UnitSelect'

interface Row {
  name: string
  amount: string
  unit: string
}

/**
 * "Other units" of one ingredient, e.g. 1 sack = 25 kg, 1 scoop = 120 g, 1 tray = 30 pc.
 * Once saved they can be picked wherever a quantity of this ingredient is typed (recipes,
 * deliveries, transfers, adjustments, purchase requests and orders) and convert to the
 * stock unit automatically. Standard units (g, mg, L, mL, lb…) need no entry here.
 */
export default function CustomUnitsEditor({ ingredientId, stockUnit }: { ingredientId: string; stockUnit: string }) {
  const queryClient = useQueryClient()
  const { data: saved = [], isLoading } = useIngredientCustomUnits(ingredientId)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // Sizes may be typed in the stock unit or any standard unit of the same kind.
  const sizeUnits = unitChoices(stockUnit).map((c) => c.code)

  useEffect(() => {
    setRows(saved.map((c) => ({ name: c.name, amount: String(Number(c.toStock)), unit: stockUnit })))
  }, [saved, stockUnit])

  const dirty =
    rows.length !== saved.length ||
    rows.some((r, i) => r.name !== saved[i]?.name || Number(r.amount) !== Number(saved[i]?.toStock) || r.unit !== stockUnit)

  async function save() {
    if (savingRef.current) return
    const cleaned = rows.filter((r) => r.name.trim() || r.amount.trim())
    if (cleaned.some((r) => !r.name.trim() || !(Number(r.amount) > 0))) {
      toast.error('Each unit needs a name and a size above zero.')
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await put(`/ingredients/${ingredientId}/units`, {
        custom: cleaned.map((r) => ({ name: r.name.trim(), amount: r.amount.trim(), unit: r.unit })),
      })
      await queryClient.invalidateQueries({ queryKey: ['ingredient-units', ingredientId] })
      toast.success('Units saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the units.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const stock = standardUnit(stockUnit)
  return (
    <div className="mt-1 border-t border-border pt-4">
      <div className="mb-1 flex items-center gap-2">
        <Ruler className="h-4 w-4 text-emerald-500" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Other units</h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Stocked in <span className="font-medium text-foreground">{stockUnit}</span>.
        {stock ? ` ${unitChoices(stockUnit).filter((c) => c.kind === 'standard').map((c) => c.code).join(', ')} convert automatically.` : ''}{' '}
        Add packaging or kitchen measures, like a sack, a pack or a scoop.
      </p>

      {isLoading ? (
        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading units…
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">1</span>
              <Input
                value={row.name}
                onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
                placeholder="sack"
                maxLength={24}
                className="h-9 w-28"
                aria-label="Unit name"
                disabled={saving}
              />
              <span className="text-muted-foreground">=</span>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={row.amount}
                onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
                placeholder="25"
                className="h-9 w-24"
                aria-label="How much one is"
                disabled={saving}
              />
              <Select value={row.unit} onValueChange={(unit) => setRows(rows.map((r, i) => (i === index ? { ...r, unit } : r)))} disabled={saving}>
                <SelectTrigger className="h-9 w-auto min-w-16 px-2" aria-label="Size unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sizeUnits.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-danger-text"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label={`Remove ${row.name || 'unit'}`}
                disabled={saving}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={saving || rows.length >= 20} onClick={() => setRows([...rows, { name: '', amount: '', unit: stockUnit }])}>
          <Plus className="h-3.5 w-3.5" /> Add unit
        </Button>
        {dirty && (
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Save units
          </Button>
        )}
      </div>
      {saved.length > 0 && !dirty && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {saved.map((c) => `1 ${c.name} = ${formatQuantity(c.toStock, stockUnit)}`).join(' · ')}
        </p>
      )}
    </div>
  )
}

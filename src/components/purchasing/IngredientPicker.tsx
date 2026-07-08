/**
 * IngredientPicker — searchable ingredient select (custom dropdown, no cmdk
 * dependency). Used by SupplierDialog ("Items supplied" add-row) and the
 * Purchasing PR/PO dialogs.
 *
 * When `affiliatedIds` is provided (PO dialog: the selected supplier's linked
 * ingredients, derived from GET /ingredients `suppliers[]`), those items are
 * listed FIRST with a small emerald "supplier item" badge; everything else
 * stays selectable below a divider.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Ingredient } from './types'

interface IngredientPickerProps {
  ingredients: Ingredient[]
  /** Selected ingredient id ('' = none). */
  value: string
  onChange: (id: string) => void
  /** Ingredient ids hidden from the list (e.g. already linked to the supplier). */
  excludeIds?: Set<string>
  /** Ingredient ids surfaced first with the emerald "supplier item" badge. */
  affiliatedIds?: Set<string>
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function IngredientPicker({
  ingredients,
  value,
  onChange,
  excludeIds,
  affiliatedIds,
  placeholder = 'Select ingredient…',
  disabled = false,
  className,
}: IngredientPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const selected = ingredients.find((i) => i.id === value)

  const { affiliated, others } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = ingredients.filter(
      (i) =>
        !(excludeIds?.has(i.id)) &&
        (!q || i.name.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q)),
    )
    if (!affiliatedIds || affiliatedIds.size === 0) return { affiliated: [], others: visible }
    return {
      affiliated: visible.filter((i) => affiliatedIds.has(i.id)),
      others: visible.filter((i) => !affiliatedIds.has(i.id)),
    }
  }, [ingredients, excludeIds, affiliatedIds, query])

  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function renderRow(i: Ingredient, badge: boolean) {
    return (
      <button
        key={i.id}
        type="button"
        onClick={() => pick(i.id)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150',
          i.id === value ? 'bg-emerald-500/10 text-emerald-300' : 'text-zinc-200 hover:bg-zinc-800/60',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {i.name} <span className="text-[11px] text-zinc-500">({i.unit})</span>
        </span>
        {badge && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            supplier item
          </span>
        )}
        {i.id === value && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />}
      </button>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[#1F2A24] bg-[#0A0F0D] px-3 text-sm transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50',
          selected ? 'text-zinc-200' : 'text-zinc-600',
        )}
      >
        <span className="min-w-0 truncate">
          {selected ? (
            <>
              {selected.name}{' '}
              <span className="text-[11px] text-zinc-500">({selected.unit})</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-[#1F2A24] bg-[#121A17] shadow-xl">
          <div className="relative border-b border-[#1F2A24] p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ingredients…"
              className="h-8 w-full rounded-md border border-[#1F2A24] bg-[#0A0F0D] pl-8 pr-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto py-1">
            {affiliated.length === 0 && others.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-zinc-500">No matching ingredients.</p>
            ) : (
              <>
                {affiliated.map((i) => renderRow(i, true))}
                {affiliated.length > 0 && others.length > 0 && (
                  <div className="mx-3 my-1 border-t border-[#1F2A24]" role="separator" />
                )}
                {others.map((i) => renderRow(i, false))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * SearchableDropdown — a bounded, type-to-filter "adder" dropdown.
 *
 * Client ask (Outlet 360): every "add / assign X to this outlet" control must be
 * a searchable dropdown with a FIXED max height and its own scroll, so a long
 * list (50+ brands, all employees) never blows out the page. Modeled on the
 * purchasing IngredientPicker (custom popover, no cmdk dep) but generalized to
 * plain `{ id, label, hint?, color? }` options and used as a one-shot adder:
 * picking an option fires `onSelect(id)` and resets — it holds no persistent
 * value of its own.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown, Plus, Search } from 'lucide-react'
import { cn } from '../lib/utils'

export interface SearchableOption {
  id: string
  /** Primary text — what the search query matches against. */
  label: string
  /** Secondary muted text (right-aligned), e.g. "currently: Cubao". Also searchable. */
  hint?: string
  /** Optional leading swatch color (brand color). */
  color?: string | null
  disabled?: boolean
}

interface SearchableDropdownProps {
  options: SearchableOption[]
  onSelect: (id: string) => void
  /** Trigger button label (adder style, e.g. "Deploy a brand…"). */
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  /** Shows a spinner-ish disabled state while a mutation is in flight. */
  busy?: boolean
  /** Fixed max height (px) of the SCROLLABLE list region. Default 280. */
  maxHeight?: number
  className?: string
}

export default function SearchableDropdown({
  options,
  onSelect,
  placeholder = 'Add…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  disabled = false,
  busy = false,
  maxHeight = 280,
  className,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click / Escape (same idiom as IngredientPicker).
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.hint ? o.hint.toLowerCase().includes(q) : false),
    )
  }, [options, query])

  function pick(id: string) {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  const isDisabled = disabled || busy

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 text-sm text-zinc-300 transition-colors duration-150',
          'hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          <Plus className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
          <span className="truncate">{busy ? 'Working…' : placeholder}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          <div className="relative border-b border-border p-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-full rounded-md border border-border bg-background/60 pl-8 pr-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight }}>
            {visible.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-zinc-500">{emptyText}</p>
            ) : (
              visible.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => pick(o.id)}
                  title={o.hint ? `${o.label} - ${o.hint}` : o.label}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 transition-colors duration-150',
                    'hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                >
                  {o.color !== undefined && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
                      style={{ backgroundColor: o.color ?? '#71717A' }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="max-w-[45%] shrink truncate text-right text-[11px] text-zinc-500">
                      {o.hint}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

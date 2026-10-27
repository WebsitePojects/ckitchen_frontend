import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

export interface BrandListItem {
  id: string
  name: string
  color: string | null
  menuItemCount?: number
}

/**
 * Searchable brand list for the Menu page (laptop and up). Shows each brand's item count so
 * brands still waiting for their menu stand out while a business is being set up.
 */
export default function BrandList({
  brands,
  selectedId,
  onSelect,
}: {
  brands: BrandListItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? brands.filter((b) => b.name.toLowerCase().includes(q)) : brands
  }, [brands, query])

  return (
    <nav aria-label="Brands" className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${brands.length} brands`}
          aria-label="Search brands"
          className="pl-9"
        />
      </div>
      <ul className="flex max-h-[calc(100dvh-16rem)] flex-col overflow-y-auto">
        {visible.map((b) => {
          const active = b.id === selectedId
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onSelect(b.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-ws-small transition-colors',
                  active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color ?? '#71717A' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {b.menuItemCount !== undefined && (
                  <span className={cn('tabular-nums text-ws-micro', b.menuItemCount === 0 ? 'text-warn-text' : 'text-muted-foreground')}>
                    {b.menuItemCount === 0 ? 'No items' : b.menuItemCount}
                  </span>
                )}
              </button>
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-3 py-2 text-ws-small text-muted-foreground">No brand matches “{query}”.</li>}
      </ul>
    </nav>
  )
}

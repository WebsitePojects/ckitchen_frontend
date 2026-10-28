import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Tags, CheckCircle2, TrendingDown, TrendingUp, GitCompareArrows, ChevronRight } from 'lucide-react'
import { get } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
import { outletScopedPath } from '../lib/outletScope'
import { readableTextOn } from '../lib/theme'
import { cn } from '../lib/utils'
import { MOMENTUM_LABEL, verdictClass, formatPct, formatPeso, useBrandPerformance, type BrandPerformance } from '../lib/brandPerformance'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Button } from '../components/ui/button'

interface Brand {
  id: string
  name: string
  color: string
  logoUrl?: string | null
  salesPerfId?: string | null
  isActive: boolean
}

/** Period the cards summarise; the detail page offers 3 / 6 / 12. */
const CARD_MONTHS = 6
const MAX_COMPARE = 6

export default function Brands() {
  const { selectedOutletId } = useOutlet()
  const navigate = useNavigate()

  // Cache-first: a revisit paints the last list instantly. Keyed by outlet (outlet-cache rule).
  const {
    data: brands = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>(outletScopedPath('/brands', selectedOutletId))).data,
  })
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load brands') : null

  // One request for every card's verdict (D59). If this role cannot see money, the cards
  // still list brands; they just leave the figures out.
  const performance = useBrandPerformance({ months: CARD_MONTHS, outletId: selectedOutletId })
  const perfById = useMemo(() => new Map((performance.data?.brands ?? []).map((b) => [b.brand.id, b])), [performance.data])

  const [compare, setCompare] = useState<string[]>([])
  function toggleCompare(id: string) {
    setCompare((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_COMPARE ? ids : [...ids, id]))
  }

  const active = useMemo(() => brands.filter((b) => b.isActive).length, [brands])
  const counts = useMemo(() => {
    const list = performance.data?.brands ?? []
    return {
      profitable: list.filter((b) => b.verdict.status === 'PROFITABLE').length,
      losing: list.filter((b) => b.verdict.status === 'LOSING').length,
      growing: list.filter((b) => b.verdict.momentum === 'GROWING').length,
    }
  }, [performance.data])
  const hasPerf = !!performance.data

  return (
    <PageContainer>
      <PageHeader
        title="Brands"
        subtitle={`Every food brand, judged on the last ${CARD_MONTHS} months`}
        actions={
          <Button
            size="sm"
            variant={compare.length >= 2 ? 'default' : 'outline'}
            className="gap-1.5"
            disabled={compare.length < 2}
            onClick={() => navigate(`/brands/compare?ids=${compare.join(',')}`)}
          >
            <GitCompareArrows className="h-4 w-4" />
            {compare.length >= 2 ? `Compare ${compare.length}` : 'Select 2+ to compare'}
          </Button>
        }
      />

      <KpiRibbon loading={loading}>
        <KpiCard icon={Tags} label="Brands" value={`${active} active / ${brands.length}`} />
        <KpiCard icon={CheckCircle2} label="Profitable" value={hasPerf ? counts.profitable : '—'} loading={loading || performance.isPending} />
        <KpiCard icon={TrendingDown} label="Losing money" value={hasPerf ? counts.losing : '—'} loading={loading || performance.isPending} />
        <KpiCard icon={TrendingUp} label="Growing" value={hasPerf ? counts.growing : '—'} loading={loading || performance.isPending} />
      </KpiRibbon>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading brands…</p>
      ) : error ? (
        <p className="text-sm text-danger-text">{error}</p>
      ) : brands.length === 0 ? (
        <EmptyState icon={Tags} title="No brands" description="Add a brand from Merchant Management." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {brands.map((b) => (
            <BrandCard
              key={b.id}
              brand={b}
              perf={perfById.get(b.id)}
              perfLoading={performance.isPending}
              selected={compare.includes(b.id)}
              selectDisabled={!compare.includes(b.id) && compare.length >= MAX_COMPARE}
              onToggleCompare={() => toggleCompare(b.id)}
            />
          ))}
        </ul>
      )}
    </PageContainer>
  )
}

function BrandCard({
  brand,
  perf,
  perfLoading,
  selected,
  selectDisabled,
  onToggleCompare,
}: {
  brand: Brand
  perf: BrandPerformance | undefined
  perfLoading: boolean
  selected: boolean
  selectDisabled: boolean
  onToggleCompare: () => void
}) {
  return (
    <li
      className={cn(
        'group relative flex flex-col rounded-xl border bg-card p-5 transition-colors',
        selected ? 'border-foreground/40' : 'border-border hover:border-foreground/25',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          style={{ backgroundColor: brand.color, color: readableTextOn(brand.color) }}
          aria-hidden
        >
          {brand.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          {/* The whole card is the link (stretched ::after); the compare box sits above it. */}
          <Link
            to={`/brands/${brand.id}`}
            className="block truncate font-semibold text-foreground after:absolute after:inset-0 after:rounded-xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {brand.name}
          </Link>
          <p className={cn('status text-xs', brand.isActive ? 'status-ok' : '')}>{brand.isActive ? 'Active' : 'Inactive'}</p>
        </div>
        <label className="relative z-10 flex h-8 w-8 cursor-pointer items-center justify-center" title="Select to compare">
          <input
            type="checkbox"
            checked={selected}
            disabled={selectDisabled}
            onChange={onToggleCompare}
            className="h-4 w-4 cursor-pointer accent-current disabled:cursor-not-allowed"
            aria-label={`Compare ${brand.name}`}
          />
        </label>
      </div>

      <div className="mt-4 flex-1">
        {perf ? (
          <>
            <p className={cn('status text-sm', verdictClass(perf.verdict))}>{perf.verdict.headline}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Net sales</dt>
                <dd className="font-medium tabular-nums text-foreground">{formatPeso(perf.totals.netSales, { compact: true })}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Contribution</dt>
                <dd className={cn('font-medium tabular-nums', perf.totals.contribution < 0 ? 'text-danger-text' : 'text-foreground')}>
                  {formatPeso(perf.totals.contribution, { compact: true })}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{formatPct(perf.contributionMargin)}</span>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">{MOMENTUM_LABEL[perf.verdict.momentum]}</p>
          </>
        ) : perfLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-secondary/60" aria-hidden />
        ) : (
          <p className="text-xs text-muted-foreground">Open for details</p>
        )}
      </div>

      <span className="mt-4 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        View performance <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </li>
  )
}

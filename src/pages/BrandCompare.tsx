import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronRight, GitCompareArrows, Trophy } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { normalizeRole, ROLE_LANDING } from '../auth/access'
import { usePermissions } from '../context/PermissionsContext'
import { useOutlet } from '../context/OutletContext'
import { CHART_CATEGORICAL, CHART_CHROME } from '../lib/theme'
import { cn } from '../lib/utils'
import {
  CONFIDENCE_LABEL,
  MOMENTUM_LABEL,
  verdictClass,
  formatPct,
  formatPeso,
  monthShort,
  useBrandPerformance,
  type BrandPerformance,
} from '../lib/brandPerformance'
import PageContainer from '../components/layout/PageContainer'
import EmptyState from '../components/common/EmptyState'
import { useInPageTitle } from '../components/layout/PageHeaderContext'
import { PeriodPicker } from './BrandPerformance'

/** More brands than this and the lines and columns stop being readable side by side. */
const MAX_COMPARE = 6

interface MetricRow {
  label: string
  value: (b: BrandPerformance) => number | null
  format: (n: number | null) => string
  /** Which end wins: 'high' (sales, margin) or 'low' (food cost, cancellations). */
  better: 'high' | 'low'
}

const METRICS: MetricRow[] = [
  { label: 'Net sales', value: (b) => b.totals.netSales, format: (n) => formatPeso(n), better: 'high' },
  { label: 'Contribution', value: (b) => b.totals.contribution, format: (n) => formatPeso(n), better: 'high' },
  { label: 'Contribution margin', value: (b) => b.contributionMargin, format: formatPct, better: 'high' },
  { label: 'Food cost share', value: (b) => b.foodCostShare, format: formatPct, better: 'low' },
  { label: 'Platform fee share', value: (b) => b.channelFeeShare, format: formatPct, better: 'low' },
  { label: 'Orders', value: (b) => b.totals.orders, format: (n) => (n == null ? '—' : n.toLocaleString()), better: 'high' },
  { label: 'Average order', value: (b) => b.averageOrderValue, format: (n) => formatPeso(n), better: 'high' },
  { label: 'Cancellation rate', value: (b) => b.cancellationRate, format: formatPct, better: 'low' },
  { label: 'Sales trend / month', value: (b) => (b.trend.historyMonths >= 3 ? b.trend.salesSlope : null), format: (n) => (n == null ? '—' : Math.abs(n) < 1 ? 'flat' : `${n > 0 ? '+' : '−'}${formatPeso(Math.abs(n))}`), better: 'high' },
  { label: 'Next month contribution', value: (b) => b.projection.nextMonth?.contribution ?? null, format: (n) => formatPeso(n), better: 'high' },
]

/**
 * Side-by-side brand comparison (D59). Brand selection lives in the URL (?ids=a,b) so a
 * comparison can be bookmarked or sent to a partner.
 */
export default function BrandCompare() {
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  const { selectedOutletId } = useOutlet()
  const [params, setParams] = useSearchParams()
  const [months, setMonths] = useState(6)
  const allowed = !!user && canAccessPage('/brands')
  useInPageTitle()

  // The whole portfolio once (it also lists the brands to pick from); comparing is a filter.
  const report = useBrandPerformance({ months, outletId: selectedOutletId, enabled: allowed })
  const all = report.data?.brands ?? []
  const selectedIds = useMemo(() => (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARE), [params])
  const selected = useMemo(() => {
    const byId = new Map(all.map((b) => [b.brand.id, b]))
    return selectedIds.map((id) => byId.get(id)).filter((b): b is BrandPerformance => !!b)
  }, [all, selectedIds])

  function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id].slice(0, MAX_COMPARE)
    setParams(next.length ? { ids: next.join(',') } : {}, { replace: true })
  }

  if (!user) return null
  if (!allowed) return <Navigate to={ROLE_LANDING[normalizeRole(user.role)] ?? '/'} replace />

  const colorOf = (b: BrandPerformance, i: number) => b.brand.color || CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]!

  return (
    <PageContainer>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link to="/brands" className="text-muted-foreground transition-colors hover:text-foreground">
          Brands
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">Compare</span>
      </nav>

      <header className="rule-double flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <p className="eyebrow mb-1">Brand performance</p>
          <h1 className="display-title">Compare brands</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pick up to {MAX_COMPARE} brands. The best value in each row is marked.</p>
        </div>
        <PeriodPicker value={months} onChange={setMonths} />
      </header>

      {report.isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-secondary/60" aria-busy="true" aria-label="Loading brands" />
      ) : report.isError ? (
        <p className="text-sm text-danger-text">{report.error instanceof Error ? report.error.message : 'Could not load brands.'}</p>
      ) : (
        <>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Brands to compare</legend>
            {all.map((b) => {
              const on = selectedIds.includes(b.brand.id)
              const full = !on && selectedIds.length >= MAX_COMPARE
              return (
                <button
                  key={b.brand.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggle(b.brand.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.brand.color }} aria-hidden />
                  {b.brand.name}
                </button>
              )
            })}
          </fieldset>

          {selected.length < 2 ? (
            <EmptyState icon={GitCompareArrows} title="Pick at least two brands" description="Tap brands above to put them side by side." />
          ) : (
            <>
              <Ranking brands={selected} />
              <section className="ledger-section" aria-labelledby="compare-table-title">
                <h2 id="compare-table-title" className="mb-2 text-ws-section font-semibold text-foreground">
                  Side by side
                </h2>
                <div className="overflow-x-auto" tabIndex={0} aria-label="Brand comparison table">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 pr-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Metric</th>
                        {selected.map((b) => (
                          <th key={b.brand.id} className="py-2 pr-3 text-right font-semibold text-foreground">
                            <Link to={`/brands/${b.brand.id}`} className="hover:underline">
                              {b.brand.name}
                            </Link>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border">
                        <td className="py-2 pr-3 text-muted-foreground">Verdict</td>
                        {selected.map((b) => (
                          <td key={b.brand.id} className="py-2 pr-3 text-right">
                            <span className={cn('status justify-end text-xs', verdictClass(b.verdict))}>{b.verdict.headline}</span>
                          </td>
                        ))}
                      </tr>
                      {METRICS.map((metric) => {
                        const values = selected.map(metric.value)
                        const present = values.filter((v): v is number => v != null)
                        const best = present.length > 1 ? (metric.better === 'high' ? Math.max(...present) : Math.min(...present)) : null
                        return (
                          <tr key={metric.label} className="border-b border-border last:border-b-0">
                            <td className="py-2 pr-3 text-muted-foreground">{metric.label}</td>
                            {values.map((v, i) => {
                              const isBest = best != null && v === best
                              return (
                                <td key={selected[i]!.brand.id} className={cn('py-2 pr-3 text-right tabular-nums text-foreground', isBest && 'font-semibold')}>
                                  {metric.format(v)}
                                  {isBest && <span className="sr-only"> (best)</span>}
                                  {isBest && <Trophy className="ml-1 inline h-3 w-3 -translate-y-px text-ink-accent" aria-hidden />}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                      <tr>
                        <td className="py-2 pr-3 text-muted-foreground">Momentum</td>
                        {selected.map((b) => (
                          <td key={b.brand.id} className="py-2 pr-3 text-right text-foreground">
                            {MOMENTUM_LABEL[b.verdict.momentum]}
                            <span className="block text-[11px] text-muted-foreground">{CONFIDENCE_LABEL[b.trend.confidence]}</span>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="ledger-section space-y-3" aria-labelledby="compare-chart-title">
                <h2 id="compare-chart-title" className="text-ws-section font-semibold text-foreground">
                  Contribution by month
                </h2>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={report.data!.months.map((month, i) => ({
                        month: monthShort(month),
                        ...Object.fromEntries(selected.map((b) => [b.brand.name, b.series[i]?.contribution ?? 0])),
                      }))}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid stroke={CHART_CHROME.grid} strokeOpacity={0.6} vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => formatPeso(v, { compact: true })} tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
                      <Tooltip contentStyle={CHART_CHROME.tooltip} formatter={(value, name) => [formatPeso(Number(value)), String(name)]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {selected.map((b, i) => (
                        <Line key={b.brand.id} dataKey={b.brand.name} stroke={colorOf(b, i)} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground">The last point is the month in progress. {report.data!.assumptions.excludes}</p>
              </section>
            </>
          )}
        </>
      )}
    </PageContainer>
  )
}

function Ranking({ brands }: { brands: BrandPerformance[] }) {
  const ranked = [...brands].sort((a, b) => b.totals.contribution - a.totals.contribution)
  const top = ranked[0]!
  const bottom = ranked[ranked.length - 1]!
  return (
    <section aria-label="Summary" className="figures">
      <div>
        <p className="eyebrow">Earns the most</p>
        <p className="mt-1 text-lg font-semibold text-foreground">{top.brand.name}</p>
        <p className="text-xs text-muted-foreground">{formatPeso(top.totals.contribution)} contribution</p>
      </div>
      <div>
        <p className="eyebrow">Earns the least</p>
        <p className={cn('mt-1 text-lg font-semibold', bottom.totals.contribution < 0 ? 'text-danger-text' : 'text-foreground')}>{bottom.brand.name}</p>
        <p className="text-xs text-muted-foreground">{formatPeso(bottom.totals.contribution)} contribution</p>
      </div>
      <div>
        <p className="eyebrow">Losing money</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{brands.filter((b) => b.verdict.status === 'LOSING').length}</p>
        <p className="text-xs text-muted-foreground">of {brands.length} compared</p>
      </div>
      <div>
        <p className="eyebrow">Growing</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{brands.filter((b) => b.verdict.momentum === 'GROWING').length}</p>
        <p className="text-xs text-muted-foreground">of {brands.length} compared</p>
      </div>
    </section>
  )
}

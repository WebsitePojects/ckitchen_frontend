import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, ChevronRight, GitCompareArrows, History, Info, XCircle } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { normalizeRole, ROLE_LANDING } from '../auth/access'
import { usePermissions } from '../context/PermissionsContext'
import { useOutlet } from '../context/OutletContext'
import { readableTextOn, CHART_CHROME } from '../lib/theme'
import { cn } from '../lib/utils'
import {
  CONFIDENCE_LABEL,
  MOMENTUM_LABEL,
  PERIOD_OPTIONS,
  verdictClass,
  formatPct,
  formatPeso,
  monthShort,
  useBrandPerformance,
  type BrandPerformance as BrandPerf,
} from '../lib/brandPerformance'
import PageContainer from '../components/layout/PageContainer'
import EmptyState from '../components/common/EmptyState'
import { useInPageTitle } from '../components/layout/PageHeaderContext'
import { Button } from '../components/ui/button'

/**
 * One brand's performance (D59): is it profitable, is it growing, and what next month looks
 * like on the current trend. Replaces the old "activity log" modal as what a brand card
 * opens; the brand's activity is one click away, on the Activity Log page's Brands tab.
 */
export default function BrandPerformance() {
  const { id = '' } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  const { selectedOutletId } = useOutlet()
  const navigate = useNavigate()
  const [months, setMonths] = useState<number>(6)

  // Registered outside <RequireAccess> (the guard matches raw '/brands/<uuid>'), so it
  // inherits the Brands page permission itself, like EmployeeProfile does for '/employees'.
  const allowed = !!user && canAccessPage('/brands')
  // The whole portfolio, not just this brand: "share of all brands" needs the others, and it
  // is the same cached report the Brands list already loaded.
  const report = useBrandPerformance({ months, outletId: selectedOutletId, enabled: allowed && !!id })
  useInPageTitle()
  const perf = report.data?.brands.find((b) => b.brand.id === id) ?? null

  if (!user) return null
  if (!allowed) return <Navigate to={ROLE_LANDING[normalizeRole(user.role)] ?? '/'} replace />

  return (
    <PageContainer>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link to="/brands" className="text-muted-foreground transition-colors hover:text-foreground">
          Brands
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">{perf?.brand.name ?? 'Performance'}</span>
      </nav>

      {report.isPending ? (
        <PerformanceSkeleton />
      ) : report.isError ? (
        <p className="text-sm text-danger-text">{report.error instanceof Error ? report.error.message : 'Could not load performance.'}</p>
      ) : !perf ? (
        <EmptyState icon={Info} title="Brand not found" description="It may be outside your brands or outlets." />
      ) : (
        <>
          <header className="rule-double flex flex-wrap items-end justify-between gap-4 pb-5">
            <div className="flex min-w-0 items-center gap-4">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold"
                style={{ backgroundColor: perf.brand.color, color: readableTextOn(perf.brand.color) }}
                aria-hidden
              >
                {perf.brand.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="eyebrow mb-1">Brand performance</p>
                <h1 className="display-title truncate">{perf.brand.name}</h1>
                <p className={cn('status mt-1', verdictClass(perf.verdict))}>{perf.verdict.headline}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PeriodPicker value={months} onChange={setMonths} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/brands/compare?ids=${perf.brand.id}`)}>
                <GitCompareArrows className="h-3.5 w-3.5" /> Compare
              </Button>
              {canAccessPage('/audit') && (
                <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                  <Link to={`/audit?tab=brands&brand=${perf.brand.id}`}>
                    <History className="h-3.5 w-3.5" /> Activity log
                  </Link>
                </Button>
              )}
            </div>
          </header>

          {/* While another period loads, the last one stays visible but dimmed. */}
          <div
            className={cn('flex flex-col gap-6 transition-opacity duration-200', report.isPlaceholderData && 'pointer-events-none opacity-50')}
            aria-busy={report.isPlaceholderData}
          >
            <BrandFigures perf={perf} currentMonth={report.data!.currentMonth} />
            <TrendChart perf={perf} />
            <Signals perf={perf} />
            <MonthlyTable perf={perf} currentMonth={report.data!.currentMonth.month} />
            <TopProducts perf={perf} />

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Contribution = net sales − food cost − platform commission and marketing. {report.data!.assumptions.excludes} Projection is a
              straight-line trend over completed months (needs {report.data!.assumptions.minHistoryMonths}); the range is ± one month of typical
              variation.
            </p>
          </div>
        </>
      )}
    </PageContainer>
  )
}

export function PeriodPicker({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-border p-0.5">
      {PERIOD_OPTIONS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m} mo
        </button>
      ))}
    </div>
  )
}

function BrandFigures({ perf, currentMonth }: { perf: BrandPerf; currentMonth: { month: string; daysElapsed: number; daysInMonth: number } }) {
  const next = perf.projection.nextMonth
  const run = perf.projection.currentMonth
  const figures = [
    { label: 'Net sales', value: formatPeso(perf.totals.netSales), note: perf.shareOfSales != null ? `${formatPct(perf.shareOfSales)} of all brands` : '' },
    {
      label: 'Contribution',
      value: formatPeso(perf.totals.contribution),
      note: `${formatPct(perf.contributionMargin)} margin`,
      tone: perf.totals.contribution < 0 ? 'text-danger-text' : undefined,
    },
    { label: 'Orders', value: perf.totals.orders.toLocaleString(), note: `${formatPeso(perf.averageOrderValue)} average` },
    next
      ? {
          label: 'Next month (projected)',
          value: formatPeso(next.contribution),
          note: `${formatPeso(next.contributionLow)} to ${formatPeso(next.contributionHigh)} · ${CONFIDENCE_LABEL[perf.trend.confidence]}`,
          tone: next.contribution < 0 ? 'text-danger-text' : undefined,
        }
      : run
        ? {
            label: `${monthShort(currentMonth.month)} run-rate`,
            value: formatPeso(run.contribution),
            note: `day ${currentMonth.daysElapsed} of ${currentMonth.daysInMonth}`,
          }
        : { label: 'Next month (projected)', value: '—', note: CONFIDENCE_LABEL.NONE },
  ]
  return (
    <section aria-label="Key figures" className="figures">
      {figures.map((f) => (
        <div key={f.label}>
          <p className="eyebrow">{f.label}</p>
          <p className={cn('mt-1 text-ws-figure font-semibold tabular-nums text-foreground', f.tone)}>{f.value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{f.note}</p>
        </div>
      ))}
    </section>
  )
}

function TrendChart({ perf }: { perf: BrandPerf }) {
  const data = useMemo(() => {
    const rows = perf.series.map((m) => ({ month: monthShort(m.month), netSales: m.netSales, contribution: m.contribution, projected: null as number | null }))
    if (perf.projection.nextMonth) {
      const last = perf.series[perf.series.length - 1]!.month
      const [y, mo] = last.split('-').map(Number)
      const next = `${mo === 12 ? y! + 1 : y}-${String(mo === 12 ? 1 : mo! + 1).padStart(2, '0')}`
      rows.push({ month: `${monthShort(next)} (proj.)`, netSales: 0, contribution: 0, projected: perf.projection.nextMonth.contribution })
    }
    return rows
  }, [perf])

  const slope = perf.trend.salesSlope
  return (
    <section className="ledger-section space-y-3" aria-labelledby="trend-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trend-title" className="text-ws-section font-semibold text-foreground">
          Sales and contribution by month
        </h2>
        <p className="text-sm text-muted-foreground">
          {MOMENTUM_LABEL[perf.verdict.momentum]}
          {perf.trend.historyMonths >= 3 && ` · ${slope >= 0 ? '+' : '−'}${formatPeso(Math.abs(slope))} sales a month`}
        </p>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_CHROME.grid} strokeOpacity={0.6} vertical={false} />
            <XAxis dataKey="month" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => formatPeso(v, { compact: true })} tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              contentStyle={CHART_CHROME.tooltip}
              cursor={{ fill: CHART_CHROME.cursor }}
              formatter={(value, name) => [formatPeso(Number(value)), String(name)]}
            />
            <Bar dataKey="netSales" name="Net sales" fill={perf.brand.color} fillOpacity={0.35} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="projected" name="Projected contribution" fill="hsl(var(--muted-foreground))" fillOpacity={0.25} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line dataKey="contribution" name="Contribution" stroke="hsl(var(--ink-accent))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

const SIGNAL_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle } as const
const SIGNAL_TONE = { good: 'text-ink-accent', warn: 'text-warn-text', bad: 'text-danger-text' } as const

function Signals({ perf }: { perf: BrandPerf }) {
  if (perf.verdict.signals.length === 0) return null
  return (
    <section className="ledger-section" aria-labelledby="signals-title">
      <h2 id="signals-title" className="mb-2 text-ws-section font-semibold text-foreground">
        What stands out
      </h2>
      <ul className="divide-y divide-border">
        {perf.verdict.signals.map((s) => {
          const Icon = SIGNAL_ICON[s.tone]
          return (
            <li key={s.text} className="flex items-start gap-2.5 py-2.5 text-sm text-foreground">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', SIGNAL_TONE[s.tone])} aria-label={s.tone === 'good' ? 'Good' : s.tone === 'warn' ? 'Watch' : 'Problem'} />
              {s.text}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MonthlyTable({ perf, currentMonth }: { perf: BrandPerf; currentMonth: string }) {
  const rows = [...perf.series].reverse()
  return (
    <section className="ledger-section" aria-labelledby="monthly-title">
      <h2 id="monthly-title" className="mb-2 text-ws-section font-semibold text-foreground">
        Monthly P&amp;L
      </h2>
      <div className="overflow-x-auto max-sm:overflow-visible" tabIndex={0} aria-label="Monthly profit and loss">
        <table className="w-full text-sm max-sm:block">
          <thead className="max-sm:sr-only">
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Month</th>
              <th className="py-2 pr-3 text-right font-medium">Net sales</th>
              <th className="py-2 pr-3 text-right font-medium">Food cost</th>
              <th className="py-2 pr-3 text-right font-medium">Platform fees</th>
              <th className="py-2 pr-3 text-right font-medium">Contribution</th>
              <th className="py-2 pr-3 text-right font-medium">Margin</th>
              <th className="py-2 pr-3 text-right font-medium">Orders</th>
              <th className="py-2 text-right font-medium">Cancelled</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.map((m) => {
              const margin = m.netSales > 0 ? m.contribution / m.netSales : null
              const cells: Array<[string, string, string?]> = [
                ['Net sales', formatPeso(m.netSales)],
                ['Food cost', formatPeso(m.foodCost)],
                ['Platform fees', formatPeso(m.channelFees)],
                ['Contribution', formatPeso(m.contribution), m.contribution < 0 ? 'text-danger-text' : 'font-medium'],
                ['Margin', formatPct(margin)],
                ['Orders', m.orders.toLocaleString()],
                ['Cancelled', m.cancelledOrders.toLocaleString()],
              ]
              return (
                <tr key={m.month} className="border-b border-border last:border-b-0 max-sm:block max-sm:py-2">
                  <td className="py-2 pr-3 text-foreground max-sm:block max-sm:text-base max-sm:font-medium">
                    {monthShort(m.month)}
                    {m.month === currentMonth && <span className="ml-2 text-xs text-muted-foreground">in progress</span>}
                  </td>
                  {cells.map(([label, value, tone]) => (
                    <td
                      key={label}
                      data-label={label}
                      className={cn(
                        'py-2 pr-3 text-right tabular-nums text-foreground max-sm:flex max-sm:justify-between max-sm:py-0.5 max-sm:pr-0 max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]',
                        tone,
                      )}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TopProducts({ perf }: { perf: BrandPerf }) {
  if (perf.topProducts.length === 0) return null
  return (
    <section className="ledger-section" aria-labelledby="products-title">
      <h2 id="products-title" className="mb-2 text-ws-section font-semibold text-foreground">
        Best sellers
      </h2>
      <ul className="divide-y divide-border">
        {perf.topProducts.map((p) => {
          const margin = p.netSales > 0 ? (p.netSales - p.foodCost) / p.netSales : null
          return (
            <li key={p.menuItemId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
              <span className="font-medium text-foreground">{p.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {p.qty.toLocaleString()} sold · {formatPeso(p.netSales)} · {formatPct(margin)} after food cost
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading performance">
      <div className="h-16 animate-pulse rounded-lg bg-secondary/60" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-secondary/60" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-secondary/60" />
    </div>
  )
}

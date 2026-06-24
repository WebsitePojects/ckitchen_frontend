/**
 * Analytics — FR-AN-01..05  (Reskin: M8 Sales & Performance — dark)
 *
 * FR-AN-01  Per-brand revenue + order volume for a selectable date range
 * FR-AN-02  Brand ranking top→weak; weakest brand flagged "Scale or Cut"
 * FR-AN-03  Orders-by-hour peak-load chart (single-date picker)
 * FR-AN-04  Aggregator split: foodpanda / GrabFood
 * FR-AN-05  Brand-specific margin using shared-ingredient recipe costing
 *
 * API endpoints (CK1-API-003 §9) — NOTE: all fields are snake_case:
 *   GET /analytics/brands?from&to        → { brand_id, name, revenue, order_count, avg_order_value, is_weakest }
 *   GET /analytics/orders-by-hour?date   → { hour (0-23), order_count }
 *   GET /analytics/aggregators?from&to   → { aggregator, order_count, revenue }
 *   GET /analytics/margins?from&to       → { brand_id, name, revenue, recipe_cost_total, margin }
 *
 * Chart library: recharts (already installed) — dark-styled.
 * All numeric renders: (v ?? 0).toLocaleString() — no raw .toLocaleString() on unknown.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  DollarSign,
  ReceiptText,
  Star,
  TrendingUp,
} from 'lucide-react'
import { get } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { AGGREGATOR_COLOR, AGGREGATOR_LABEL, CHART_PALETTE } from '../lib/theme'

// ─── API response types (snake_case — as the backend sends them) ───────────────

interface ApiBrandPerf {
  brand_id: string
  name: string
  revenue: number | null | undefined
  order_count: number | null | undefined
  avg_order_value: number | null | undefined
  is_weakest: boolean
}

interface ApiHourBucket {
  hour: number
  order_count: number | null | undefined
}

interface ApiAggregatorSplit {
  aggregator: string
  order_count: number | null | undefined
  revenue: number | null | undefined
}

interface ApiMargin {
  brand_id: string
  name: string
  revenue: number | null | undefined
  recipe_cost_total: number | null | undefined
  margin: number | null | undefined
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function defaultRange() {
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from: isoDate(from), to: isoDate(to) }
}

// ─── Currency formatter ────────────────────────────────────────────────────────

function fmtPHP(v: number | null | undefined): string {
  const n = v ?? 0
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtNum(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString()
}

function fmtPct(v: number | null | undefined): string {
  return `${(v ?? 0).toFixed(1)}%`
}

// ─── Chart shared styles ───────────────────────────────────────────────────────

const CHART_GRID   = '#27332C'
const CHART_TICK   = '#71717A'
const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#121A17',
  border: '1px solid #27332C',
  borderRadius: 8,
  fontSize: 12,
  color: '#F4F4F5',
}
const CURSOR_FILL  = 'rgba(16,185,129,0.06)'

// ─── Hour label helper ─────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  if (h === 0)  return '12am'
  if (h < 12)   return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

// ─── Date-range presets ────────────────────────────────────────────────────────

type RangePreset = '7d' | '30d' | '90d'

function presetRange(p: RangePreset): { from: string; to: string } {
  const to   = new Date()
  const from = new Date()
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  from.setDate(from.getDate() - days)
  return { from: isoDate(from), to: isoDate(to) }
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  )
}

// ─── Section: KPI Ribbon ──────────────────────────────────────────────────────

interface KpiData {
  totalRevenue:   number
  totalOrders:    number
  avgOrderValue:  number
  topBrand:       string
}

function AnalyticsKpiRibbon({ data, loading }: { data: KpiData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[90px] rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <KpiRibbon className="grid-cols-2 sm:grid-cols-4 xl:grid-cols-4">
      <KpiCard
        icon={DollarSign}
        label="Total Revenue"
        value={fmtPHP(data?.totalRevenue)}
      />
      <KpiCard
        icon={ReceiptText}
        label="Total Orders"
        value={fmtNum(data?.totalOrders)}
      />
      <KpiCard
        icon={TrendingUp}
        label="Avg Order Value"
        value={fmtPHP(data?.avgOrderValue)}
      />
      <KpiCard
        icon={Star}
        label="Top Brand"
        value={data?.topBrand ?? '—'}
      />
    </KpiRibbon>
  )
}

// ─── Section: Per-Brand Performance (FR-AN-01, FR-AN-02) ─────────────────────

function BrandPerformanceSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<ApiBrandPerf[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    get<ApiBrandPerf[]>(`/analytics/brands?from=${from}&to=${to}`)
      .then(res => { if (!cancelled) setData(res.data ?? []) })
      .catch(e  => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load brand analytics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const weakest  = data.find(b => b.is_weakest)
  const topBrand = data[0]  // API returns ranked top→weak

  const chartData = data.map((b, i) => ({
    name:     b.name,
    revenue:  b.revenue ?? 0,
    color:    b.is_weakest ? '#EF4444' : CHART_PALETTE[i % CHART_PALETTE.length],
    isWeak:   b.is_weakest,
    brand_id: b.brand_id,
  }))

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-zinc-100">
              Per-Brand Performance
            </CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500">
              Revenue · Orders · Avg order value — ranked top to weak
            </p>
          </div>
          {weakest && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 ring-1 ring-inset ring-red-500/30">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Scale or Cut: {weakest.name}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <p className="py-4 text-center text-sm text-red-400">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No brand data yet"
            description="No data yet — run the simulator to generate orders"
          />
        ) : (
          <>
            {/* Revenue bar chart */}
            <div className="mb-6">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={v => `₱${((v as number) / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v) => [fmtPHP(Number(v)), 'Revenue']}
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: CURSOR_FILL }}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.brand_id} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Ranked table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2.5 text-left">#</th>
                    <th className="px-4 py-2.5 text-left">Brand</th>
                    <th className="px-4 py-2.5 text-right">Revenue</th>
                    <th className="px-4 py-2.5 text-right">Orders</th>
                    <th className="px-4 py-2.5 text-right">Avg Order</th>
                    <th className="px-4 py-2.5 text-center">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((b, idx) => (
                    <tr
                      key={b.brand_id}
                      className={[
                        'border-b border-border/50 last:border-0',
                        b.is_weakest ? 'bg-red-500/5' : '',
                      ].join(' ')}
                    >
                      <td className="px-4 py-2.5 font-bold tabular-nums text-zinc-600">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: chartData[idx]?.color ?? CHART_PALETTE[0] }}
                          />
                          <span className="font-medium text-zinc-200">{b.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                        {fmtPHP(b.revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                        {fmtNum(b.order_count)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                        {fmtPHP(b.avg_order_value)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {b.is_weakest ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-400 ring-1 ring-inset ring-red-500/30">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            Scale or Cut
                          </span>
                        ) : idx === 0 && topBrand ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                            <Star className="h-3 w-3" aria-hidden />
                            Top
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section: Orders by Hour (FR-AN-03) ───────────────────────────────────────

function OrdersByHourSection({ date }: { date: string }) {
  const [data, setData]       = useState<ApiHourBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    get<ApiHourBucket[]>(`/analytics/orders-by-hour?date=${date}`)
      .then(res => { if (!cancelled) setData(res.data ?? []) })
      .catch(e  => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load hourly data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  // Build a full 24-hour scaffold (sparse data from API)
  const chartData = Array.from({ length: 24 }, (_, h) => {
    const found = data.find(d => d.hour === h)
    return { hour: h, order_count: found?.order_count ?? 0 }
  })

  const peak = chartData.reduce(
    (acc, d) => ((d.order_count ?? 0) > (acc.order_count ?? 0) ? d : acc),
    chartData[0] ?? { hour: 0, order_count: 0 },
  )
  const hasPeak = (peak?.order_count ?? 0) > 0

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-zinc-100">
              Orders by Hour
            </CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500">
              Peak-load view — informs kitchen staffing
            </p>
          </div>
          {hasPeak && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/30">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Peak: {hourLabel(peak.hour)} ({fmtNum(peak.order_count)} orders)
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <p className="py-4 text-center text-sm text-red-400">{error}</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis
                dataKey="hour"
                tickFormatter={hourLabel}
                tick={{ fontSize: 10, fill: CHART_TICK }}
                tickLine={false}
                axisLine={{ stroke: CHART_GRID }}
                interval={1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: CHART_TICK }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                formatter={(v) => [fmtNum(Number(v)), 'Orders']}
                labelFormatter={(label) => hourLabel(Number(label))}
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: CURSOR_FILL }}
              />
              <Bar dataKey="order_count" radius={[4, 4, 0, 0]}>
                {chartData.map(entry => (
                  <Cell
                    key={entry.hour}
                    fill={
                      hasPeak && entry.hour === peak.hour
                        ? '#F59E0B'         // amber — peak hour highlighted
                        : CHART_PALETTE[0]  // emerald — normal hours
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section: Aggregator Split (FR-AN-04) ─────────────────────────────────────

function AggregatorSplitSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<ApiAggregatorSplit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    get<ApiAggregatorSplit[]>(`/analytics/aggregators?from=${from}&to=${to}`)
      .then(res => { if (!cancelled) setData(res.data ?? []) })
      .catch(e  => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load aggregator data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const totalOrders  = data.reduce((s, d) => s + (d.order_count ?? 0), 0)
  const totalRevenue = data.reduce((s, d) => s + (d.revenue   ?? 0), 0)

  const pieData = data.map(d => ({
    name:    AGGREGATOR_LABEL[d.aggregator as keyof typeof AGGREGATOR_LABEL] ?? d.aggregator,
    value:   d.order_count ?? 0,
    revenue: d.revenue ?? 0,
    color:   AGGREGATOR_COLOR[d.aggregator as keyof typeof AGGREGATOR_COLOR] ?? '#71717A',
    key:     d.aggregator,
  }))

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-zinc-100">
          Aggregator Split
        </CardTitle>
        <p className="text-xs text-zinc-500">Orders and revenue by delivery platform</p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <p className="py-4 text-center text-sm text-red-400">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No aggregator data yet"
            description="No data yet — run the simulator to generate orders"
          />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Donut chart */}
            <div className="flex-shrink-0 self-center">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {pieData.map(entry => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => {
                      const v = Number(value)
                      const pct = totalOrders > 0 ? ((v / totalOrders) * 100).toFixed(1) : '0'
                      return [`${fmtNum(v)} orders (${pct}%)`, String(name)]
                    }}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => (
                      <span style={{ fontSize: 12, color: '#A1A1AA' }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Summary table */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-zinc-500">
                    <th className="pb-2.5 text-left">Platform</th>
                    <th className="pb-2.5 text-right">Orders</th>
                    <th className="pb-2.5 text-right">Share</th>
                    <th className="pb-2.5 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(d => {
                    const orders = d.order_count ?? 0
                    const rev    = d.revenue ?? 0
                    const color  = AGGREGATOR_COLOR[d.aggregator as keyof typeof AGGREGATOR_COLOR] ?? '#71717A'
                    const label  = AGGREGATOR_LABEL[d.aggregator as keyof typeof AGGREGATOR_LABEL] ?? d.aggregator
                    return (
                      <tr key={d.aggregator} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-medium text-zinc-200">{label}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-zinc-300">
                          {fmtNum(orders)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-zinc-500">
                          {totalOrders > 0 ? fmtPct((orders / totalOrders) * 100) : '—'}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-zinc-300">
                          {fmtPHP(rev)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="font-semibold">
                    <td className="pt-2.5 text-zinc-200">Total</td>
                    <td className="pt-2.5 text-right tabular-nums text-zinc-200">{fmtNum(totalOrders)}</td>
                    <td className="pt-2.5 text-right text-zinc-500">100%</td>
                    <td className="pt-2.5 text-right tabular-nums text-zinc-200">{fmtPHP(totalRevenue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section: Brand Margins (FR-AN-05) ────────────────────────────────────────

function marginColor(marginPct: number): string {
  if (marginPct >= 20) return 'text-emerald-400'
  if (marginPct >= 0)  return 'text-amber-400'
  return 'text-red-400'
}

function BrandMarginsSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<ApiMargin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    get<ApiMargin[]>(`/analytics/margins?from=${from}&to=${to}`)
      .then(res => { if (!cancelled) setData(res.data ?? []) })
      .catch(e  => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load margin data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  // Sort by margin descending
  const sorted = [...data].sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))

  const chartData = sorted.map((b, i) => ({
    name:       b.name,
    revenue:    b.revenue ?? 0,
    cost:       b.recipe_cost_total ?? 0,
    margin:     b.margin ?? 0,
    marginPct:  (b.revenue ?? 0) > 0 ? ((b.margin ?? 0) / (b.revenue ?? 1)) * 100 : 0,
    color:      CHART_PALETTE[i % CHART_PALETTE.length],
    brand_id:   b.brand_id,
  }))

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-zinc-100">
          Brand Margins
        </CardTitle>
        <p className="text-xs text-zinc-500">
          Revenue minus shared-ingredient recipe cost per brand
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <p className="py-4 text-center text-sm text-red-400">{error}</p>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No margin data yet"
            description="No data yet — run the simulator to generate orders"
          />
        ) : (
          <>
            {/* Grouped bar chart */}
            <div className="mb-6">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={v => `₱${((v as number) / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v, name) => {
                      const labels: Record<string, string> = {
                        revenue: 'Revenue',
                        cost:    'Recipe Cost',
                        margin:  'Margin',
                      }
                      return [fmtPHP(Number(v)), labels[String(name)] ?? String(name)]
                    }}
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: CURSOR_FILL }}
                  />
                  <Legend
                    iconType="square"
                    iconSize={10}
                    formatter={(value) => {
                      const labels: Record<string, string> = {
                        revenue: 'Revenue',
                        cost:    'Recipe Cost',
                        margin:  'Margin',
                      }
                      return (
                        <span style={{ fontSize: 12, color: '#A1A1AA' }}>
                          {labels[value] ?? value}
                        </span>
                      )
                    }}
                  />
                  <Bar dataKey="revenue" name="revenue" fill="#14B8A6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cost"    name="cost"    fill="#EF4444" radius={[4, 4, 0, 0]} opacity={0.7} />
                  <Bar dataKey="margin"  name="margin"  fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Margin table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2.5 text-left">Brand</th>
                    <th className="px-4 py-2.5 text-right">Revenue</th>
                    <th className="px-4 py-2.5 text-right">Recipe Cost</th>
                    <th className="px-4 py-2.5 text-right">Margin</th>
                    <th className="px-4 py-2.5 text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((b) => (
                    <tr key={b.brand_id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: b.color }}
                          />
                          <span className="font-medium text-zinc-200">{b.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                        {fmtPHP(b.revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-400/80">
                        {fmtPHP(b.cost)}
                      </td>
                      <td className={['px-4 py-2.5 text-right tabular-nums font-semibold', marginColor(b.marginPct)].join(' ')}>
                        {fmtPHP(b.margin)}
                      </td>
                      <td className={['px-4 py-2.5 text-right tabular-nums', marginColor(b.marginPct)].join(' ')}>
                        {fmtPct(b.marginPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Analytics page ───────────────────────────────────────────────────────

export default function Analytics() {
  const defaults = defaultRange()

  const [preset, setPreset]         = useState<RangePreset>('30d')
  const [appliedFrom, setAppliedFrom] = useState(defaults.from)
  const [appliedTo,   setAppliedTo]   = useState(defaults.to)
  const [date,        setDate]        = useState(isoDate(new Date()))

  // Brand data is fetched here for the KPI ribbon (avoids a separate endpoint)
  const [brandsKpi,    setBrandsKpi]    = useState<ApiBrandPerf[]>([])
  const [kpiLoading,   setKpiLoading]   = useState(true)

  // Apply a preset range
  const applyPreset = useCallback((p: RangePreset) => {
    setPreset(p)
    const { from, to } = presetRange(p)
    setAppliedFrom(from)
    setAppliedTo(to)
  }, [])

  // Fetch brand data for KPI ribbon (re-runs when date range changes)
  useEffect(() => {
    let cancelled = false
    setKpiLoading(true)
    get<ApiBrandPerf[]>(`/analytics/brands?from=${appliedFrom}&to=${appliedTo}`)
      .then(res => { if (!cancelled) setBrandsKpi(res.data ?? []) })
      .catch(() => { if (!cancelled) setBrandsKpi([]) })
      .finally(() => { if (!cancelled) setKpiLoading(false) })
    return () => { cancelled = true }
  }, [appliedFrom, appliedTo])

  // Derived KPI values (null-guarded)
  const kpiData: KpiData | null = kpiLoading ? null : (() => {
    const totalRevenue  = brandsKpi.reduce((s, b) => s + (b.revenue     ?? 0), 0)
    const totalOrders   = brandsKpi.reduce((s, b) => s + (b.order_count ?? 0), 0)
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0
    const topBrand      = brandsKpi[0]?.name ?? '—'
    return { totalRevenue, totalOrders, avgOrderValue, topBrand }
  })()

  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">

      {/* ── Page header ── */}
      <PageHeader
        title="Sales & Performance"
        subtitle="Revenue · Brand ranking · Peak hours · Aggregator split · Margins"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Range preset */}
            <Select value={preset} onValueChange={v => applyPreset(v as RangePreset)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>

            {/* Hourly-view date */}
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
              <label className="sr-only" htmlFor="hourly-date">Hourly view date</label>
              <input
                id="hourly-date"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                max={isoDate(new Date())}
                className="bg-transparent text-xs text-zinc-300 focus:outline-none [color-scheme:dark]"
              />
            </div>
          </div>
        }
      />

      {/* ── KPI ribbon ── */}
      <AnalyticsKpiRibbon data={kpiData} loading={kpiLoading} />

      {/* ── Per-brand performance ── */}
      <BrandPerformanceSection from={appliedFrom} to={appliedTo} />

      {/* ── Orders by hour ── */}
      <OrdersByHourSection date={date} />

      {/* ── Aggregator split + Brand margins (side by side on wide screens) ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AggregatorSplitSection from={appliedFrom} to={appliedTo} />
        <BrandMarginsSection    from={appliedFrom} to={appliedTo} />
      </div>
    </div>
  )
}

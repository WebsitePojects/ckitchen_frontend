/**
 * Analytics — FR-AN-01..05
 *
 * FR-AN-01  Per-brand revenue + order volume for a selectable date range
 * FR-AN-02  Brand ranking top→weak; weakest brand flagged "scale or cut"
 * FR-AN-03  Orders-by-hour peak-load chart (single-date picker)
 * FR-AN-04  Aggregator split: FoodPanda / GrabFood / Other
 * FR-AN-05  Brand-specific margin using shared-ingredient recipe costing
 *
 * API endpoints (CK1-API-003 §9):
 *   GET /analytics/brands?from&to
 *   GET /analytics/orders-by-hour?date
 *   GET /analytics/aggregators?from&to
 *   GET /analytics/margins?from&to
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
import type { Formatter } from 'recharts/types/component/DefaultTooltipContent'
import { get } from '../lib/api'

// ─── API response types (CK1-API-003 §9) ─────────────────────────────────────

interface BrandPerf {
  brandId: string
  brandName: string
  revenue: number        // decimal from API, parsed to number
  orderCount: number
  avgOrderValue: number
  rank: number
}

interface HourBucket {
  hour: number           // 0–23
  orderCount: number
}

interface AggregatorSplit {
  aggregator: string     // "FOODPANDA" | "GRABFOOD" | "OTHER"
  orderCount: number
  revenue: number
}

interface BrandMargin {
  brandId: string
  brandName: string
  revenue: number
  recipeCost: number
  margin: number         // revenue − recipeCost
  marginPct: number      // margin / revenue * 100 (may be provided or derived)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(v)
}

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Default "from" = 30 days ago; "to" = today */
function defaultRange() {
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from: isoDate(from), to: isoDate(to) }
}

/** AGGREGATOR display name */
const AGG_LABEL: Record<string, string> = {
  FOODPANDA: 'FoodPanda',
  GRABFOOD:  'GrabFood',
  OTHER:     'Other',
}

const AGG_COLOR: Record<string, string> = {
  FOODPANDA: '#e91e8c',
  GRABFOOD:  '#00b14f',
  OTHER:     '#6366f1',
}

// Contrasting palette for brand charts
const BRAND_COLORS = [
  '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444',
  '#f97316', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6',
]

function brandColor(index: number): string {
  return BRAND_COLORS[index % BRAND_COLORS.length]
}

// ─── Recharts tooltip formatters (typed via Formatter cast) ──────────────────

/** Revenue formatter for BarChart tooltips */
const fmtRevTooltip: Formatter = (v) =>
  [fmtCurrency(Number(v ?? 0)), 'Revenue']

/** Order-count formatter for by-hour BarChart tooltip */
const fmtOrderCountTooltip: Formatter = (v) =>
  [Number(v ?? 0), 'Orders']

/** Margin components formatter (Revenue / Recipe Cost / Margin) */
const fmtMarginTooltip: Formatter = (v, name) => {
  const labels: Record<string, string> = {
    revenue:    'Revenue',
    recipeCost: 'Recipe Cost',
    margin:     'Margin',
  }
  return [fmtCurrency(Number(v ?? 0)), labels[String(name)] ?? String(name)]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="mr-3 h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
      <span className="text-sm">Loading…</span>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <p className="mt-1 text-xs text-red-400">
        Make sure the backend is running and you are logged in.
      </p>
    </div>
  )
}

function EmptyBox({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <p className="text-3xl mb-2" aria-hidden>📊</p>
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="mt-1 text-xs text-gray-400">
        Analytics surface after orders are ingested and processed.
      </p>
    </div>
  )
}

// ─── Section: Per-Brand Performance (FR-AN-01, FR-AN-02) ─────────────────────

function BrandPerformanceSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<BrandPerf[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await get<BrandPerf[]>(`/analytics/brands?from=${from}&to=${to}`)
        if (!cancelled) setData(res.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load brand analytics.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [from, to])

  // Weakest = last after rank sort (highest rank number = weakest)
  const sorted   = [...data].sort((a, b) => a.rank - b.rank)
  const weakest  = sorted.length > 0 ? sorted[sorted.length - 1] : undefined

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Per-Brand Performance</h2>
          <p className="text-xs text-gray-400 mt-0.5">Revenue · Orders · Avg Order Value — ranked top to weak</p>
        </div>
        {weakest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
            ⚠ Scale or Cut: {weakest.brandName}
          </span>
        )}
      </div>

      {loading ? <LoadingSpinner /> : error ? <ErrorBox message={error} /> : sorted.length === 0 ? (
        <EmptyBox label="No brand analytics yet" />
      ) : (
        <>
          {/* Bar chart: revenue by brand */}
          <div className="mb-6">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sorted} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="brandName"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  interval={0}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={v => `₱${(v as number / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={fmtRevTooltip}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {sorted.map((entry, idx) => (
                    <Cell
                      key={entry.brandId}
                      fill={entry.brandId === weakest?.brandId ? '#fca5a5' : brandColor(idx)}
                      stroke={entry.brandId === weakest?.brandId ? '#ef4444' : 'none'}
                      strokeWidth={entry.brandId === weakest?.brandId ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Ranking table */}
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left">Rank</th>
                  <th className="px-4 py-2.5 text-left">Brand</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">Orders</th>
                  <th className="px-4 py-2.5 text-right">Avg Order</th>
                  <th className="px-4 py-2.5 text-center">Signal</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b, idx) => {
                  const isWeakest = b.brandId === weakest?.brandId
                  return (
                    <tr
                      key={b.brandId}
                      className={[
                        'border-b border-gray-50 last:border-0',
                        isWeakest ? 'bg-red-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40',
                      ].join(' ')}
                    >
                      <td className="px-4 py-2.5 font-bold text-gray-400 tabular-nums">
                        #{b.rank}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: brandColor(idx) }}
                          />
                          <span className="font-medium text-gray-900">{b.brandName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {fmtCurrency(b.revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {b.orderCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {fmtCurrency(b.avgOrderValue)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isWeakest ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                            ⚠ Scale or Cut
                          </span>
                        ) : idx === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            Top
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Section: Orders by Hour (FR-AN-03) ──────────────────────────────────────

function OrdersByHourSection({ date }: { date: string }) {
  const [data, setData]       = useState<HourBucket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await get<HourBucket[]>(`/analytics/orders-by-hour?date=${date}`)
        if (!cancelled) setData(res.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load hourly data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [date])

  const peak = data.length > 0 ? data.reduce((a, b) => (b.orderCount > a.orderCount ? b : a)) : null

  // Build all 24 hours so chart is always full-width
  const chartData: HourBucket[] = Array.from({ length: 24 }, (_, h) => {
    const found = data.find(d => d.hour === h)
    return found ?? { hour: h, orderCount: 0 }
  })

  const hourLabel = (h: number) => {
    if (h === 0)  return '12am'
    if (h < 12)   return `${h}am`
    if (h === 12) return '12pm'
    return `${h - 12}pm`
  }

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Orders by Hour</h2>
          <p className="text-xs text-gray-400 mt-0.5">Peak-load view to inform kitchen staffing</p>
        </div>
        {peak && peak.orderCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
            Peak: {hourLabel(peak.hour)} ({peak.orderCount} orders)
          </span>
        )}
      </div>

      {loading ? <LoadingSpinner /> : error ? <ErrorBox message={error} /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="hour"
              tickFormatter={hourLabel}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              interval={1}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={fmtOrderCountTooltip}
              labelFormatter={(label) => hourLabel(Number(label))}
              contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }}
            />
            <Bar dataKey="orderCount" radius={[4, 4, 0, 0]}>
              {chartData.map(entry => (
                <Cell
                  key={entry.hour}
                  fill={
                    peak && entry.hour === peak.hour && peak.orderCount > 0
                      ? '#f59e0b'
                      : '#0ea5e9'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  )
}

// ─── Section: Aggregator Split (FR-AN-04) ────────────────────────────────────

function AggregatorSplitSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<AggregatorSplit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await get<AggregatorSplit[]>(`/analytics/aggregators?from=${from}&to=${to}`)
        if (!cancelled) setData(res.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load aggregator data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [from, to])

  const totalOrders  = data.reduce((s, d) => s + d.orderCount, 0)
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0)

  const pieData = data.map(d => ({
    name:    AGG_LABEL[d.aggregator] ?? d.aggregator,
    value:   d.orderCount,
    revenue: d.revenue,
    color:   AGG_COLOR[d.aggregator] ?? '#6b7280',
  }))

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Aggregator Split</h2>
        <p className="text-xs text-gray-400 mt-0.5">Orders and revenue by delivery platform</p>
      </div>

      {loading ? <LoadingSpinner /> : error ? <ErrorBox message={error} /> : data.length === 0 ? (
        <EmptyBox label="No aggregator data yet" />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Pie chart */}
          <div className="flex-shrink-0">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={76}
                  paddingAngle={3}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={((value, name) => {
                    const v = Number(value)
                    return [
                      `${v} orders (${totalOrders > 0 ? ((v / totalOrders) * 100).toFixed(1) : 0}%)`,
                      String(name),
                    ]
                  }) as Formatter}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={10}
                  formatter={(value) => <span style={{ fontSize: 12, color: '#374151' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Summary table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="pb-2 text-left">Platform</th>
                  <th className="pb-2 text-right">Orders</th>
                  <th className="pb-2 text-right">Share</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.aggregator} className="border-b border-gray-50 last:border-0">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: AGG_COLOR[d.aggregator] ?? '#6b7280' }}
                        />
                        <span className="font-medium text-gray-900">
                          {AGG_LABEL[d.aggregator] ?? d.aggregator}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-700">
                      {d.orderCount.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-500">
                      {totalOrders > 0 ? fmtPct((d.orderCount / totalOrders) * 100) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-700">
                      {fmtCurrency(d.revenue)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold text-gray-900">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right tabular-nums">{totalOrders.toLocaleString()}</td>
                  <td className="pt-2 text-right text-gray-400">100%</td>
                  <td className="pt-2 text-right tabular-nums">{fmtCurrency(totalRevenue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Section: Brand Margins (FR-AN-05) ───────────────────────────────────────

function BrandMarginsSection({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<BrandMargin[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await get<BrandMargin[]>(`/analytics/margins?from=${from}&to=${to}`)
        if (!cancelled) {
          // Derive marginPct if not supplied by the API
          const enriched = res.data.map(d => ({
            ...d,
            marginPct: d.marginPct ?? (d.revenue > 0 ? (d.margin / d.revenue) * 100 : 0),
          }))
          setData(enriched)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load margin data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [from, to])

  const sorted = [...data].sort((a, b) => b.margin - a.margin)

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Brand Margins</h2>
        <p className="text-xs text-gray-400 mt-0.5">Revenue minus shared-ingredient recipe cost per brand</p>
      </div>

      {loading ? <LoadingSpinner /> : error ? <ErrorBox message={error} /> : sorted.length === 0 ? (
        <EmptyBox label="No margin data yet" />
      ) : (
        <>
          <div className="mb-6">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sorted} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="brandName"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  interval={0}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={v => `₱${((v as number) / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={fmtMarginTooltip}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }}
                />
                <Legend
                  iconType="square"
                  iconSize={10}
                  formatter={(value) => {
                    const labels: Record<string, string> = {
                      revenue:    'Revenue',
                      recipeCost: 'Recipe Cost',
                      margin:     'Margin',
                    }
                    return <span style={{ fontSize: 12, color: '#374151' }}>{labels[value] ?? value}</span>
                  }}
                />
                <Bar dataKey="revenue"    name="revenue"    stackId="a" fill="#bfdbfe" radius={[0, 0, 0, 0]} />
                <Bar dataKey="recipeCost" name="recipeCost" stackId="b" fill="#fca5a5" radius={[0, 0, 0, 0]} />
                <Bar dataKey="margin"     name="margin"     stackId="c" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left">Brand</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">Recipe Cost</th>
                  <th className="px-4 py-2.5 text-right">Margin</th>
                  <th className="px-4 py-2.5 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b, idx) => (
                  <tr
                    key={b.brandId}
                    className={[
                      'border-b border-gray-50 last:border-0',
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40',
                    ].join(' ')}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: brandColor(idx) }}
                        />
                        <span className="font-medium text-gray-900">{b.brandName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtCurrency(b.revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{fmtCurrency(b.recipeCost)}</td>
                    <td className={[
                      'px-4 py-2.5 text-right tabular-nums font-semibold',
                      b.margin >= 0 ? 'text-emerald-700' : 'text-red-700',
                    ].join(' ')}>
                      {fmtCurrency(b.margin)}
                    </td>
                    <td className={[
                      'px-4 py-2.5 text-right tabular-nums',
                      b.marginPct >= 20 ? 'text-emerald-600' : b.marginPct >= 0 ? 'text-amber-600' : 'text-red-600',
                    ].join(' ')}>
                      {fmtPct(b.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Main Analytics page ──────────────────────────────────────────────────────

export default function Analytics() {
  const defaults = defaultRange()

  const [from, setFrom]   = useState(defaults.from)
  const [to, setTo]       = useState(defaults.to)
  const [date, setDate]   = useState(isoDate(new Date()))

  // Applied range — only update on explicit "Apply" to avoid spamming the API
  const [appliedFrom, setAppliedFrom] = useState(defaults.from)
  const [appliedTo,   setAppliedTo]   = useState(defaults.to)

  const applyRange = useCallback(() => {
    setAppliedFrom(from)
    setAppliedTo(to)
  }, [from, to])

  // Apply when Enter key pressed in date inputs
  function handleDateKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyRange()
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Analytics</h1>
            <p className="mt-0.5 text-xs text-gray-400">
              Per-brand ranking · Orders by hour · Aggregator split · Margins
            </p>
          </div>

          {/* Date-range controls */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">From</label>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                onKeyDown={handleDateKey}
                max={to}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">To</label>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                onKeyDown={handleDateKey}
                min={from}
                max={isoDate(new Date())}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              onClick={applyRange}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              Apply
            </button>

            <span className="mx-1 h-7 w-px self-end bg-gray-200 hidden sm:block" aria-hidden />

            {/* By-hour date picker */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Hourly view date
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                max={isoDate(new Date())}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* ── Sections ── */}
        <BrandPerformanceSection from={appliedFrom} to={appliedTo} />
        <OrdersByHourSection     date={date} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AggregatorSplitSection from={appliedFrom} to={appliedTo} />
          <BrandMarginsSection    from={appliedFrom} to={appliedTo} />
        </div>
      </div>
    </div>
  )
}

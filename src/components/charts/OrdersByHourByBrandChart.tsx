/**
 * OrdersByHourByBrandChart — "Orders Today" stacked by brand (MoM 2026-07-01 #9:
 * "the order by hour is good, but they want to see WHICH BRAND it is").
 *
 * Data comes from `buckets` — a dense 24-entry per-hour × per-brand array that
 * Dashboard.tsx derives from the orders it ALREADY loads. Two reasons this is
 * client-derived rather than a fetch to /analytics/orders-by-hour-by-brand:
 *   1. Tenancy: the analytics endpoints are NOT outlet-scoped, and they 403 for
 *      OUTLET_MANAGER — who also lands on the Dashboard. The Dashboard's own
 *      order list IS outlet-scoped (X-Outlet-Id), so deriving from it is both
 *      correct per-outlet and works for every Dashboard role.
 *   2. It updates LIVE with the realtime order feed (the orders it reads from
 *      are the socket-updated ones), instead of polling a summary endpoint.
 *
 * Legibility with many brands (a 50-brand outlet is the target): only the top
 * MAX_BRAND_SERIES brands by today's volume keep their identity; the remainder
 * folds into a neutral-gray "Other" segment (dataviz rule: a 9th series is
 * never a new hue). Series color follows the ENTITY: each brand's own
 * `brand.color` (data-driven, per ui-design-system.md), falling back to the
 * validated CHART_CATEGORICAL slot order for brands without a usable color.
 */
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import EmptyState from '../common/EmptyState'
import { CHART_CATEGORICAL } from '../../lib/theme'

// ─── Data shape (derived client-side by Dashboard.tsx) ────────────────────────

export interface HourBrandBucket {
  hour: number // 0..23
  brands: Array<{ brandId: string; brandName: string; count: number }>
}

// ─── Props ────────────────────────────────────────────────────────────────────

/** Structural subset of the Dashboard `Brand` type — avoids importing the page. */
interface BrandLike {
  id: string
  name: string
  color: string
}

interface Props {
  /** Brands list the Dashboard already loads — used for per-brand series colors. */
  brands: BrandLike[]
  /**
   * Dense (ideally 24-entry) per-hour × per-brand buckets, derived by
   * Dashboard.tsx from its already-loaded, outlet-scoped orders. No analytics
   * fetch (see file header for the tenancy + live-update reasons).
   */
  buckets: HourBrandBucket[]
}

// ─── Constants (match Dashboard.tsx / Analytics.tsx chart conventions) ────────

/** Max identified brand series before folding the tail into "Other". */
const MAX_BRAND_SERIES = 6

const OTHER_KEY = '__other'
const OTHER_COLOR = '#71717A' // zinc-500 — neutral residual, never a brand hue

const CHART_GRID = '#27272a'
const CHART_TICK = '#71717A'
/** Card surface (dark `--card: 158 18% 9%`) — 1px stroke = gap between segments. */
const SEGMENT_STROKE = '#131b18'
const CURSOR_FILL = 'rgba(16,185,129,0.06)'

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

// ─── Series derivation ────────────────────────────────────────────────────────

interface SeriesDef {
  key: string // brandId, or OTHER_KEY
  name: string
  color: string
}

type ChartRow = { hour: number } & Record<string, number>

function buildChart(
  buckets: HourBrandBucket[],
  brandColor: Map<string, string>,
): { rows: ChartRow[]; series: SeriesDef[]; total: number } {
  // Per-brand totals across the day (dense payload, but stay defensive)
  const totals = new Map<string, { name: string; total: number }>()
  for (const b of Array.isArray(buckets) ? buckets : []) {
    for (const e of b.brands ?? []) {
      const prev = totals.get(e.brandId)
      if (prev) prev.total += e.count ?? 0
      else totals.set(e.brandId, { name: e.brandName, total: e.count ?? 0 })
    }
  }

  // Rank active brands; top N keep identity, tail folds into "Other".
  const ranked = [...totals.entries()]
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
  const top = ranked.slice(0, MAX_BRAND_SERIES)
  const tailIds = new Set(ranked.slice(MAX_BRAND_SERIES).map(([id]) => id))

  // Colors follow the entity: brand.color when valid, else next validated
  // categorical slot (fixed order, never cycled past the array).
  let paletteIdx = 0
  const series: SeriesDef[] = top.map(([id, v]) => {
    const own = brandColor.get(id)
    const color = own && HEX_RE.test(own)
      ? own
      : CHART_CATEGORICAL[paletteIdx++ % CHART_CATEGORICAL.length]
    return { key: id, name: v.name, color }
  })
  if (tailIds.size > 0) {
    series.push({ key: OTHER_KEY, name: `Other (${tailIds.size})`, color: OTHER_COLOR })
  }

  // Dense 24-hour scaffold (so idle hours still render a slot on the axis).
  const rows: ChartRow[] = Array.from({ length: 24 }, (_, hour) => {
    const row: ChartRow = { hour }
    for (const s of series) row[s.key] = 0
    return row
  })
  let total = 0
  for (const b of Array.isArray(buckets) ? buckets : []) {
    const row = rows[b.hour]
    if (!row) continue
    for (const e of b.brands ?? []) {
      const count = e.count ?? 0
      total += count
      if (tailIds.has(e.brandId)) row[OTHER_KEY] = (row[OTHER_KEY] ?? 0) + count
      else if (e.brandId in row) row[e.brandId] += count
    }
  }

  return { rows, series, total }
}

// ─── Tooltip (per-brand counts for the hovered hour; zero rows hidden) ────────

interface TooltipEntry {
  dataKey?: string | number
  name?: string
  value?: number
  color?: string
}

function StackTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean
  label?: number | string
  payload?: TooltipEntry[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const nonZero = payload.filter(p => (p.value ?? 0) > 0)
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#F4F4F5' }}
    >
      <p className="mb-1 font-semibold text-zinc-200">{hourLabel(Number(label))}</p>
      {nonZero.length === 0 ? (
        <p className="text-zinc-500">No orders</p>
      ) : (
        <ul className="space-y-0.5">
          {nonZero.map(p => (
            <li key={String(p.dataKey)} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
              <span className="text-zinc-400">{p.name}</span>
              <span className="ml-auto pl-3 tabular-nums text-zinc-200">{p.value}</span>
            </li>
          ))}
          {nonZero.length > 1 && (
            <li className="mt-1 flex items-center gap-1.5 border-t border-zinc-800 pt-1 font-semibold">
              <span className="text-zinc-400">Total</span>
              <span className="ml-auto pl-3 tabular-nums text-zinc-100">{total}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersByHourByBrandChart({ brands, buckets }: Props) {
  const brandColor = useMemo(
    () => new Map(brands.map(b => [b.id, b.color])),
    [brands],
  )

  const { rows, series, total } = useMemo(
    () => buildChart(buckets, brandColor),
    [buckets, brandColor],
  )

  if (total === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No orders today yet"
        description="Today's orders will appear here by hour and brand."
        className="border-none bg-transparent py-10"
      />
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="hour"
          tickFormatter={hourLabel}
          tick={{ fontSize: 10, fill: CHART_TICK }}
          tickLine={false}
          axisLine={{ stroke: CHART_GRID }}
          interval={2}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: CHART_TICK }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip content={<StackTooltip />} cursor={{ fill: CURSOR_FILL }} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={value => (
            <span style={{ fontSize: 11, color: '#A1A1AA' }}>{value}</span>
          )}
        />
        {/* Render in rank order: biggest brand at the stack base, Other on top.
            1px surface stroke = visible gap between stacked segments. */}
        {series.map(s => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="hour"
            fill={s.color}
            stroke={SEGMENT_STROKE}
            strokeWidth={1}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * theme.ts — canonical color tokens for CloudKitchen ONE (UI Reskin Plan).
 *
 * Single source of truth for status / aggregator colors so components never
 * scatter raw hex. Reference these helpers from StatusBadge, AggregatorBadge,
 * KpiCard deltas, charts, etc.
 */

// ─── Order status ──────────────────────────────────────────────────────────────

export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'PAUSED'

/** Canonical hex per status (for places that need a raw color, e.g. chart series). */
export const STATUS_COLOR: Record<OrderStatus, string> = {
  NEW: '#3B82F6',        // blue-500
  PREPARING: '#F59E0B',  // amber-500
  READY: '#10B981',       // emerald-500
  COMPLETED: '#10B981',   // emerald-500
  CANCELLED: '#EF4444',   // red-500
  PAUSED: '#71717A',      // zinc-500
}

/** Tailwind utility classes for a status pill (bg tint + text + ring), dark-mode tuned. */
export const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  NEW: 'bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/30',
  PREPARING: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
  READY: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  CANCELLED: 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30',
  PAUSED: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30',
}

/** Map any status-ish string (case-insensitive, tolerant of unknowns) to badge classes. */
export function statusBadgeClass(status: string | null | undefined): string {
  const key = (status ?? '').toUpperCase() as OrderStatus
  return STATUS_BADGE_CLASSES[key] ?? STATUS_BADGE_CLASSES.PAUSED
}

export function statusColor(status: string | null | undefined): string {
  const key = (status ?? '').toUpperCase() as OrderStatus
  return STATUS_COLOR[key] ?? STATUS_COLOR.PAUSED
}

// ─── Aggregator (delivery platform) ────────────────────────────────────────────

export type Aggregator = 'FOODPANDA' | 'GRABFOOD' | 'OTHER'

export const AGGREGATOR_COLOR: Record<Aggregator, string> = {
  FOODPANDA: '#E2136E',
  GRABFOOD: '#00B14F',
  OTHER: '#71717A', // zinc-500
}

export const AGGREGATOR_LABEL: Record<Aggregator, string> = {
  FOODPANDA: 'foodpanda',
  GRABFOOD: 'GrabFood',
  OTHER: 'Other',
}

/** Tailwind utility classes for an aggregator pill, dark-mode tuned. */
export const AGGREGATOR_BADGE_CLASSES: Record<Aggregator, string> = {
  FOODPANDA: 'bg-[#E2136E]/15 text-[#FF4FA0] ring-1 ring-inset ring-[#E2136E]/30',
  GRABFOOD: 'bg-[#00B14F]/15 text-[#3CDB7F] ring-1 ring-inset ring-[#00B14F]/30',
  OTHER: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30',
}

export function aggregatorBadgeClass(aggregator: string | null | undefined): string {
  const key = (aggregator ?? '').toUpperCase() as Aggregator
  return AGGREGATOR_BADGE_CLASSES[key] ?? AGGREGATOR_BADGE_CLASSES.OTHER
}

export function aggregatorLabel(aggregator: string | null | undefined): string {
  const key = (aggregator ?? '').toUpperCase() as Aggregator
  return AGGREGATOR_LABEL[key] ?? (aggregator ?? 'Other')
}

// ─── KPI delta ──────────────────────────────────────────────────────────────────

/** Tailwind text color for a KPI delta value, by direction. */
export const DELTA_COLOR = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  flat: 'text-zinc-400',
} as const

export type DeltaDirection = keyof typeof DELTA_COLOR

export function deltaDirection(value: number): DeltaDirection {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

// ─── Chart palette (LOCKED by Fable via dataviz validator, 2026-07-06 — W4a) ──
//
// Chart-color-by-job ruling (.claude/context/ui-refinement-w4.md "Chart color
// system"):
//   1. Single-measure charts (revenue/orders per brand, orders-over-time,
//      peak-hours) -> ONE hue, CHART_SINGLE. Never rainbow one measure across
//      brands/hours; highlight only the weakest brand / peak hour (red/amber).
//   2. Aggregator split (donut/pie) -> AGGREGATOR_COLOR (fixed brand colors)
//      + direct labels/legend, never this array.
//   3. Genuine multi-series categorical (distinct entities in one chart) ->
//      CHART_CATEGORICAL, fixed slot order, validated for dark-surface
//      contrast + CVD-safe adjacency.

/** Single-measure chart hue — brand emerald. Use for bars/areas of ONE measure only. */
export const CHART_SINGLE = '#10B981'

/**
 * Validated dark categorical palette (blue, yellow, violet, magenta, green,
 * aqua, orange, red) — L-band PASS, chroma PASS, CVD worst-adjacent dE 40.5
 * PASS, contrast >=3:1 PASS on surface #1a1a19. Fixed slot order; pair with
 * direct labels/legend once 4+ series are shown in one chart.
 */
export const CHART_CATEGORICAL = [
  '#3987e5', '#c98500', '#9085e9', '#d55181', '#008300', '#199e70', '#d95926', '#e66767',
] as const

/** @deprecated back-compat alias — migrate call sites to CHART_SINGLE or CHART_CATEGORICAL per the ruling above. */
export const CHART_PALETTE = CHART_CATEGORICAL

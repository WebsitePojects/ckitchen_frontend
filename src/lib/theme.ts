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

/**
 * Tailwind utility classes for a status pill (bg tint + text + ring).
 * Originally dark-mode-only (the app shipped dark-only) — the pale `-400`
 * text on a barely-tinted `/15` background reads fine on the near-black
 * dark surfaces but fails contrast on a white light-mode card (e.g.
 * blue-400 on white is ~2.5:1, well under WCAG AA's 4.5:1). Light mode now
 * gets darker `-700` text on a lighter `-100`/`-10` tint (unprefixed =
 * light default); `dark:` keeps the exact original dark-mode look.
 */
export const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  NEW: 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/30',
  PREPARING: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30',
  READY: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30',
  COMPLETED: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30',
  CANCELLED: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30',
  PAUSED: 'bg-zinc-200 text-zinc-700 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/30',
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

/** Tailwind utility classes for an aggregator pill. Light default + `dark:` override — see STATUS_BADGE_CLASSES doc above for why. */
export const AGGREGATOR_BADGE_CLASSES: Record<Aggregator, string> = {
  FOODPANDA: 'bg-[#E2136E]/10 text-[#C41165] ring-1 ring-inset ring-[#E2136E]/25 dark:bg-[#E2136E]/15 dark:text-[#FF4FA0] dark:ring-[#E2136E]/30',
  GRABFOOD: 'bg-[#00B14F]/10 text-[#007A37] ring-1 ring-inset ring-[#00B14F]/25 dark:bg-[#00B14F]/15 dark:text-[#3CDB7F] dark:ring-[#00B14F]/30',
  OTHER: 'bg-zinc-200 text-zinc-700 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/30',
}

export function aggregatorBadgeClass(aggregator: string | null | undefined): string {
  const key = (aggregator ?? '').toUpperCase() as Aggregator
  return AGGREGATOR_BADGE_CLASSES[key] ?? AGGREGATOR_BADGE_CLASSES.OTHER
}

export function aggregatorLabel(aggregator: string | null | undefined): string {
  const key = (aggregator ?? '').toUpperCase() as Aggregator
  return AGGREGATOR_LABEL[key] ?? (aggregator ?? 'Other')
}

// ─── Text on brand-colour fills ────────────────────────────────────────────────

const INK_ON_LIGHT_FILL = '#0B1410'
const WHITE = '#FFFFFF'

/** WCAG relative luminance of a #rgb / #rrggbb colour; null when the value is not hex. */
function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const digits = match[1].length === 3 ? match[1].replace(/./g, (d) => d + d) : match[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Text colour for a label drawn on a brand's own colour. Brand colours are owner-entered data,
 * so neither white nor a theme token is readable on every one of them: pick whichever of white
 * or near-black ink contrasts more with the fill. Non-hex values fall back to white.
 */
export function readableTextOn(fill: string): string {
  const fillLuminance = relativeLuminance(fill)
  if (fillLuminance === null) return WHITE
  const onWhite = contrastRatio(fillLuminance, 1)
  const onInk = contrastRatio(fillLuminance, relativeLuminance(INK_ON_LIGHT_FILL) ?? 0)
  return onWhite >= onInk ? WHITE : INK_ON_LIGHT_FILL
}

// ─── KPI delta ──────────────────────────────────────────────────────────────────

/** Tailwind text color for a KPI delta value, by direction. Light default + `dark:` override (same contrast fix as the badge classes above). */
export const DELTA_COLOR = {
  up: 'text-emerald-700 dark:text-emerald-400',
  down: 'text-red-700 dark:text-red-400',
  flat: 'text-zinc-600 dark:text-zinc-400',
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
 * Chart chrome (grid, ticks, tooltip, hover cursor) as CSS colours that follow the active theme.
 * Recharts writes these into SVG attributes and inline styles, where `var()` resolves, so one
 * value serves light and dark without re-rendering on theme switch.
 */
export const CHART_CHROME = {
  grid: 'hsl(var(--border))',
  tick: 'hsl(var(--muted-foreground))',
  cursor: 'hsl(var(--primary) / 0.08)',
  /** Gap between stacked segments: the card surface the chart sits on. */
  segmentStroke: 'hsl(var(--card))',
  tooltip: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--popover-foreground))',
  },
} as const

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

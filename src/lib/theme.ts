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

// ─── Chart palette (Tremor charts, added in later reskin passes) ──────────────

export const CHART_PALETTE = ['#10B981', '#14B8A6', '#06B6D4', '#F59E0B', '#8B5CF6'] as const

/**
 * Brand performance (D59): types and fetch for GET /analytics/brand-performance, shared by
 * the Brands list, the brand detail page and the comparison page. The server computes every
 * number (sales, contribution, trend, projection, verdict); the screen only formats them.
 */
import { useQuery } from '@tanstack/react-query'
import { get } from './api'

export type ProfitStatus = 'NO_SALES' | 'LOSING' | 'THIN' | 'PROFITABLE'
export type Momentum = 'INSUFFICIENT_HISTORY' | 'GROWING' | 'STABLE' | 'DECLINING'

export interface MonthPoint {
  month: string
  grossSales: number
  discounts: number
  netSales: number
  foodCost: number
  channelFees: number
  contribution: number
  orders: number
  cancelledOrders: number
}

export interface BrandPerformance {
  brand: { id: string; name: string; color: string; logoUrl: string | null; isActive: boolean }
  series: MonthPoint[]
  topProducts: Array<{ menuItemId: string; name: string; qty: number; netSales: number; foodCost: number }>
  totals: Omit<MonthPoint, 'month'>
  contributionMargin: number | null
  foodCostShare: number | null
  channelFeeShare: number | null
  cancellationRate: number | null
  averageOrderValue: number | null
  shareOfSales: number | null
  trend: { historyMonths: number; salesSlope: number; contributionSlope: number; r2: number | null; confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' }
  projection: {
    currentMonth: { netSales: number; contribution: number } | null
    nextMonth: { netSales: number; contribution: number; contributionLow: number; contributionHigh: number } | null
  }
  verdict: { status: ProfitStatus; momentum: Momentum; headline: string; signals: Array<{ tone: 'good' | 'warn' | 'bad'; text: string }> }
}

export interface BrandPerformanceReport {
  generatedAt: string
  months: string[]
  currentMonth: { month: string; daysElapsed: number; daysInMonth: number }
  assumptions: { foodCostTarget: number; thinMargin: number; momentumThreshold: number; minHistoryMonths: number; excludes: string }
  portfolio: { netSales: number; contribution: number; orders: number }
  brands: BrandPerformance[]
}

export const PERIOD_OPTIONS = [3, 6, 12] as const

/**
 * One cached report per (brand set, period, outlet). The outlet travels as the X-Outlet-Id
 * header (api.ts); it is in the key so switching outlets never shows another outlet's numbers.
 */
export function useBrandPerformance(opts: { brandIds?: string[]; months: number; outletId?: string | null; enabled?: boolean }) {
  const ids = opts.brandIds ? [...opts.brandIds].sort() : null
  return useQuery({
    queryKey: ['analytics', 'brand-performance', ids?.join(',') ?? 'all', opts.months, opts.outletId ?? 'ALL'],
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(opts.months) })
      if (ids && ids.length > 0) params.set('brand_ids', ids.join(','))
      return (await get<BrandPerformanceReport>(`/analytics/brand-performance?${params}`)).data
    },
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export function formatPeso(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (opts.compact && Math.abs(n) >= 10_000) {
    return `₱${new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`
  }
  return `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

export function formatPct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`
}

export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString([], { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/** Status class from index.css (.status-ok / -warn / -danger) per profit verdict. */
export const STATUS_CLASS: Record<ProfitStatus, string> = {
  PROFITABLE: 'status-ok',
  THIN: 'status-warn',
  LOSING: 'status-danger',
  NO_SALES: '',
}

/** Dot colour for a verdict: a profitable brand whose sales are falling is a warning, not a green light. */
export function verdictClass(verdict: BrandPerformance['verdict']): string {
  if (verdict.status === 'PROFITABLE' && verdict.momentum === 'DECLINING') return 'status-warn'
  return STATUS_CLASS[verdict.status]
}

export const MOMENTUM_LABEL: Record<Momentum, string> = {
  GROWING: 'Growing',
  STABLE: 'Steady',
  DECLINING: 'Declining',
  INSUFFICIENT_HISTORY: 'Too early to tell',
}

export const CONFIDENCE_LABEL: Record<BrandPerformance['trend']['confidence'], string> = {
  NONE: 'not enough history',
  LOW: 'low confidence',
  MEDIUM: 'medium confidence',
  HIGH: 'high confidence',
}

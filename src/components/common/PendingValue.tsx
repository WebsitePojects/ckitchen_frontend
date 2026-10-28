import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Skeleton } from '../ui/skeleton'

/**
 * An inline number (a count, a total) that must not be shown until it is final. While loading
 * it is a skeleton the size of a short word: a provisional "0" reads as a real zero.
 * For KPI cards use <KpiRibbon loading> / <KpiCard loading> instead.
 */
export default function PendingValue({ loading, children, className }: { loading: boolean; children: ReactNode; className?: string }) {
  if (!loading) return <>{children}</>
  return <Skeleton className={cn('inline-block h-4 w-16 align-middle', className)} aria-label="Loading" />
}

import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface KpiRibbonProps {
  children: ReactNode
  /** True until every number in the row is final: each card shows a skeleton instead of a value. */
  loading?: boolean
  className?: string
}

const KpiLoadingContext = createContext(false)

/** Whether the surrounding <KpiRibbon> is still loading (cards read it so a page marks the row once). */
export function useKpiRibbonLoading(): boolean {
  return useContext(KpiLoadingContext)
}

/** Responsive grid wrapper for a row of <KpiCard/>s. */
export default function KpiRibbon({ children, loading = false, className }: KpiRibbonProps) {
  return (
    <KpiLoadingContext.Provider value={loading}>
      <div
        className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', className)}
        aria-busy={loading || undefined}
      >
        {children}
      </div>
    </KpiLoadingContext.Provider>
  )
}

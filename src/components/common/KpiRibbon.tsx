import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface KpiRibbonProps {
  children: ReactNode
  className?: string
}

/** Responsive grid wrapper for a row of <KpiCard/>s. */
export default function KpiRibbon({ children, className }: KpiRibbonProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', className)}>
      {children}
    </div>
  )
}

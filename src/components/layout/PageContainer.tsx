import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface PageContainerProps {
  children: ReactNode
  /** Extra classes merged onto the container (e.g. a page-specific max-width). */
  className?: string
}

/**
 * PageContainer — THE standard content gutter + vertical rhythm for every
 * routed page inside AppShell. `<main>` in AppShell is intentionally
 * unpadded so full-bleed board pages (Kitchen station columns, the /tv
 * wall) can run edge-to-edge; everything else wraps its content in this.
 *
 * Rhythm: 16px gutters (24px ≥sm), 24px top/bottom, 24px between page
 * sections (header → KPI ribbon → toolbar → table/cards).
 *
 * Do NOT add horizontal padding inside pages that use this — that
 * double-pads. Boards opt out by simply not using it.
 */
export default function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn('flex min-h-full w-full flex-col gap-6 px-4 py-6 sm:px-6', className)}>
      {children}
    </div>
  )
}

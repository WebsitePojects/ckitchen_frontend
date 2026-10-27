import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_LOOKUP } from '../layout/nav-items'
import { useInPageTitle } from '../layout/PageHeaderContext'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Optional longer supporting copy below the subtitle — used sparingly. */
  description?: string
  /** Buttons / controls rendered on the right (e.g. "+ Add Merchant"). */
  actions?: ReactNode
}

/**
 * The page's own header and its single h1 (ledger layout): eyebrow (nav group), display
 * title, muted lead, actions, closed by a double rule. While mounted, the Topbar shows only
 * the breadcrumb, so the title never appears twice.
 */
export default function PageHeader({ title, subtitle, description, actions }: PageHeaderProps) {
  const { pathname } = useLocation()
  const group = NAV_LOOKUP.get(pathname)?.group
  useInPageTitle()

  return (
    <header className="rule-double flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-5">
      <div className="min-w-0 motion-safe:animate-fade-in-up">
        {group && <p className="eyebrow mb-2">{group}</p>}
        <h1 className="display-title">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground sm:text-[0.95rem]">{subtitle}</p>}
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

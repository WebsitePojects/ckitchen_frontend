import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Buttons / controls rendered on the right (e.g. "+ Add Merchant"). */
  actions?: ReactNode
}

/**
 * In-content page header — distinct from the Topbar (which shows the same
 * title globally). Use this for the bold in-page heading + action row, e.g.
 * above a KPI ribbon or a DataTable's toolbar.
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

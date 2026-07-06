import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/** Standard empty/zero-data state — used by tables, lists, and stub pages. */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center ${className ?? ''}`}
    >
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/60 ring-1 ring-inset ring-border">
        <Icon className="h-6 w-6 text-zinc-500" aria-hidden />
      </span>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

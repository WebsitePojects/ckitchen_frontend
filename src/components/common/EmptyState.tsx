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
      <Icon className="mb-3 h-10 w-10 text-zinc-600" aria-hidden />
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

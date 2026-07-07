import { cn } from '../../lib/utils'
import { statusBadgeClass } from '../../lib/theme'

interface StatusBadgeProps {
  status: string | null | undefined
  className?: string
}

/** Canonical order-status pill — color mapping lives in lib/theme.ts. */
export default function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        statusBadgeClass(status),
        className,
      )}
    >
      {status ?? '—'}
    </span>
  )
}

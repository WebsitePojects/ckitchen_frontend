import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent } from '../ui/card'
import { cn } from '../../lib/utils'
import { DELTA_COLOR, deltaDirection } from '../../lib/theme'

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  /** Percent change vs. the prior period, e.g. 12.4 or -3.1. Omit to hide the delta row. */
  deltaPct?: number
  /** Optional mini chart / sparkline slot rendered below the value. */
  children?: ReactNode
  className?: string
}

/** KPI stat card — icon, label, big tabular-nums value, optional delta + chart slot. */
export default function KpiCard({ icon: Icon, label, value, deltaPct, children, className }: KpiCardProps) {
  const direction = deltaPct === undefined ? 'flat' : deltaDirection(deltaPct)
  const DeltaIcon = direction === 'down' ? TrendingDown : TrendingUp

  return (
    <Card className={cn('border-border bg-card', className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
          <Icon className="h-4 w-4 text-emerald-500" aria-hidden />
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-zinc-50 sm:text-3xl">{value}</span>
          {deltaPct !== undefined && (
            <span className={cn('flex items-center gap-0.5 text-xs font-semibold tabular-nums', DELTA_COLOR[direction])}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {Math.abs(deltaPct).toFixed(1)}%
            </span>
          )}
        </div>

        {children && <div className="mt-3">{children}</div>}
      </CardContent>
    </Card>
  )
}

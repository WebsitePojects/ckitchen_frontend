import { cn } from '../../lib/utils'
import { aggregatorBadgeClass, aggregatorLabel } from '../../lib/theme'

interface AggregatorBadgeProps {
  aggregator: string | null | undefined
  className?: string
}

/** foodpanda / GrabFood / Other pill — color mapping lives in lib/theme.ts. */
export default function AggregatorBadge({ aggregator, className }: AggregatorBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        aggregatorBadgeClass(aggregator),
        className,
      )}
    >
      {aggregatorLabel(aggregator)}
    </span>
  )
}

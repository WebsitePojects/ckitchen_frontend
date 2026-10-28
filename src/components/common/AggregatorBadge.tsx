import { cn } from '../../lib/utils'
import { aggregatorBadgeClass, aggregatorLabel } from '../../lib/theme'

interface AggregatorBadgeProps {
  aggregator: string | null | undefined
  /** The listing's sales channel (D60). When given, its own name and colour are shown. */
  channel?: { name: string; color: string } | null
  className?: string
}

/**
 * Where an order or listing comes from. With a channel: a colour dot + its name (any
 * owner-made channel). Without one (older payloads): the foodpanda / GrabFood / Other pill.
 */
export default function AggregatorBadge({ aggregator, channel, className }: AggregatorBadgeProps) {
  if (channel) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground', className)}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: channel.color }} aria-hidden />
        {channel.name}
      </span>
    )
  }
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

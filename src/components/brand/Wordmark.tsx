import { Orbit } from 'lucide-react'
import { PLATFORM_NAME } from '../../lib/branding'
import { cn } from '../../lib/utils'

/** Product mark + name. One component so the sidebar, top bar and auth pages never disagree. */
export default function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <Orbit className="h-5 w-5 shrink-0 text-ink-accent" aria-hidden />
      {!compact && <span className="text-ws-section font-semibold tracking-tight">{PLATFORM_NAME}</span>}
    </span>
  )
}

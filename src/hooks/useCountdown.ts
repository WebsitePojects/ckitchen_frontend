/**
 * useCountdown — live MM:SS countdown to a deadline timestamp.
 *
 * Built for the Merchant Console's accept-deadline card
 * (SITE_VISIT_VIDEO_ANALYSIS.md §1b — the Grab Merchant app's Accept/Reject
 * modal: "Accept your order within 5 minutes — Orders that are ignored will
 * expire and your store will be paused"). This is the single highest-impact
 * gap identified in that analysis (§6 row B) — ORION currently only shows
 * elapsed time, never a countdown to a hard SLA.
 *
 * Self-contained: ticks its own 1s interval only while a deadline is
 * supplied, and stops entirely (no interval at all) once expired remains
 * true forever after or when deadlineIso is null/undefined — this matters at
 * Merchant Console scale (SITE_VISIT_VIDEO_ANALYSIS.md §7, up to 50 listings)
 * where dozens of NEW-order cards could otherwise each run a live timer.
 */
import { useEffect, useState } from 'react'

export interface CountdownState {
  /** Whole seconds remaining, floored at 0. Null when there is no deadline. */
  secondsLeft: number | null
  /** True once the deadline has passed (secondsLeft reached 0). */
  isExpired: boolean
  /** MM:SS label, or null when there is no deadline to show. */
  label: string | null
}

const NO_DEADLINE: CountdownState = { secondsLeft: null, isExpired: false, label: null }

/**
 * @param deadlineIso ISO timestamp to count down to. Null/undefined (order
 *   has no `acceptDeadlineAt` yet — MC-1 backend not caught up, or a
 *   non-NEW-stage card) means "no countdown"; callers should fall back to
 *   their existing elapsed-time display in that case.
 */
export function useCountdown(deadlineIso: string | null | undefined): CountdownState {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadlineIso) return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [deadlineIso])

  if (!deadlineIso) return NO_DEADLINE

  const deadlineMs = new Date(deadlineIso).getTime()
  if (Number.isNaN(deadlineMs)) return NO_DEADLINE

  const remainingMs = deadlineMs - now
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000))
  const isExpired = remainingMs <= 0
  const mm = Math.floor(secondsLeft / 60)
  const ss = secondsLeft % 60
  const label = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`

  return { secondsLeft, isExpired, label }
}

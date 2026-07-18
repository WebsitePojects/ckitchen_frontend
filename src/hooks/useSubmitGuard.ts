import { useCallback, useRef, useState } from 'react'

/**
 * In-flight guard for mutating handlers (double-submit race prevention —
 * "user on slow internet presses a mutating button multiple times" must
 * never fire more than one network request per intent).
 *
 * `pending` drives the button's disabled/spinner state, same convention as
 * the `saving`/`submitting` local-state pattern already used across the
 * dialogs in this codebase. `guard(fn)` wraps the async handler so a second
 * dispatch — a fast double-click, an Enter-key repeat, or a click that lands
 * before React has painted the `disabled` attribute — is a synchronous
 * no-op instead of a second request.
 *
 * A ref (not just the `pending` state) backs the check: state read inside a
 * handler closure can be stale across two calls that both fire within the
 * same tick, but a ref mutation is immediate, so the second call always sees
 * the first call's guard.
 */
export function useSubmitGuard() {
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  const guard = useCallback(
    <Args extends unknown[]>(fn: (...args: Args) => Promise<void>) =>
      async (...args: Args) => {
        if (pendingRef.current) return
        pendingRef.current = true
        setPending(true)
        try {
          await fn(...args)
        } finally {
          pendingRef.current = false
          setPending(false)
        }
      },
    [],
  )

  return { pending, guard }
}

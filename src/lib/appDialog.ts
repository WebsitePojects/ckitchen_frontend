/**
 * appDialog — global, imperative app-dialog mechanism (client review 2026-07-08:
 * "add error modal pop up… with animation… implement this across global OOP").
 *
 * One reusable mechanism, not ad-hoc dialogs: any code — even plain modules or
 * components mounted ABOVE the provider in the tree (e.g. RequireAttendance, the
 * attendance gate, which renders as an ancestor of AppShell where the provider
 * lives) — can call `showAppDialog(...)`. It mirrors the `setCrucialErrorHandler`
 * pattern in lib/api.ts: the React provider (ErrorDialogContext) registers a
 * module-level handler on mount and clears it on unmount.
 *
 * BUFFERING: a `showAppDialog` fired while no provider is mounted (or during the
 * brief unmount→remount when the gate redirects a blocked route back to
 * /attendance) is stashed in `pending` and flushed the moment a handler
 * (re)registers. That is what lets the gate fire the dialog during a blocked
 * render yet still have it appear on the /attendance page after the redirect.
 */

export type AppDialogVariant = 'info' | 'warning' | 'error'

export interface AppDialogOptions {
  variant: AppDialogVariant
  title: string
  message: string
  /** Primary action button label. Omit for a lone "OK" dismiss button. */
  actionLabel?: string
  /** Invoked after the dialog closes when the primary action is pressed. */
  onAction?: () => void
}

type AppDialogHandler = (opts: AppDialogOptions) => void

let _handler: AppDialogHandler | null = null
let _pending: AppDialogOptions | null = null

/** Registered by ErrorDialogProvider on mount (null on unmount). */
export function setAppDialogHandler(handler: AppDialogHandler | null): void {
  _handler = handler
  // Flush anything requested while no provider was mounted (or mid-remount).
  if (handler && _pending) {
    const flush = _pending
    _pending = null
    handler(flush)
  }
}

/**
 * Imperatively show the global app dialog. Safe to call from anywhere,
 * including outside the React tree or above the provider — the request is
 * buffered until a provider is available.
 */
export function showAppDialog(opts: AppDialogOptions): void {
  if (_handler) _handler(opts)
  else _pending = opts
}

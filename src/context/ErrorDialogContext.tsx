/**
 * ErrorDialogContext — global CRUCIAL-error pop-up (client review 2026-07-08:
 * "crucial errors need a proper pop-up, not just a toast").
 *
 * Mounted once in AppShell. On mount it registers a module-level callback with
 * src/lib/api.ts (`setCrucialErrorHandler`), which the axios response
 * interceptor invokes for CRUCIAL failures only:
 *   - mutations (POST/PUT/PATCH/DELETE) failing with a network error or >= 500
 *   - session-expired 401s (shows a Sign-in action that routes to /login)
 * 4xx validation/conflict errors never reach this dialog — they stay with the
 * pages' existing toasts.
 *
 * Built directly on the @radix-ui/react-dialog primitives (same package as
 * components/ui/dialog.tsx) but styled alert-dialog-like: no top-right X,
 * a destructive accent, and a single explicit action (Dismiss / Sign in).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { setCrucialErrorHandler, type CrucialError } from '../lib/api'

interface ErrorDialogContextValue {
  /** Imperatively show the crucial-error dialog (rarely needed — the axios
   *  interceptor is the main producer). */
  showError: (error: CrucialError) => void
}

const ErrorDialogContext = createContext<ErrorDialogContextValue>({
  showError: () => {},
})

// eslint-disable-next-line react-refresh/only-export-components
export function useErrorDialog(): ErrorDialogContextValue {
  return useContext(ErrorDialogContext)
}

export function ErrorDialogProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<CrucialError | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    setCrucialErrorHandler((incoming) => {
      setError((prev) => {
        // A session-expired error outranks anything already showing (every
        // further request will fail until re-auth); otherwise first-come wins
        // so a burst of failed mutations doesn't flap the dialog contents.
        if (prev?.kind === 'session') return prev
        if (incoming.kind === 'session') return incoming
        return prev ?? incoming
      })
    })
    return () => setCrucialErrorHandler(null)
  }, [])

  function dismiss() {
    setError(null)
  }

  function handleSignIn() {
    setError(null)
    // Token + socket were already torn down by the api interceptor.
    navigate('/login')
  }

  const isSession = error?.kind === 'session'

  return (
    <ErrorDialogContext.Provider value={{ showError: (e) => setError(e) }}>
      {children}

      <DialogPrimitive.Root
        open={error !== null}
        onOpenChange={(open) => {
          if (!open) dismiss()
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-md max-h-[90vh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border border-red-500/30 bg-zinc-950 p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            // Alert-style: no outside-click dismissal — the single action below
            // is the explicit way out.
            onInteractOutside={(e) => e.preventDefault()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                <DialogPrimitive.Title className="text-lg font-semibold leading-tight tracking-tight text-zinc-50">
                  {error?.title ?? ''}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm leading-relaxed text-zinc-400">
                  {error?.message ?? ''}
                </DialogPrimitive.Description>
              </div>
            </div>

            {error?.detail && (
              <details className="group rounded-md border border-zinc-800 bg-zinc-900/50">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300">
                  Technical details
                </summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-500">
                  {error.detail}
                </pre>
              </details>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {isSession ? (
                <Button
                  onClick={handleSignIn}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Sign in
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={dismiss}
                  className="border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
                >
                  Dismiss
                </Button>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ErrorDialogContext.Provider>
  )
}

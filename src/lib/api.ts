import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  isAxiosError,
} from 'axios'
import { destroySocket } from './socket'

// ─── Error shape from CK1-API-003 §1 ─────────────────────────────────────────

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export class CKApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'CKApiError'
  }
}

// ─── Token accessor ──────────────────────────────────────────────────────────

const TOKEN_KEY = 'ck_jwt'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

// Outlet context switcher (platform-ia-navigation.md §5). Read directly from
// localStorage — same pattern as getToken() above — rather than threading
// React context into this plain axios module. 'ALL' (or unset) means no
// outlet filter; the backend doesn't scope by it yet (D22 is a separate
// backend-wave item), so this header is inert until that lands.
const OUTLET_STORAGE_KEY = 'orion.outletId'

function getOutletId(): string | null {
  const id = localStorage.getItem(OUTLET_STORAGE_KEY)
  return id && id !== 'ALL' ? id : null
}

/**
 * Fired when the backend 403s a request's `X-Outlet-Id` header (D22
 * `resolveOutletContext` membership check — a stale persisted selection,
 * access revoked after the JWT was minted, or a legacy pre-tenancy token
 * whose effective `outlet_ids` is always `[]`). `OutletContext` listens for
 * this to clear the selection WITHOUT logging the user out — it's a tenancy
 * scoping problem, not an auth failure. Kept as a duplicated literal (same
 * pattern as OUTLET_STORAGE_KEY above) rather than imported, so this plain
 * axios module never has to import the OutletContext component.
 */
const OUTLET_FORBIDDEN_EVENT = 'orion:outlet-forbidden'

// ─── Base client ─────────────────────────────────────────────────────────────

/**
 * API origin. In production the SPA is hosted on a different origin than the API
 * (e.g. Vercel frontend → Render backend), so it needs the backend's ABSOLUTE URL.
 * Set `VITE_API_URL` (preferred) or `VITE_API_PROXY_TARGET` at build time to the backend
 * origin, e.g. `https://ckitchenbackend.onrender.com`. In dev both are usually empty →
 * baseURL stays relative `/api/v1`, which the Vite dev proxy forwards to the local backend.
 * NOTE: Vite bakes env vars at BUILD time — you must redeploy after changing them.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>
const API_ORIGIN = String(env.VITE_API_URL || env.VITE_API_PROXY_TARGET || '').replace(/\/+$/, '')

/**
 * Request timeout. The API runs on Render's free tier, which spins the service
 * DOWN after ~15 min idle and takes ~50s to cold-start (measured: 52s). The old
 * 20s timeout was shorter than that wake time, so the first request after idle
 * (usually login) failed with "timeout of 20000ms exceeded" even though the
 * backend was fine — it just wasn't awake yet. 60s covers the cold start with
 * margin while still bounding a genuinely hung request. See warmUpApi() below,
 * which starts the wake early so users rarely wait the full time.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_ORIGIN}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

/**
 * Fire-and-forget wake-up ping. Call on app/login mount so Render starts spinning
 * up BEFORE the user submits credentials — by the time they finish typing, the
 * service is usually warm. Swallows all errors (it's purely opportunistic).
 */
export function warmUpApi(): void {
  apiClient
    .get('/health', { timeout: 60_000 })
    .catch(() => { /* opportunistic — ignore */ })
}

// ─── Crucial-error modal hook (client review 2026-07-08) ─────────────────────
//
// CRUCIAL failures get a blocking pop-up, not just a toast:
//   (a) any MUTATION (POST/PUT/PATCH/DELETE) failing with a network error or a
//       status >= 500 — the user's change may not have been saved;
//   (b) session-expired 401s — "Your session ended" with a Sign-in action.
// 4xx validation/conflict errors stay with the pages' existing toasts.
//
// This plain axios module can't reach React context, so the ErrorDialogProvider
// (src/context/ErrorDialogContext.tsx, mounted in AppShell) registers a
// module-level callback here. The api stays fully usable BEFORE the provider
// mounts: with no handler registered, behavior falls back to what it was
// (401 → hard redirect to /login; other failures → the caller's own handling).

export interface CrucialError {
  kind: 'server' | 'network' | 'session'
  title: string
  /** Human-readable message shown prominently in the dialog. */
  message: string
  /** Technical detail, shown collapsed/smaller. */
  detail?: string
  status?: number
}

type CrucialErrorHandler = (error: CrucialError) => void

let _crucialErrorHandler: CrucialErrorHandler | null = null

/** Registered by ErrorDialogProvider on mount (null on unmount). */
export function setCrucialErrorHandler(handler: CrucialErrorHandler | null): void {
  _crucialErrorHandler = handler
}

/** Returns true if a provider is mounted and took the error. */
function reportCrucialError(error: CrucialError): boolean {
  if (!_crucialErrorHandler) return false
  _crucialErrorHandler(error)
  return true
}

const MUTATION_METHODS = new Set(['post', 'put', 'patch', 'delete'])

// Attach stored JWT + selected outlet on every request (unless the caller already set one)
apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const outletId = getOutletId()
  if (outletId && !config.headers['X-Outlet-Id']) {
    config.headers['X-Outlet-Id'] = outletId
  }
  return config
})

// Normalise API error responses into CKApiError instances
apiClient.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (isAxiosError(err) && !err.response && err.code !== 'ERR_CANCELED') {
      // No response at all — server unreachable, DNS failure, or timeout.
      // Crucial ONLY for mutations: the user's change may not have been saved.
      // Reads keep their existing per-page error states/toasts.
      const method = (err.config?.method ?? 'get').toLowerCase()
      if (MUTATION_METHODS.has(method)) {
        reportCrucialError({
          kind: 'network',
          title: 'Connection problem',
          message:
            'We could not reach the server, so your change may not have been saved. Check your connection and try again.',
          detail: `${err.code ?? 'NETWORK_ERROR'}: ${err.message}\n${method.toUpperCase()} ${err.config?.url ?? ''}`,
        })
      }
    }

    if (isAxiosError(err) && err.response) {
      const requestLine = `${(err.config?.method ?? 'GET').toUpperCase()} ${err.config?.url ?? ''}`

      // Session expired/invalid — clear local auth state. With the
      // ErrorDialogProvider mounted (authenticated shell), show the
      // session-ended modal whose Sign-in action routes to /login; before the
      // provider mounts, fall back to the original hard redirect. On /login
      // itself a 401 just means wrong credentials — neither modal nor redirect.
      // Fires once per 401 response; no retry.
      if (err.response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        destroySocket()
        if (window.location.pathname !== '/login') {
          const handled = reportCrucialError({
            kind: 'session',
            title: 'Session expired',
            message: 'Your session ended — please sign in again.',
            detail: `401 Unauthorized\n${requestLine}`,
            status: 401,
          })
          if (!handled) window.location.assign('/login')
        }
      }

      const body = err.response.data as { error?: ApiError }
      const apiErr = body?.error

      // Server-side failure (>= 500) on a MUTATION — crucial pop-up. 4xx
      // (validation/conflict/permission) stays with the pages' own toasts.
      if (
        err.response.status >= 500 &&
        MUTATION_METHODS.has((err.config?.method ?? 'get').toLowerCase())
      ) {
        reportCrucialError({
          kind: 'server',
          title: 'Something went wrong',
          message:
            'The server hit an unexpected error and your change was not saved. Please try again; if it keeps failing, contact support.',
          detail: `HTTP ${err.response.status}\n${requestLine}${apiErr ? `\n${apiErr.code}: ${apiErr.message}` : ''}`,
          status: err.response.status,
        })
      }

      // Outlet membership check failed (D22 resolveOutletContext): the
      // X-Outlet-Id we sent isn't one this user may act in. Only treat it as
      // an outlet-scoping issue (not e.g. a role-based 403 on some other
      // route) when this exact request actually carried the header AND the
      // message matches the backend's outlet-scope wording — clear the
      // stale selection so the browser stops resending a doomed header, but
      // never log the user out over a tenancy mismatch.
      if (
        err.response.status === 403 &&
        apiErr?.code === 'FORBIDDEN' &&
        apiErr.message?.toLowerCase().includes('outlet') &&
        (err.response.config?.headers as Record<string, unknown> | undefined)?.['X-Outlet-Id']
      ) {
        localStorage.removeItem(OUTLET_STORAGE_KEY)
        window.dispatchEvent(new Event(OUTLET_FORBIDDEN_EVENT))
      }

      if (apiErr) {
        return Promise.reject(
          new CKApiError(apiErr.code, apiErr.message, apiErr.details, err.response.status),
        )
      }
    }
    return Promise.reject(err)
  },
)

// ─── Typed helpers ────────────────────────────────────────────────────────────

export function get<T>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return apiClient.get<T>(path, config)
}

export function post<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  return apiClient.post<T>(path, body, config)
}

export function patch<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  return apiClient.patch<T>(path, body, config)
}

export function put<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  return apiClient.put<T>(path, body, config)
}

export function del<T>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return apiClient.delete<T>(path, config)
}

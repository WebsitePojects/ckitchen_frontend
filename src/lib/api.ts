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

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_ORIGIN}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
})

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
    if (isAxiosError(err) && err.response) {
      // Session expired/invalid — clear local auth state and bounce to /login.
      // Fires exactly once per 401 response; no retry.
      if (err.response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        destroySocket()
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
      }

      const body = err.response.data as { error?: ApiError }
      const apiErr = body?.error
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

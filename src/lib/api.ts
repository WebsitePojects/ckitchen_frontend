import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  isAxiosError,
} from 'axios'

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

// ─── Base client ─────────────────────────────────────────────────────────────

/**
 * Raw axios instance — base URL is the Vite dev proxy (same origin).
 * For production builds the app is served behind the same backend origin.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// Attach stored JWT on every request (unless the caller already set one)
apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Normalise API error responses into CKApiError instances
apiClient.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (isAxiosError(err) && err.response) {
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

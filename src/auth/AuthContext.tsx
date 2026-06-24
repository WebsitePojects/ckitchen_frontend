import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiClient } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'SUPER_ADMIN'
  | 'BRAND_MANAGER'
  | 'KITCHEN_STAFF'
  | 'WAREHOUSE'
  | 'SUPPLIER_COORDINATOR'
  | 'ACCOUNTANT'
  | 'RIDER'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'ck_jwt'

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    loading: true,
  })

  // On mount (or token change), validate the stored token via /auth/me
  useEffect(() => {
    if (!state.token) {
      setState((s) => ({ ...s, loading: false }))
      return
    }

    apiClient
      .get<AuthUser>('/auth/me', {
        headers: { Authorization: `Bearer ${state.token}` },
      })
      .then(({ data }) => {
        setState({ token: state.token, user: data, loading: false })
      })
      .catch(() => {
        // Token invalid or expired — clear it
        localStorage.removeItem(TOKEN_KEY)
        setState({ token: null, user: null, loading: false })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiClient.post<{ token: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
    )
    localStorage.setItem(TOKEN_KEY, data.token)
    setState({ token: data.token, user: data.user, loading: false })
  }, [])

  const logout = useCallback(async () => {
    // Best-effort server invalidation — ignore errors (token may already be gone)
    if (state.token) {
      apiClient
        .post('/auth/logout', null, {
          headers: { Authorization: `Bearer ${state.token}` },
        })
        .catch(() => undefined)
    }
    localStorage.removeItem(TOKEN_KEY)
    setState({ token: null, user: null, loading: false })
  }, [state.token])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

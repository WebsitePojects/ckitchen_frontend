import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

/**
 * Route guard: redirects unauthenticated users to /login.
 * Preserves the original destination in location state so Login can
 * redirect back after a successful sign-in.
 */
export function RequireAuth() {
  const { token, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    // Still validating the stored token — render a minimal spinner
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}

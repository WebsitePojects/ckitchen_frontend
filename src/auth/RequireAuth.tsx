import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

/**
 * Route guard: redirects unauthenticated users to /login.
 * Preserves the original destination in location state so Login can
 * redirect back after a successful sign-in.
 *
 * Signed in means a loaded ORION `user`, never a stored `token`: Clerk sign-ins keep no
 * ORION token (Clerk holds it), so a token check bounced every Google login back to /login.
 */
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}

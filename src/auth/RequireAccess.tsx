import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { canAccess } from './access'

/**
 * Route guard: redirects to the Dashboard if the signed-in user's role is not
 * permitted on the current path. Runs inside <RequireAuth> + <AppShell>, so the
 * token is already validated and the shell chrome still renders.
 */
export function RequireAccess() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  // RequireAuth handles the no-token case upstream; if user is still resolving, render nothing.
  if (!user) return null

  if (!canAccess(user.role, pathname)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

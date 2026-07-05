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

  // '/' always renders: the index route is <RoleLanding/>, which itself decides
  // per-role whether that means the Dashboard or a bounce to the role's actual
  // landing page (platform-ia-navigation.md §4). Gating '/' here too would
  // self-redirect roles whose matrix excludes Dashboard (e.g. KITCHEN_CREW)
  // into an infinite loop back to '/'.
  if (pathname !== '/' && !canAccess(user.role, pathname)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

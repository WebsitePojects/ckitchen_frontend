import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { normalizeRole, ROLE_LANDING } from './access'
import { usePermissions } from '../context/PermissionsContext'

/**
 * Route guard: redirects to the user's landing route if the signed-in user's
 * role is not permitted on the current path. Runs inside <RequireAuth> +
 * <AppShell>, so the token is already validated and the shell chrome still
 * renders.
 *
 * Consults `canAccessPage` (context/PermissionsContext.tsx), which layers the
 * persisted admin RBAC matrix on top of the code-defined `canAccess` defaults.
 * FAIL OPEN: canAccessPage itself falls back to the code defaults whenever the
 * matrix hasn't loaded yet / failed to load / came back empty — so this guard
 * never blocks navigation during a slow or failed permissions fetch; it just
 * behaves exactly as it did before this endpoint existed.
 */
export function RequireAccess() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { canAccessPage } = usePermissions()

  // RequireAuth handles the no-token case upstream; if user is still resolving, render nothing.
  if (!user) return null

  // '/' always renders: the index route is <RoleLanding/>, which itself decides
  // per-role whether that means the Dashboard or a bounce to the role's actual
  // landing page (platform-ia-navigation.md §4). Gating '/' here too would
  // self-redirect roles whose matrix excludes Dashboard (e.g. KITCHEN_CREW)
  // into an infinite loop back to '/'.
  if (pathname !== '/' && !canAccessPage(pathname)) {
    const landing = ROLE_LANDING[normalizeRole(user.role)] ?? '/'
    return <Navigate to={landing} replace />
  }

  return <Outlet />
}

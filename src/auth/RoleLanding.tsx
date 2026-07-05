import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { ROLE_LANDING, normalizeRole } from './access'
import Dashboard from '../pages/Dashboard'

/**
 * Index-route ('/') element. Most roles land on the Dashboard, but a handful
 * of v2 roles have a more useful default surface than the KPI dashboard
 * (platform-ia-navigation.md §4 "Per-role landing"): KITCHEN_CREW -> /kitchen,
 * WAREHOUSE_* -> /inventory, PURCHASING -> /master-data, HR -> /attendance,
 * ACCOUNTING -> /reports. Runs inside <RequireAuth> + <RequireAccess>, so
 * `user` is always resolved by the time this renders.
 */
export default function RoleLanding() {
  const { user } = useAuth()
  if (!user) return null

  const target = ROLE_LANDING[normalizeRole(user.role)]
  if (target) return <Navigate to={target} replace />

  return <Dashboard />
}

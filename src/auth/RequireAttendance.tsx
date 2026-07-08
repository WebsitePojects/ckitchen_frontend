import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api'
import { showAppDialog } from '../lib/appDialog'
import { useAuth } from './AuthContext'
import { normalizeRole } from './access'

/**
 * Attendance gate — the "second middleware after login" (client directive,
 * 2026-07-08). Runs inside <RequireAuth/> and wraps the whole authenticated
 * surface (AppShell routes + /tv — see App.tsx): a staff member who has not
 * clocked in today is bounced to /attendance until they punch TIME_IN.
 *
 * Pass-through cases (never redirected):
 *   - OWNER — exempt by role (kiosk-style operator, not a clocked employee).
 *   - No linked employee record (`employee: null` from self/today) — nothing
 *     to clock; admin/service accounts keep working.
 *   - Already clocked in today (`clocked_in: true`).
 *   - Exempt paths: /attendance itself (the page the gate redirects TO — a
 *     guard that trapped it would loop) and, defensively, /login + /kiosk/*
 *     (both live OUTSIDE <RequireAuth/> so the gate never actually renders
 *     for them, but the check makes the invariant local and future-proof).
 *   - Query error — FAIL OPEN, same philosophy as RequireAccess/permissions:
 *     a flaky network or a 500 must never brick the whole app; the punch
 *     endpoints still enforce their own rules server-side.
 *
 * Freshness: shares the ['attendance','self-today'] query (staleTime 30s)
 * with Attendance.tsx, which optimistically updates + invalidates it after a
 * successful punch — so the post-TIME_IN navigation passes the gate without
 * a refetch race.
 */

export interface SelfAttendanceToday {
  employee: {
    id: string
    employeeNo: string
    fullName: string
    department: string
    photoUrl: string | null
  } | null
  clocked_in: boolean
  clocked_out: boolean
  last_type: 'TIME_IN' | 'TIME_OUT' | null
}

export const SELF_TODAY_QUERY_KEY = ['attendance', 'self-today'] as const

export async function fetchSelfToday(): Promise<SelfAttendanceToday> {
  return (await get<SelfAttendanceToday>('/ems/attendance/self/today')).data
}

/** Paths the gate must never trap (see doc block). */
function isExemptPath(pathname: string): boolean {
  return (
    pathname === '/attendance' ||
    pathname === '/login' ||
    pathname.startsWith('/kiosk')
  )
}

export function RequireAttendance() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const isOwner = user ? normalizeRole(user.role) === 'OWNER' : false
  const exempt = isExemptPath(location.pathname)

  // Hooks run unconditionally; the query itself only fires for non-OWNER
  // authed users (a disabled query stays isPending forever, so every branch
  // below that reads isPending is behind the isOwner/exempt early returns).
  const query = useQuery({
    queryKey: SELF_TODAY_QUERY_KEY,
    queryFn: fetchSelfToday,
    staleTime: 30_000,
    enabled: !!user && !isOwner,
  })

  // Blocked = an authed non-OWNER, with a linked employee, who is NOT clocked
  // in and is trying to open a non-exempt route (i.e. anything but /attendance).
  // This drives the explanatory gate modal below.
  const isBlocked =
    !!user &&
    !isOwner &&
    !exempt &&
    query.isSuccess &&
    !!query.data.employee &&
    !query.data.clocked_in

  // Fire the explanatory modal ONCE per navigation attempt (guard by
  // location.key so React rerenders don't re-fire it). The dialog is buffered
  // by lib/appDialog and shown on /attendance after the redirect below lands.
  const firedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (isBlocked && firedKeyRef.current !== location.key) {
      firedKeyRef.current = location.key
      showAppDialog({
        variant: 'warning',
        title: 'Clock in first',
        message:
          "You're timed out. Record your time-in on the Attendance page before opening other pages.",
        actionLabel: 'Go to Attendance',
        onAction: () => navigate('/attendance', { replace: true }),
      })
    }
  }, [isBlocked, location.key, navigate])

  // RequireAuth handles the no-token case upstream; if user is still resolving, render nothing.
  if (!user) return null

  if (isOwner || exempt) return <Outlet />

  if (query.isPending) {
    // Same minimal-spinner pattern as RequireAuth — avoids a flash-redirect
    // to /attendance while today's state is still loading.
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  if (query.isError) return <Outlet /> // fail open — never brick the app on a fetch failure

  const today = query.data
  if (!today.employee || today.clocked_in) return <Outlet />

  return <Navigate to="/attendance" replace state={{ from: location }} />
}

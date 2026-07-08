import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CircleAlert,
  CheckCircle2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Search,
  UserCheck,
  UserX,
} from 'lucide-react'
import { get, post, CKApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { normalizeRole, ROLE_LANDING } from '../auth/access'
import {
  SELF_TODAY_QUERY_KEY,
  fetchSelfToday,
  type SelfAttendanceToday,
} from '../auth/RequireAttendance'
import { useAttendanceCamera, AttendanceCameraView } from '../components/AttendanceCamera'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

/**
 * 1×1 transparent PNG — the placeholder "photo" sent when the camera is
 * unavailable so a staffer can still clock in (gap #3). The backend requires a
 * non-empty photo (Cloudinary upload); this keeps that contract intact while the
 * FLAG_NOTE marks the punch for later review.
 */
const PLACEHOLDER_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const FLAG_NOTE = 'Camera unavailable — punched without photo (flagged for review)'

interface Employee {
  id: string
  employeeNo: string
  fullName: string
  department: string
  status: string
}
interface Punch {
  id: string
  employeeId: string
  type: 'TIME_IN' | 'TIME_OUT'
  photoUrl: string
  capturedAt: string
  note: string | null
  /** DTR pairing state (backend 2026-07-08). Absent on old deploys → render as
   *  today (no status badge). FORFEITED = timed in >24h ago, never timed out. */
  status?: 'COMPLETE' | 'OPEN' | 'FORFEITED'
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Attendance / DTR page.
 *
 * SELF-LOCKED (client directive, 2026-07-08): a non-OWNER user gets NO
 * employee dropdown — the page resolves their OWN linked employee via
 * GET /ems/attendance/self/today and renders a locked identity card; punches
 * always post THAT employee_id (the backend enforces the same rule with
 * 403 SELF_ONLY). Time In is disabled once clocked in today; Time Out until
 * clocked in / after clocking out. A successful TIME_IN updates the shared
 * ['attendance','self-today'] cache (which RequireAttendance gates on) and
 * navigates to the page the gate intercepted (`location.state.from`) or the
 * role's landing route.
 *
 * OWNER keeps the original kiosk-style flow unchanged: searchable dropdown of
 * ALL active employees, punch anyone, recent-punches panel — plus a link to
 * the public wall-tablet kiosk (/kiosk/attendance).
 */
export default function Attendance() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isOwner = user ? normalizeRole(user.role) === 'OWNER' : false
  /** Set when RequireAttendance bounced the user here mid-navigation. */
  const gateFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? null

  const { videoRef, camError, startCamera, captureFrame } = useAttendanceCamera()

  // ── Self identity + today's clock state (non-OWNER) ───────────────────────
  const selfQuery = useQuery({
    queryKey: SELF_TODAY_QUERY_KEY,
    queryFn: fetchSelfToday,
    staleTime: 30_000,
    enabled: !!user && !isOwner,
  })
  const selfToday = isOwner ? undefined : selfQuery.data
  const selfEmployee = selfToday?.employee ?? null

  // ── OWNER: all active employees for the kiosk-style dropdown ──────────────
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!isOwner) return
    get<Employee[]>('/employees?status=ACTIVE')
      .then((r) => setEmployees(r.data))
      .catch(() => setEmployees([]))
  }, [isOwner])

  const [punches, setPunches] = useState<Punch[]>([])
  const [submitting, setSubmitting] = useState<null | 'TIME_IN' | 'TIME_OUT'>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null)

  const selected = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) => e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q),
    )
  }, [employees, search])

  // The employee the punch buttons act on: OWNER's dropdown pick, or the
  // caller's own locked employee record.
  const effectiveEmployeeId = isOwner ? employeeId : selfEmployee?.id ?? ''
  const effectiveName = isOwner ? selected?.fullName : selfEmployee?.fullName

  // ── Recent punches for whichever employee is in scope ──────────────────────
  function loadPunches(empId: string) {
    if (!empId) return setPunches([])
    get<Punch[]>(`/ems/attendance?employee_id=${empId}&limit=8`)
      .then((r) => setPunches(r.data))
      .catch(() => setPunches([]))
  }
  useEffect(() => {
    loadPunches(effectiveEmployeeId)
  }, [effectiveEmployeeId])

  async function punch(type: 'TIME_IN' | 'TIME_OUT', opts?: { noPhoto?: boolean }) {
    setMsg(null)
    if (!effectiveEmployeeId) {
      return setMsg({ err: isOwner ? 'Select an employee first.' : 'No linked employee record.' })
    }
    // Fallback path (gap #3): camera unavailable → placeholder photo + flag note,
    // so a broken webcam at an outlet never blocks a required daily clock-in.
    const noPhoto = opts?.noPhoto ?? false
    const photo = noPhoto ? PLACEHOLDER_PHOTO : captureFrame()
    if (!photo) return setMsg({ err: 'Camera not ready — cannot capture photo proof.' })
    setSubmitting(type)
    try {
      await post<Punch>('/ems/attendance', {
        employee_id: effectiveEmployeeId,
        type,
        photo,
        ...(noPhoto ? { note: FLAG_NOTE } : {}),
      })

      if (!isOwner) {
        // Update the shared self-today cache OPTIMISTICALLY before invalidating,
        // so the gate (RequireAttendance reads this same key) sees clocked_in=true
        // immediately — no refetch race bouncing the user straight back here.
        queryClient.setQueryData<SelfAttendanceToday>(SELF_TODAY_QUERY_KEY, (prev) =>
          prev
            ? {
                ...prev,
                clocked_in: prev.clocked_in || type === 'TIME_IN',
                clocked_out: prev.clocked_out || type === 'TIME_OUT',
                last_type: type,
              }
            : prev,
        )
        void queryClient.invalidateQueries({ queryKey: SELF_TODAY_QUERY_KEY })

        if (type === 'TIME_IN') {
          toast.success(
            `Timed in at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${noPhoto ? ' (no photo, flagged)' : ''}`,
          )
          const fallback = user ? ROLE_LANDING[normalizeRole(user.role)] ?? '/' : '/'
          navigate(gateFrom ?? fallback, { replace: true })
          return
        }
      }

      setMsg({
        ok: `${type === 'TIME_IN' ? 'Timed in' : 'Timed out'}: ${effectiveName ?? ''} — ${new Date().toLocaleTimeString()}${noPhoto ? ' (no photo, flagged)' : ''}`,
      })
      loadPunches(effectiveEmployeeId)
    } catch (e) {
      if (e instanceof CKApiError && e.code === 'SELF_ONLY') {
        // Defensive: the backend rejected a punch for someone else's record —
        // should be unreachable through this locked UI, but say it plainly.
        toast.error('You can only record your own attendance.', {
          description: 'This punch was not saved. Refreshing your clock state…',
        })
        void queryClient.invalidateQueries({ queryKey: SELF_TODAY_QUERY_KEY })
      } else if (
        e instanceof CKApiError &&
        (e.code === 'ALREADY_TIMED_IN' ||
          e.code === 'NOT_TIMED_IN' ||
          e.code === 'ALREADY_TIMED_OUT')
      ) {
        // Server-enforced clock-state guard (no double time-in / time-out).
        // Say it plainly, then refresh so the buttons reflect the true state.
        toast.error(e.message || 'That punch is not allowed right now.')
        void queryClient.invalidateQueries({ queryKey: SELF_TODAY_QUERY_KEY })
        loadPunches(effectiveEmployeeId)
      } else {
        setMsg({ err: e instanceof Error ? e.message : 'Punch failed.' })
      }
    } finally {
      setSubmitting(null)
    }
  }

  // Non-OWNER button availability from today's clock state (refreshed after
  // every punch via the self-today invalidation above).
  const timeInDisabled = isOwner
    ? !effectiveEmployeeId || submitting !== null
    : !effectiveEmployeeId || submitting !== null || selfQuery.isPending || !!selfToday?.clocked_in
  const timeOutDisabled = isOwner
    ? !effectiveEmployeeId || submitting !== null
    : !effectiveEmployeeId ||
      submitting !== null ||
      selfQuery.isPending ||
      !selfToday?.clocked_in ||
      !!selfToday?.clocked_out

  return (
    <PageContainer>
      <PageHeader
        title="Attendance / DTR"
        subtitle={
          isOwner
            ? 'Photo-verified time clock — select an employee, face the camera, punch in or out'
            : 'Photo-verified time clock — face the camera and punch in or out'
        }
        actions={
          isOwner ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/kiosk/attendance">
                <MonitorSmartphone className="mr-2 h-4 w-4" /> Public kiosk
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Gate-redirect hint: RequireAttendance sent them here mid-navigation. */}
      {!isOwner && gateFrom && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <LogIn className="h-4 w-4 shrink-0" />
          Clock in to continue to the app.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Camera + punch ── */}
        <Card className="border-border bg-card p-5">
          <AttendanceCameraView
            videoRef={videoRef}
            camError={camError}
            onRetry={() => void startCamera()}
            errorHint="Camera unavailable — grant camera permission, or clock in without a photo (flagged for review)."
          />

          <div className="mt-4 space-y-3">
            {isOwner ? (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                  <Input
                    placeholder="Search your name or employee #…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select
                  value={employeeId}
                  onValueChange={(v) => {
                    setEmployeeId(v)
                    setMsg(null)
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {filtered.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-zinc-500">No matches</div>
                    ) : (
                      filtered.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.fullName} · {e.employeeNo} · {e.department}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </>
            ) : selfQuery.isPending ? (
              <div className="rounded-lg border border-border bg-background/40 p-4 text-sm text-zinc-500">
                Loading your employee record…
              </div>
            ) : selfQuery.isError ? (
              // Distinct from the "no employee linked" empty-state below — a
              // fetch failure must not read as "you have no profile".
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <span>Could not load your employee record — check the connection.</span>
                <Button size="sm" variant="outline" onClick={() => void selfQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : selfEmployee ? (
              // Locked identity card — no dropdown; punches are always self.
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center gap-3">
                  {selfEmployee.photoUrl ? (
                    <img
                      src={selfEmployee.photoUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300">
                      {selfEmployee.fullName
                        .split(/\s+/)
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-100">
                      {selfEmployee.fullName}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {selfEmployee.employeeNo} · {selfEmployee.department}
                    </div>
                  </div>
                  <BadgeCheck className="ml-auto h-5 w-5 shrink-0 text-emerald-400" />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  This is you — attendance is recorded for your own account only.
                </p>
              </div>
            ) : (
              // No linked employee — page still renders, punching unavailable.
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                <UserX className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No employee profile is linked to your account — ask an admin to link one on the
                  Employees page.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => punch('TIME_IN', { noPhoto: !!camError })}
                disabled={timeInDisabled}
                className={camError
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {submitting === 'TIME_IN' ? 'Submitting…' : camError ? 'Time In (no photo)' : 'Time In'}
              </Button>
              <Button
                onClick={() => punch('TIME_OUT', { noPhoto: !!camError })}
                disabled={timeOutDisabled}
                variant="outline"
                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {submitting === 'TIME_OUT' ? 'Submitting…' : camError ? 'Time Out (no photo)' : 'Time Out'}
              </Button>
            </div>
            {!isOwner && selfToday?.clocked_in && !selfToday.clocked_out && (
              <p className="text-xs text-zinc-500">
                You are clocked in for today — Time In is disabled until tomorrow.
              </p>
            )}
            {camError && (
              <p className="text-xs text-amber-400/80">
                Camera unavailable — punches will be recorded without a photo and flagged for review.
              </p>
            )}

            {msg?.ok && (
              <p className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> {msg.ok}
              </p>
            )}
            {msg?.err && (
              <p className="flex items-center gap-2 text-sm text-red-400">
                <CircleAlert className="h-4 w-4" /> {msg.err}
              </p>
            )}
          </div>
        </Card>

        {/* ── Recent punches for the employee in scope ── */}
        <Card className="border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <UserCheck className="h-4 w-4 text-zinc-400" />
            {effectiveName ? `${effectiveName} — recent punches` : 'Recent punches'}
          </div>
          {!effectiveEmployeeId ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {isOwner
                ? 'Select an employee to see their latest punches.'
                : 'Your recent punches will show here once an employee profile is linked.'}
            </p>
          ) : punches.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              No punches yet{effectiveName ? ` for ${effectiveName}` : ''}.
            </p>
          ) : (
            <ul className="space-y-2">
              {punches.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-2">
                  <img src={p.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.type === 'TIME_IN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {p.type}
                      </span>
                      {p.status === 'FORFEITED' && (
                        <span
                          title="Timed in but never timed out within 24 hours; no time credited. HR can correct manually."
                          className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                        >
                          FORFEITED — no time-out
                        </span>
                      )}
                      {p.status === 'OPEN' && (
                        <span className="inline-flex items-center rounded-full bg-zinc-700/40 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                          OPEN
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{fmtTime(p.capturedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  )
}

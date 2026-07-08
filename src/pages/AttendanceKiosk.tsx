import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LogIn,
  LogOut,
  MonitorOff,
  RefreshCw,
  Search,
} from 'lucide-react'
import { get, post, CKApiError } from '../lib/api'
import { useAttendanceCamera, AttendanceCameraView } from '../components/AttendanceCamera'
import { Toaster } from '../components/ui/sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

/**
 * Public attendance kiosk — /kiosk/attendance (CK1-EMS-005 §3).
 *
 * UNAUTHENTICATED BY DESIGN: registered in App.tsx OUTSIDE <RequireAuth/>
 * (like /login) and absent from PAGE_ROLES — a shared wall-mounted tablet
 * where any staff member clocks in/out by tapping their name and taking a
 * photo. The mandatory photo is the identity evidence; the backend audits
 * every punch under the "Public" actor (POST /public/attendance).
 *
 * Fullscreen, no AppShell chrome (same no-shell pattern as Tv.tsx), dark,
 * big touch targets. Flow: live clock header → searchable employee grid
 * (GET /public/attendance/employees, filterable by department) → camera
 * capture step (shared AttendanceCamera plumbing with Attendance.tsx; photo
 * is REQUIRED — no capture, no punch, no placeholder fallback here) → big
 * TIME IN / TIME OUT buttons → success splash that auto-resets to the list
 * after ~4 s. Failures toast and stay on the capture step.
 *
 * Feature flag: PUBLIC_ATTENDANCE_ENABLED=false makes both endpoints 404 —
 * rendered here as a dedicated "Kiosk is disabled" screen.
 */

interface PublicEmployee {
  id: string
  employeeNo: string
  fullName: string
  department: string
}

type PunchType = 'TIME_IN' | 'TIME_OUT'

type Step =
  | { kind: 'list' }
  | { kind: 'capture'; employee: PublicEmployee }
  | { kind: 'success'; name: string; type: PunchType; at: Date }

const SUCCESS_RESET_MS = 4_000

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtClockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function fmtPunchTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// ─── Capture step (own component so the camera starts on mount / stops on unmount) ──

interface KioskCaptureProps {
  employee: PublicEmployee
  onBack: () => void
  onSuccess: (type: PunchType, at: Date) => void
  onDisabled: () => void
}

function KioskCapture({ employee, onBack, onSuccess, onDisabled }: KioskCaptureProps) {
  const { videoRef, camError, startCamera, captureFrame } = useAttendanceCamera()
  const [captured, setCaptured] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<PunchType | null>(null)

  function capture() {
    const frame = captureFrame()
    if (!frame) {
      toast.error('Camera not ready — cannot capture the photo yet.')
      return
    }
    setCaptured(frame)
  }

  async function punch(type: PunchType) {
    // Photo is MANDATORY on the public kiosk — it is the only identity
    // evidence on an unauthenticated punch. No capture, no punch.
    if (!captured) return
    setSubmitting(type)
    try {
      await post('/public/attendance', {
        employee_id: employee.id,
        type,
        photo: captured,
      })
      onSuccess(type, new Date())
    } catch (e) {
      if (e instanceof CKApiError && e.status === 404) {
        // Flag flipped off between page load and this punch.
        onDisabled()
        return
      }
      toast.error(e instanceof Error ? e.message : 'Punch failed — please try again.')
      setSubmitting(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="lg" className="h-12 px-5 text-base" onClick={onBack}>
          <ArrowLeft className="mr-2 h-5 w-5" /> Back
        </Button>
        <div className="min-w-0 text-right">
          <div className="truncate text-xl font-semibold text-zinc-50">{employee.fullName}</div>
          <div className="text-sm text-zinc-500">
            {employee.employeeNo} · {employee.department}
          </div>
        </div>
      </div>

      {captured ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
          <img src={captured} alt="Captured attendance selfie" className="h-full w-full object-cover" />
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> PHOTO CAPTURED
          </span>
        </div>
      ) : (
        <AttendanceCameraView
          videoRef={videoRef}
          camError={camError}
          onRetry={() => void startCamera()}
          errorHint="Camera unavailable — a photo is required to punch on the kiosk. Grant camera permission and retry."
          className="rounded-xl"
        />
      )}

      <div className="mt-4 grid gap-3">
        {captured ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => void punch('TIME_IN')}
                disabled={submitting !== null}
                className="h-20 bg-emerald-600 text-xl font-semibold text-white hover:bg-emerald-500"
              >
                <LogIn className="mr-3 h-6 w-6" />
                {submitting === 'TIME_IN' ? 'Submitting…' : 'TIME IN'}
              </Button>
              <Button
                onClick={() => void punch('TIME_OUT')}
                disabled={submitting !== null}
                variant="outline"
                className="h-20 border-amber-500/40 text-xl font-semibold text-amber-300 hover:bg-amber-500/10"
              >
                <LogOut className="mr-3 h-6 w-6" />
                {submitting === 'TIME_OUT' ? 'Submitting…' : 'TIME OUT'}
              </Button>
            </div>
            <Button
              variant="outline"
              size="lg"
              className="h-12 text-base"
              disabled={submitting !== null}
              onClick={() => setCaptured(null)}
            >
              <RefreshCw className="mr-2 h-5 w-5" /> Retake photo
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={capture}
              disabled={!!camError}
              className="h-20 bg-emerald-600 text-xl font-semibold text-white hover:bg-emerald-500"
            >
              <Camera className="mr-3 h-6 w-6" /> Capture photo
            </Button>
            <p className="text-center text-sm text-zinc-500">
              A photo is required — face the camera, then capture before punching in or out.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Kiosk page ───────────────────────────────────────────────────────────────

export default function AttendanceKiosk() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(t)
  }, [])

  const [step, setStep] = useState<Step>({ kind: 'list' })
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState<string>('ALL')
  // Sticky "flag off" state — settable from a punch-time 404 too, so the whole
  // page flips to the disabled screen, not just the list query.
  const [disabledByFlag, setDisabledByFlag] = useState(false)

  const employeesQuery = useQuery({
    queryKey: ['kiosk', 'public-employees'],
    queryFn: async () => (await get<PublicEmployee[]>('/public/attendance/employees')).data,
    staleTime: 60_000,
    // Don't retry: a 404 here means the feature flag is OFF — show the
    // disabled screen immediately instead of retrying a deliberate 404.
    retry: false,
  })

  const flagOff =
    disabledByFlag ||
    (employeesQuery.error instanceof CKApiError && employeesQuery.error.status === 404)

  const departments = useMemo(() => {
    const set = new Set((employeesQuery.data ?? []).map((e) => e.department).filter(Boolean))
    return ['ALL', ...Array.from(set).sort()]
  }, [employeesQuery.data])

  const filtered = useMemo(() => {
    const list = employeesQuery.data ?? []
    const q = search.trim().toLowerCase()
    return list
      .filter((e) => department === 'ALL' || e.department === department)
      .filter(
        (e) =>
          !q || e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [employeesQuery.data, search, department])

  // Success splash auto-reset (~4 s), or tap anywhere to continue.
  useEffect(() => {
    if (step.kind !== 'success') return
    const t = setTimeout(() => setStep({ kind: 'list' }), SUCCESS_RESET_MS)
    return () => clearTimeout(t)
  }, [step])

  function resetToList() {
    setStep({ kind: 'list' })
    setSearch('')
  }

  // ── Feature flag off → dedicated disabled screen ───────────────────────────
  if (flagOff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-8 text-center text-zinc-100">
        <MonitorOff className="h-14 w-14 text-zinc-600" />
        <h1 className="text-3xl font-bold tracking-tight">Kiosk is disabled</h1>
        <p className="max-w-md text-base text-zinc-500">
          The public attendance kiosk has been turned off by an administrator. Staff can still
          clock in from their own account on the Attendance page.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ── Clock + date header ── */}
      <header className="flex flex-col items-center gap-1 border-b border-zinc-800 px-6 py-6">
        <div className="flex items-center gap-3 text-5xl font-bold tabular-nums tracking-tight sm:text-6xl">
          <Clock3 className="h-10 w-10 text-emerald-400" aria-hidden />
          {fmtClockTime(now)}
        </div>
        <div className="text-base text-zinc-400 sm:text-lg">{fmtDate(now)}</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-emerald-500/80">
          Attendance kiosk — tap your name to clock in or out
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {step.kind === 'success' ? (
          // ── Success splash (auto-resets; tap to skip the wait) ──
          <button
            type="button"
            onClick={resetToList}
            className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center gap-4 text-center"
          >
            <CheckCircle2 className="h-24 w-24 text-emerald-400" />
            <div className="text-4xl font-bold tracking-tight sm:text-5xl">
              {greeting(step.at)}, {step.name.split(/\s+/)[0]}!
            </div>
            <div
              className={cn(
                'text-2xl font-semibold',
                step.type === 'TIME_IN' ? 'text-emerald-300' : 'text-amber-300',
              )}
            >
              {step.type === 'TIME_IN' ? 'Timed in' : 'Timed out'} at {fmtPunchTime(step.at)}
            </div>
            <div className="mt-2 text-sm text-zinc-500">Returning to the list… tap to continue</div>
          </button>
        ) : step.kind === 'capture' ? (
          <KioskCapture
            employee={step.employee}
            onBack={resetToList}
            onSuccess={(type, at) =>
              setStep({ kind: 'success', name: step.employee.fullName, type, at })
            }
            onDisabled={() => setDisabledByFlag(true)}
          />
        ) : (
          // ── Employee list ──
          <div className="mx-auto w-full max-w-5xl">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-3.5 h-5 w-5 text-zinc-500" />
              <Input
                placeholder="Search your name or employee #…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-12 pl-10 text-base"
              />
            </div>

            {departments.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {departments.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDepartment(d)}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                      department === d
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                    )}
                  >
                    {d === 'ALL' ? 'All departments' : d}
                  </button>
                ))}
              </div>
            )}

            {employeesQuery.isPending ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
              </div>
            ) : employeesQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <CircleAlert className="h-8 w-8 text-red-400" />
                <p className="text-base text-zinc-400">
                  Could not load the employee list — check the connection.
                </p>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 px-5 text-base"
                  onClick={() => void employeesQuery.refetch()}
                >
                  <RefreshCw className="mr-2 h-5 w-5" /> Retry
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-base text-zinc-500">
                No matching employees{search ? ` for “${search}”` : ''}.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setStep({ kind: 'capture', employee: e })}
                    className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-zinc-900/60 active:bg-emerald-500/10"
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-semibold text-emerald-300">
                      {initials(e.fullName)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-zinc-100">{e.fullName}</div>
                      <div className="truncate text-sm text-zinc-500">
                        {e.employeeNo} · {e.department}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* This page renders OUTSIDE AppShell (which owns the app's Toaster),
          so it mounts its own for punch-failure toasts. */}
      <Toaster richColors theme="dark" position="top-center" />
    </div>
  )
}

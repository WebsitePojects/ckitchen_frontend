import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronRight as Crumb,
  History,
  KeyRound,
  ListChecks,
  Store,
  UserX,
  Wallet,
} from 'lucide-react'
import { get, CKApiError } from '../lib/api'
import { cn } from '../lib/utils'
import { useAuth } from '../auth/AuthContext'
import { hasRole, normalizeRole, ROLE_LANDING } from '../auth/access'
import { usePermissions } from '../context/PermissionsContext'
import { DAY_LABEL, WORK_DAYS, formatWorkDays, sanitizeWorkDays } from '../lib/workdays'
import PhotoLightbox, { photoThumbUrl, type LightboxPhoto } from '../components/PhotoLightbox'
import PageContainer from '../components/layout/PageContainer'
import StatusBadge from '../components/common/StatusBadge'
import EmptyState from '../components/common/EmptyState'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

// ---------------------------------------------------------------------------
// Types — mirror GET /employees/:id/profile (Employee 360 backend contract).
// Read defensively: workDays/hiredAt (and the whole profile endpoint) may be
// absent on an old deploy; the page degrades to header + punch history.
// ---------------------------------------------------------------------------

interface ProfileEmployee {
  id: string
  employeeNo: string
  fullName: string
  department: string
  position: string | null
  photoUrl: string | null
  status: string
  workDays?: string[] | null
  hiredAt?: string | null
  // Outlet assignment (T1) — absent entirely on an old deploy, null = HQ/unassigned.
  locationId?: string | null
  userId: string | null
  createdAt: string
}

/** Minimal shape consumed from GET /outlets (see pages/Outlets.tsx for the full row). */
interface OutletOption {
  id: string
  name: string
}

type DayStatus = 'PRESENT' | 'ABSENT' | 'REST' | 'FUTURE' | 'FORFEITED' | 'OPEN'

interface ProfilePunch {
  at: string
  photo_url: string | null
}

interface ProfileDay {
  date: string
  scheduled: boolean
  status: DayStatus
  time_in: ProfilePunch | null
  time_out: ProfilePunch | null
  worked_minutes: number | null
}

interface ProfileStats {
  scheduled_days: number
  present_days: number
  absent_days: number
  rest_days: number
  forfeited: number
  open: number
  total_worked_minutes: number
}

interface ProfileResponse {
  employee: ProfileEmployee
  month: string
  stats: ProfileStats
  days: ProfileDay[]
}

/** GET /ems/attendance row (live endpoint). `status` is a newer DTR add-on. */
interface Punch {
  id: string
  employeeId: string
  type: 'TIME_IN' | 'TIME_OUT'
  photoUrl: string
  capturedAt: string
  note: string | null
  status?: string | null
}

/** GET /admin/users/:id/performance (OWNER-only) — see UserPerformanceDialog. */
interface PerformanceReport {
  user: { id: string; name: string; role: string }
  period: { from: string; to: string }
  activity: { total: number; byAction: Array<{ action: string; count: number }> }
  ordersHandled: number
  outlet: { locationIds: string[]; orders: number; revenue: number }
}

interface ActivityRow {
  id: string
  action: string
  description: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Formatting / month helpers
// ---------------------------------------------------------------------------

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtPunchCaptionTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtWorked(mins: number | null | undefined): string {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** "Thursday, July 9, 2026" from a plain YYYY-MM-DD (UTC-pinned, no TZ drift). */
function fmtDayTitle(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "March 3, 2025" from YYYY-MM-DD or a full ISO timestamp. */
function fmtDate(dateish: string): string {
  return new Date(`${dateish.slice(0, 10)}T00:00:00Z`).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function money(n: number | undefined): string {
  return `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

// ---------------------------------------------------------------------------
// Day-status styling (calendar cells + badges)
// ---------------------------------------------------------------------------

const DAY_CELL_CLASS: Record<DayStatus, string> = {
  PRESENT: 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20',
  ABSENT: 'border-red-500/40 bg-red-500/10 hover:bg-red-500/20',
  REST: 'border-border bg-zinc-800/40 hover:bg-zinc-800/70',
  FORFEITED: 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20',
  OPEN: 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20',
  FUTURE: 'border-border/60 bg-transparent',
}

const DAY_NUM_CLASS: Record<DayStatus, string> = {
  PRESENT: 'text-emerald-300',
  ABSENT: 'text-red-300',
  REST: 'text-zinc-500',
  FORFEITED: 'text-amber-300',
  OPEN: 'text-amber-300',
  FUTURE: 'text-zinc-600',
}

const DAY_BADGE_CLASS: Record<DayStatus, string> = {
  PRESENT: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ABSENT: 'bg-red-500/15 text-red-300 border-red-500/30',
  REST: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  FORFEITED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  OPEN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  FUTURE: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
}

const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  REST: 'Rest day',
  FORFEITED: 'Forfeited',
  OPEN: 'Open (no time out)',
  FUTURE: 'Upcoming',
}

function DayStatusPill({ status }: { status: DayStatus }) {
  return (
    <Badge variant="outline" className={DAY_BADGE_CLASS[status]}>
      {DAY_STATUS_LABEL[status]}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Small stat tile with per-metric tone (KpiCard's fixed emerald icon square
// can't express "Absent turns red", so the stats row uses these instead).
// ---------------------------------------------------------------------------

type Tone = 'emerald' | 'red' | 'amber' | 'zinc'

const TONE_VALUE: Record<Tone, string> = {
  emerald: 'text-emerald-300',
  red: 'text-red-300',
  amber: 'text-amber-300',
  zinc: 'text-zinc-100',
}

function StatTile({
  label,
  value,
  hint,
  tone = 'zinc',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: Tone
}) {
  return (
    <Card className="border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums', TONE_VALUE[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PUNCH_PAGE = 50
const PUNCH_MAX = 500 // backend clamps limit at 500

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()

  // OWNER-only (same idiom as Employees.tsx — empty allow-list means only the
  // OWNER short-circuit passes). Gates the admin performance/activity fetches.
  const isOwner = hasRole(user?.role, [])

  /**
   * Access gate (T1): this route is registered OUTSIDE <RequireAccess> in
   * App.tsx because that guard matches the RAW pathname ('/employees/<uuid>')
   * against page keys, and the persisted RBAC matrix (/me/permissions) only
   * ever contains parent keys like '/employees' — the Set lookup would bounce
   * every non-OWNER even when they're allowed on Employees. Inheriting the
   * parent page's permission here (matrix-aware via canAccessPage, fail-open
   * to code defaults) is the minimal correct match, and the bounce target
   * mirrors RequireAccess exactly.
   */
  const allowed = !!user && canAccessPage('/employees')

  const [month, setMonth] = useState(currentMonthStr)
  const [selectedDay, setSelectedDay] = useState<ProfileDay | null>(null)
  const [punchLimit, setPunchLimit] = useState(PUNCH_PAGE)
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)

  // ── Profile (month-scoped) ────────────────────────────────────────────────
  const profileQuery = useQuery({
    queryKey: ['employees', id, 'profile', month],
    queryFn: async () =>
      (await get<ProfileResponse>(`/employees/${id}/profile?month=${month}`)).data,
    enabled: allowed && !!id,
    placeholderData: keepPreviousData, // month nav keeps the last grid while loading
    // Don't burn retries on a 4xx (endpoint missing on an old deploy / bad id).
    retry: (count, err) =>
      count < 2 && !(err instanceof CKApiError && err.status != null && err.status < 500),
  })

  // Old-deploy fallback: if the profile endpoint isn't there yet, still render
  // the header from the plain list + the live punch history below.
  const fallbackQuery = useQuery({
    queryKey: ['employees', 'list'],
    queryFn: async () => (await get<ProfileEmployee[]>('/employees')).data,
    enabled: allowed && !!id && profileQuery.isError,
  })

  const employee: ProfileEmployee | null =
    profileQuery.data?.employee ?? fallbackQuery.data?.find((e) => e.id === id) ?? null
  const stats = profileQuery.data?.stats
  const days = profileQuery.data?.days ?? []

  // ── Punch history (limit-grow pagination; endpoint has no offset param) ───
  const punchesQuery = useQuery({
    queryKey: ['ems', 'attendance', id, punchLimit],
    queryFn: async () =>
      (await get<Punch[]>(`/ems/attendance?employee_id=${id}&limit=${punchLimit}`)).data,
    enabled: allowed && !!id,
    placeholderData: keepPreviousData,
  })
  const punches = punchesQuery.data ?? []
  const punchesMaybeMore = punches.length >= punchLimit && punchLimit < PUNCH_MAX
  const punchesHaveStatus = punches.some((p) => p.status != null)

  // ── Performance + activity (OWNER viewing a linked login only) ────────────
  const perfRange = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const endStr = `${month}-${String(lastDay).padStart(2, '0')}`
    const todayStr = new Date().toISOString().slice(0, 10)
    return {
      from: `${month}-01T00:00:00.000Z`,
      to: `${endStr < todayStr ? endStr : todayStr}T23:59:59.999Z`,
    }
  }, [month])

  const linkedUserId = employee?.userId ?? null
  const perfQuery = useQuery({
    queryKey: ['admin', 'users', linkedUserId, 'performance', perfRange.from, perfRange.to],
    queryFn: async () => {
      const params = new URLSearchParams({ from: perfRange.from, to: perfRange.to })
      return (await get<PerformanceReport>(`/admin/users/${linkedUserId}/performance?${params}`)).data
    },
    enabled: allowed && isOwner && !!linkedUserId,
  })
  const activityQuery = useQuery({
    queryKey: ['admin', 'users', linkedUserId, 'activity'],
    queryFn: async () => (await get<ActivityRow[]>(`/admin/users/${linkedUserId}/activity`)).data,
    enabled: allowed && isOwner && !!linkedUserId,
  })

  // Outlet name lookup for the header chip (T1). Same queryKey as
  // Employees.tsx's outlets query so the two pages share one cached fetch.
  const outletsQuery = useQuery({
    queryKey: ['outlets', 'options'],
    queryFn: async () => (await get<OutletOption[]>('/outlets')).data,
    enabled: allowed,
  })

  // ── Guards (after all hooks) ──────────────────────────────────────────────
  if (!user) return null
  if (!allowed) {
    const landing = ROLE_LANDING[normalizeRole(user.role)] ?? '/'
    return <Navigate to={landing} replace />
  }

  const loadingIdentity = profileQuery.isPending || (profileQuery.isError && fallbackQuery.isPending)

  if (!employee && loadingIdentity) {
    return (
      <PageContainer>
        <Breadcrumb name="Loading…" />
        <p className="text-sm text-zinc-500">Loading employee profile…</p>
      </PageContainer>
    )
  }

  if (!employee) {
    return (
      <PageContainer>
        <Breadcrumb name="Not found" />
        <EmptyState
          icon={UserX}
          title="Employee not found"
          description="This employee may have been removed, or the link is stale."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/employees">Back to Employees</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const workDays = sanitizeWorkDays(employee.workDays)
  const isCurrentMonth = month >= currentMonthStr()
  // Outlet chip (T1) — omitted silently when locationId is absent (old
  // deploy) or null (unassigned/HQ), or while the outlets list is loading.
  const outletName = employee.locationId
    ? outletsQuery.data?.find((o) => o.id === employee.locationId)?.name
    : undefined

  // Calendar layout: leading blanks so day 1 lands on its true weekday column.
  const firstDow = new Date(`${month}-01T00:00:00Z`).getUTCDay() // 0 = Sun

  function openDayPhotos(day: ProfileDay, which: 'in' | 'out') {
    const photos: LightboxPhoto[] = []
    if (day.time_in?.photo_url) {
      photos.push({
        url: day.time_in.photo_url,
        caption: `Time in — ${fmtPunchCaptionTime(day.time_in.at)} — ${employee!.fullName}`,
      })
    }
    if (day.time_out?.photo_url) {
      photos.push({
        url: day.time_out.photo_url,
        caption: `Time out — ${fmtPunchCaptionTime(day.time_out.at)} — ${employee!.fullName}`,
      })
    }
    if (photos.length === 0) return
    const index = which === 'out' && photos.length > 1 ? 1 : 0
    setLightbox({ photos, index })
  }

  function openPunchPhoto(p: Punch) {
    setLightbox({
      photos: [
        {
          url: p.photoUrl,
          caption: `${p.type === 'TIME_IN' ? 'Time in' : 'Time out'} — ${fmtPunchCaptionTime(p.capturedAt)} — ${employee!.fullName}`,
        },
      ],
      index: 0,
    })
  }

  return (
    <PageContainer>
      <Breadcrumb name={employee.fullName} />

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <Card className="border-border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          {employee.photoUrl ? (
            <button
              type="button"
              onClick={() =>
                setLightbox({
                  photos: [{ url: employee.photoUrl!, caption: employee.fullName }],
                  index: 0,
                })
              }
              className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
              aria-label={`View ${employee.fullName}'s photo`}
            >
              <img
                src={photoThumbUrl(employee.photoUrl, 160)}
                alt=""
                className="h-20 w-20 rounded-full object-cover ring-2 ring-emerald-500/30"
              />
            </button>
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xl font-semibold text-emerald-300 ring-2 ring-emerald-500/30">
              {initials(employee.fullName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-50">{employee.fullName}</h2>
              <StatusBadge status={employee.status} />
              {employee.userId ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  <KeyRound className="h-3 w-3" /> Login linked
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-zinc-500/30 bg-zinc-500/10 text-zinc-400">
                  No login account
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              <span className="font-mono text-xs text-zinc-500">{employee.employeeNo}</span>
              {' · '}
              {employee.department.charAt(0) + employee.department.slice(1).toLowerCase()}
              {employee.position ? ` · ${employee.position}` : ''}
              {outletName && (
                <span className="ml-2 inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                  {outletName}
                </span>
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              {/* Schedule chips — all 7 days, working days lit */}
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
                {workDays.length === 0 ? (
                  <span className="text-sm text-zinc-500">Schedule: —</span>
                ) : (
                  <div className="flex gap-1">
                    {WORK_DAYS.map((d) => (
                      <span
                        key={d}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          workDays.includes(d)
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-zinc-800/60 text-zinc-600',
                        )}
                      >
                        {DAY_LABEL[d]}
                      </span>
                    ))}
                  </div>
                )}
                {workDays.length > 0 && (
                  <span className="ml-1 text-xs text-zinc-500">({formatWorkDays(workDays)})</span>
                )}
              </div>
              <span className="flex items-center gap-1.5 text-sm text-zinc-400">
                <BadgeCheck className="h-3.5 w-3.5 text-zinc-500" />
                {employee.hiredAt ? `Hired ${fmtDate(employee.hiredAt)}` : 'Hire date not set'}
              </span>
            </div>
          </div>

          {/* Month navigation */}
          <div className="flex items-center gap-1 self-center rounded-lg border border-border bg-background/40 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-36 text-center text-sm font-medium tabular-nums text-zinc-200">
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={isCurrentMonth}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Month summary + calendar ─────────────────────────────────────── */}
      {profileQuery.isError ? (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          Monthly attendance summary isn't available —{' '}
          {errMsg(profileQuery.error, 'the server may not support employee profiles yet.')} Punch
          history below still reflects live data.
        </Card>
      ) : !stats && profileQuery.isPending ? (
        <p className="text-sm text-zinc-500">Loading month summary…</p>
      ) : stats ? (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Present"
              value={stats.present_days}
              hint={`of ${stats.scheduled_days} scheduled`}
              tone="emerald"
            />
            <StatTile
              label="Absent"
              value={stats.absent_days}
              tone={stats.absent_days > 0 ? 'red' : 'zinc'}
              hint="scheduled, no punch"
            />
            <StatTile label="Rest days" value={stats.rest_days} tone="zinc" hint="off-schedule" />
            <StatTile
              label="Forfeited"
              value={stats.forfeited}
              tone={stats.forfeited > 0 ? 'amber' : 'zinc'}
              hint={stats.open > 0 ? `+ ${stats.open} open` : 'no time out'}
            />
            <StatTile
              label="Total worked"
              value={fmtWorked(stats.total_worked_minutes)}
              tone="emerald"
              hint={monthLabel(month)}
            />
          </div>

          {/* Calendar */}
          <Card className="border-border bg-card p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                >
                  {d}
                </div>
              ))}
              {Array.from({ length: firstDow }, (_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {days.map((day) => {
                const dayNum = Number(day.date.slice(8, 10))
                const clickable = day.status !== 'FUTURE'
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={!clickable}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      'flex min-h-[4.5rem] flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left transition-colors',
                      DAY_CELL_CLASS[day.status],
                      clickable ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <span
                      className={cn('text-xs font-semibold tabular-nums', DAY_NUM_CLASS[day.status])}
                    >
                      {dayNum}
                    </span>
                    {day.time_in && (
                      <span className="text-[10px] tabular-nums text-zinc-400">
                        in {fmtClock(day.time_in.at)}
                      </span>
                    )}
                    {day.time_out && (
                      <span className="text-[10px] tabular-nums text-zinc-400">
                        out {fmtClock(day.time_out.at)}
                      </span>
                    )}
                    {!day.time_in && day.status === 'REST' && (
                      <span className="text-[10px] text-zinc-600">rest</span>
                    )}
                    {day.status === 'ABSENT' && (
                      <span className="text-[10px] text-red-400/80">absent</span>
                    )}
                    {(day.status === 'FORFEITED' || day.status === 'OPEN') && (
                      <span className="text-[10px] text-amber-400/80">
                        {day.status === 'OPEN' ? 'open' : 'forfeited'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
              {(
                [
                  ['PRESENT', 'Present'],
                  ['ABSENT', 'Absent'],
                  ['REST', 'Rest day'],
                  ['FORFEITED', 'Forfeited / open'],
                  ['FUTURE', 'Upcoming'],
                ] as Array<[DayStatus, string]>
              ).map(([s, label]) => (
                <span key={s} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span className={cn('h-2.5 w-2.5 rounded-sm border', DAY_CELL_CLASS[s])} />
                  {label}
                </span>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {/* ── Punch history ────────────────────────────────────────────────── */}
      <Card className="border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <History className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Punch history</h3>
          <span className="ml-auto text-xs text-zinc-500">
            {punches.length} record{punches.length === 1 ? '' : 's'}
          </span>
        </div>
        {punchesQuery.isPending ? (
          <p className="p-6 text-sm text-zinc-500">Loading punches…</p>
        ) : punchesQuery.isError ? (
          <p className="p-6 text-sm text-red-400">
            {errMsg(punchesQuery.error, 'Failed to load punch history.')}
          </p>
        ) : punches.length === 0 ? (
          <EmptyState
            icon={History}
            title="No punches recorded"
            description="Time-clock punches for this employee will appear here."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Photo</TableHead>
                  {punchesHaveStatus && <TableHead>Status</TableHead>}
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {punches.map((p) => (
                  <TableRow key={p.id} className="border-border">
                    <TableCell className="whitespace-nowrap text-sm text-zinc-300">
                      {new Date(p.capturedAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          p.type === 'TIME_IN'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300',
                        )}
                      >
                        {p.type === 'TIME_IN' ? 'TIME IN' : 'TIME OUT'}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-zinc-300">
                      {fmtClock(p.capturedAt)}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openPunchPhoto(p)}
                        className="rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        aria-label="View punch photo"
                      >
                        <img
                          src={photoThumbUrl(p.photoUrl, 80)}
                          alt=""
                          className="h-10 w-10 rounded object-cover transition-opacity hover:opacity-80"
                        />
                      </button>
                    </TableCell>
                    {punchesHaveStatus && (
                      <TableCell>
                        {p.status ? <StatusBadge status={p.status} /> : <span className="text-zinc-600">—</span>}
                      </TableCell>
                    )}
                    <TableCell className="max-w-[16rem] truncate text-xs text-zinc-500">
                      {p.note ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {punchesMaybeMore && (
              <div className="border-t border-border p-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={punchesQuery.isFetching}
                  onClick={() => setPunchLimit((l) => Math.min(l + PUNCH_PAGE, PUNCH_MAX))}
                >
                  {punchesQuery.isFetching ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
            {punchLimit >= PUNCH_MAX && punches.length >= PUNCH_MAX && (
              <p className="border-t border-border p-3 text-center text-xs text-zinc-600">
                Showing the latest {PUNCH_MAX} punches (server limit).
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── Performance (OWNER viewing a linked login) ───────────────────── */}
      {isOwner && (
        <Card className="border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <BarChart3 className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Performance &amp; activity</h3>
            {linkedUserId && (
              <span className="ml-auto text-xs text-zinc-500">{monthLabel(month)}</span>
            )}
          </div>
          <div className="p-5">
            {!linkedUserId ? (
              <p className="flex items-center gap-2 text-sm text-zinc-500">
                <UserX className="h-4 w-4 shrink-0" />
                No login account linked — attendance stats above are the full picture for this
                employee.
              </p>
            ) : perfQuery.isPending ? (
              <p className="text-sm text-zinc-500">Loading performance…</p>
            ) : perfQuery.isError ? (
              <p className="text-sm text-red-400">
                {errMsg(perfQuery.error, 'Failed to load performance.')}
              </p>
            ) : perfQuery.data ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat icon={Activity} label="Activity" value={perfQuery.data.activity.total} hint="audited actions" />
                  <MiniStat icon={ListChecks} label="Orders handled" value={perfQuery.data.ordersHandled} hint="stages advanced" />
                  <MiniStat icon={Store} label="Outlet orders" value={perfQuery.data.outlet.orders} hint="excl. cancelled" />
                  <MiniStat icon={Wallet} label="Outlet revenue" value={money(perfQuery.data.outlet.revenue)} hint="excl. cancelled" />
                </div>

                {perfQuery.data.activity.byAction.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-zinc-400">Top actions</p>
                    <div className="flex flex-wrap gap-1.5">
                      {perfQuery.data.activity.byAction.slice(0, 6).map((a) => (
                        <span
                          key={a.action}
                          className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 font-mono text-[11px] text-emerald-400"
                        >
                          {a.action}
                          <span className="text-zinc-500">×{a.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-400">Recent activity</p>
                  {activityQuery.isPending ? (
                    <p className="text-sm text-zinc-500">Loading…</p>
                  ) : (activityQuery.data ?? []).length === 0 ? (
                    <p className="text-xs text-zinc-600">No audited actions yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(activityQuery.data ?? []).slice(0, 8).map((r) => (
                        <li key={r.id} className="flex items-baseline gap-3 text-sm">
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            {new Date(r.createdAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">
                            {r.action}
                          </span>
                          <span className="truncate text-xs text-zinc-500">{r.description ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      )}

      {/* ── Day detail dialog ────────────────────────────────────────────── */}
      <Dialog open={selectedDay != null} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <DialogContent className="sm:max-w-md">
          {selectedDay && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span>{fmtDayTitle(selectedDay.date)}</span>
                  <DayStatusPill status={selectedDay.status} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                {!selectedDay.scheduled && (
                  <p className="text-xs text-zinc-500">Not a scheduled working day.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ['in', 'Time in', selectedDay.time_in],
                      ['out', 'Time out', selectedDay.time_out],
                    ] as Array<['in' | 'out', string, ProfilePunch | null]>
                  ).map(([which, label, punch]) => (
                    <div key={which} className="rounded-lg border border-border bg-background/40 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {label}
                      </p>
                      {punch ? (
                        <>
                          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                            {fmtClock(punch.at)}
                          </p>
                          {punch.photo_url ? (
                            <button
                              type="button"
                              onClick={() => openDayPhotos(selectedDay, which)}
                              className="mt-2 block w-full overflow-hidden rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              aria-label={`View ${label.toLowerCase()} photo`}
                            >
                              <img
                                src={photoThumbUrl(punch.photo_url, 320)}
                                alt=""
                                className="h-28 w-full rounded object-cover transition-opacity hover:opacity-80"
                              />
                            </button>
                          ) : (
                            <p className="mt-2 text-xs text-zinc-600">No photo</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-zinc-600">—</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                  <span className="text-xs text-zinc-500">Worked time</span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-100">
                    {fmtWorked(selectedDay.worked_minutes)}
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      <PhotoLightbox
        photos={lightbox?.photos ?? []}
        initialIndex={lightbox?.index ?? 0}
        open={lightbox != null}
        onOpenChange={(o) => !o && setLightbox(null)}
      />
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link to="/employees" className="text-zinc-400 transition-colors hover:text-zinc-200">
        Employees
      </Link>
      <Crumb className="h-3.5 w-3.5 text-zinc-600" />
      <span className="font-medium text-zinc-100">{name}</span>
    </nav>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
    </div>
  )
}

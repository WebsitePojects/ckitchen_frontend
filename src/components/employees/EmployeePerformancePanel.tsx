import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Activity, BarChart3, CalendarCheck, ClipboardList, HardHat, ListChecks, LogIn, Plus, Star } from 'lucide-react'
import { get, post, CKApiError } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'

/**
 * Employee performance, two sources (D58):
 *   - System activity: only for employees with a login. What their audit trail shows.
 *   - Performance log: manual notes by owners / HR / managers. Every employee, and the only
 *     record for staff-only people. Append-only: a wrong note is voided with a reason.
 * Attendance (working days, hours) is shared by everyone and lives above this panel.
 */

export const NOTE_KINDS = ['COMMENDATION', 'CONCERN', 'REVIEW', 'INCIDENT', 'NOTE'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

const KIND_LABEL: Record<NoteKind, string> = {
  COMMENDATION: 'Commendation',
  CONCERN: 'Concern',
  REVIEW: 'Review',
  INCIDENT: 'Incident',
  NOTE: 'Note',
}

/** Dot colour per kind; the label always travels with it, so colour is never the only cue. */
const KIND_DOT: Record<NoteKind, string> = {
  COMMENDATION: 'bg-emerald-500',
  CONCERN: 'bg-amber-500',
  REVIEW: 'bg-sky-500',
  INCIDENT: 'bg-red-500',
  NOTE: 'bg-zinc-400',
}

interface PerformanceSummary {
  employee: { id: string; fullName: string; access: 'SYSTEM_USER' | 'STAFF_ONLY' }
  period: { month: string }
  system: null | {
    user: { email: string; role: string; status: string } | null
    totalActions: number
    ordersHandled: number
    activeDays: number
    sessions: number
    lastActiveAt: string | null
    byAction: Array<{ action: string; count: number }>
    recent: Array<{ id: string; action: string; description: string | null; createdAt: string }>
  }
  notes: { total: number; byKind: Record<NoteKind, number>; ratedCount: number; averageRating: number | null }
}

interface PerformanceNote {
  id: string
  kind: NoteKind
  rating: number | null
  title: string
  body: string | null
  occurredOn: string
  recordedBy: { userId: string | null; name: string | null }
  createdAt: string
  voided: boolean
  voidReason: string | null
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof CKApiError || e instanceof Error ? e.message || fallback : fallback
}

export default function EmployeePerformancePanel({
  employeeId,
  month,
  monthLabel,
  canWriteNotes,
}: {
  employeeId: string
  month: string
  monthLabel: string
  /** A people manager who is not this employee (the server enforces the same rule). */
  canWriteNotes: boolean
}) {
  const summaryQuery = useQuery({
    queryKey: ['employees', employeeId, 'performance', month],
    queryFn: async () => (await get<PerformanceSummary>(`/employees/${employeeId}/performance?month=${month}`)).data,
  })
  const notesQuery = useQuery({
    queryKey: ['employees', employeeId, 'performance-notes'],
    queryFn: async () => (await get<PerformanceNote[]>(`/employees/${employeeId}/performance-notes?limit=50`)).data,
  })
  const [addOpen, setAddOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState<PerformanceNote | null>(null)

  const summary = summaryQuery.data
  const isStaffOnly = summary?.employee.access === 'STAFF_ONLY'

  return (
    <>
      {/* ── System activity (login holders) / staff-only explainer ─────────── */}
      <Card className="border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">System activity</h3>
          <span className="ml-auto text-xs text-muted-foreground">{monthLabel}</span>
        </div>
        <div className="p-5">
          {summaryQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading activity…</p>
          ) : summaryQuery.isError ? (
            <p className="text-sm text-danger-text">{errMsg(summaryQuery.error, 'Failed to load activity.')}</p>
          ) : isStaffOnly || !summary?.system ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <HardHat className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Staff only: no ORION login, so there is no system trail. Their record is the attendance above
              and the performance log below.
            </p>
          ) : (
            <SystemActivity system={summary.system} />
          )}
        </div>
      </Card>

      {/* ── Performance log (everyone) ─────────────────────────────────────── */}
      <Card className="border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">Performance log</h3>
          {summary && (
            <span className="text-xs text-muted-foreground">
              {monthLabel}: {summary.notes.total} {summary.notes.total === 1 ? 'note' : 'notes'}
              {summary.notes.averageRating != null && (
                <>
                  {' · '}
                  <Star className="inline h-3 w-3 -translate-y-px fill-current text-amber-500" aria-hidden />{' '}
                  {summary.notes.averageRating.toFixed(1)} avg from {summary.notes.ratedCount}
                </>
              )}
            </span>
          )}
          {canWriteNotes && (
            <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add note
            </Button>
          )}
        </div>
        <div className="px-5 py-2">
          {notesQuery.isPending ? (
            <p className="py-3 text-sm text-muted-foreground">Loading notes…</p>
          ) : notesQuery.isError ? (
            <p className="py-3 text-sm text-danger-text">{errMsg(notesQuery.error, 'Failed to load notes.')}</p>
          ) : (notesQuery.data ?? []).length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No notes yet.{canWriteNotes ? ' Record commendations, concerns or reviews as they happen.' : ''}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(notesQuery.data ?? []).map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-3">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND_DOT[n.kind])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{n.title}</span>
                      {n.rating != null && (
                        <span className="ml-2 text-xs text-muted-foreground" aria-label={`Rated ${n.rating} of 5`}>
                          {'★'.repeat(n.rating)}
                          <span className="opacity-30">{'★'.repeat(5 - n.rating)}</span>
                        </span>
                      )}
                    </p>
                    {n.body && <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {KIND_LABEL[n.kind]} · {fmtDay(n.occurredOn)} · by {n.recordedBy.name ?? 'someone'}
                    </p>
                  </div>
                  {canWriteNotes && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 text-xs text-muted-foreground"
                      onClick={() => setVoidTarget(n)}
                    >
                      Void
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {canWriteNotes && (
        <>
          <AddNoteDialog employeeId={employeeId} open={addOpen} onOpenChange={setAddOpen} />
          <VoidNoteDialog employeeId={employeeId} note={voidTarget} onClose={() => setVoidTarget(null)} />
        </>
      )}
    </>
  )
}

function SystemActivity({ system }: { system: NonNullable<PerformanceSummary['system']> }) {
  const stats = [
    { icon: Activity, label: 'Actions', value: system.totalActions, hint: 'audited this month' },
    { icon: ListChecks, label: 'Orders handled', value: system.ordersHandled, hint: 'advanced a stage' },
    { icon: CalendarCheck, label: 'Active days', value: system.activeDays, hint: 'days with activity' },
    { icon: LogIn, label: 'Sign-ins', value: system.sessions, hint: 'sessions this month' },
  ]
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {stats.map(({ icon: Icon, label, value, hint }) => (
          <div key={label}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
            <dd className="text-[11px] text-muted-foreground">{hint}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {system.user ? `Login ${system.user.email}` : 'Login'}
        {system.lastActiveAt ? ` · last active ${fmtWhen(system.lastActiveAt)}` : ' · no activity recorded yet'}
      </p>

      {system.byAction.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Most frequent actions</p>
          <ul className="divide-y divide-border border-y border-border">
            {system.byAction.slice(0, 6).map((a) => (
              <li key={a.action} className="flex items-center justify-between py-1.5 text-sm">
                <span className="font-mono text-xs text-foreground">{a.action}</span>
                <span className="tabular-nums text-muted-foreground">{a.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Action log</p>
        {system.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No audited actions this month.</p>
        ) : (
          <ul className="space-y-1.5">
            {system.recent.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 text-sm">
                <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtWhen(r.createdAt)}</span>
                <span className="shrink-0 font-mono text-[11px] text-ink-accent">{r.action}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground" title={r.description ?? undefined}>
                  {r.description ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AddNoteDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { pending, guard } = useSubmitGuard()
  // One key per intent. A save that failed or timed out may still have landed, so closing and
  // reopening keeps the draft AND its key: the retry replays instead of adding a second note.
  // Only a confirmed save starts a fresh intent.
  const requestId = useRef<string>(crypto.randomUUID())
  const startFresh = useRef(true)
  const [kind, setKind] = useState<NoteKind>('COMMENDATION')
  const [rating, setRating] = useState<string>('none')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayLocal)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (next && startFresh.current) {
      startFresh.current = false
      requestId.current = crypto.randomUUID()
      setKind('COMMENDATION')
      setRating('none')
      setTitle('')
      setBody('')
      setOccurredOn(todayLocal())
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = guard(async () => {
    if (!title.trim()) {
      setError('Give the note a short title.')
      return
    }
    setError(null)
    try {
      await post(`/employees/${employeeId}/performance-notes`, {
        client_request_id: requestId.current,
        kind,
        rating: rating === 'none' ? null : Number(rating),
        title: title.trim(),
        body: body.trim() || null,
        occurred_on: occurredOn,
      })
      toast.success('Note recorded')
      startFresh.current = true
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
    } catch (e) {
      setError(errMsg(e, 'Could not save the note.'))
    }
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a performance note</DialogTitle>
          <DialogDescription>Notes cannot be edited later. A wrong note can be voided with a reason.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Kind
              <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)} disabled={pending}>
                <SelectTrigger aria-label="Kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Rating (optional)
              <Select value={rating} onValueChange={setRating} disabled={pending}>
                <SelectTrigger aria-label="Rating">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No rating</SelectItem>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r} of 5
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={pending} placeholder="e.g. Covered the closing shift" />
          </label>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            Details (optional)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              rows={3}
              disabled={pending}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            When it happened
            <Input type="date" value={occurredOn} max={todayLocal()} onChange={(e) => setOccurredOn(e.target.value)} disabled={pending} />
          </label>
          {error && (
            <p className="text-xs text-danger-text" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save note'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VoidNoteDialog({ employeeId, note, onClose }: { employeeId: string; note: PerformanceNote | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { pending, guard } = useSubmitGuard()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = guard(async () => {
    if (!note) return
    if (reason.trim().length < 3) {
      setError('Say why (at least 3 characters).')
      return
    }
    setError(null)
    try {
      await post(`/employees/${employeeId}/performance-notes/${note.id}/void`, { reason: reason.trim() })
      toast.success('Note voided')
      await queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
      setReason('')
      onClose()
    } catch (e) {
      setError(errMsg(e, 'Could not void the note.'))
    }
  })

  return (
    <Dialog
      open={note !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setReason('')
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void this note?</DialogTitle>
          <DialogDescription>
            “{note?.title}” stays in the audit trail but no longer counts in the summary.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            Reason
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={pending} placeholder="e.g. Recorded on the wrong person" />
          </label>
          {error && (
            <p className="text-xs text-danger-text" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Voiding…' : 'Void note'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

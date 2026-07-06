import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, LogIn, LogOut, RefreshCw, Search, UserCheck, CircleAlert, CheckCircle2 } from 'lucide-react'

/**
 * 1×1 transparent PNG — the placeholder "photo" sent when the camera is
 * unavailable so a staffer can still clock in (gap #3). The backend requires a
 * non-empty photo (Cloudinary upload); this keeps that contract intact while the
 * FLAG_NOTE marks the punch for later review.
 */
const PLACEHOLDER_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const FLAG_NOTE = 'Camera unavailable — punched without photo (flagged for review)'
import { get, post } from '../lib/api'
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
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function Attendance() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [search, setSearch] = useState('')
  const [punches, setPunches] = useState<Punch[]>([])
  const [submitting, setSubmitting] = useState<null | 'TIME_IN' | 'TIME_OUT'>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null)

  // ── Load active employees ──────────────────────────────────────────────────
  useEffect(() => {
    get<Employee[]>('/employees?status=ACTIVE')
      .then((r) => setEmployees(r.data))
      .catch(() => setEmployees([]))
  }, [])

  // ── Start webcam (reusable so "Retry camera" can re-attempt) ────────────────
  const startCamera = useCallback(async () => {
    setCamError(null)
    // Drop any prior stream before re-acquiring.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (!stream) throw new Error('no camera')
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setCamError('Camera unavailable — grant camera permission, or clock in without a photo (flagged for review).')
    }
  }, [])

  useEffect(() => {
    void startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [startCamera])

  const selected = useMemo(() => employees.find((e) => e.id === employeeId) ?? null, [employees, employeeId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) => e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q),
    )
  }, [employees, search])

  function loadPunches(empId: string) {
    if (!empId) return setPunches([])
    get<Punch[]>(`/ems/attendance?employee_id=${empId}&limit=8`)
      .then((r) => setPunches(r.data))
      .catch(() => setPunches([]))
  }

  function captureFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.6) // ~tens of KB, well under the 8 MB cap
  }

  async function punch(type: 'TIME_IN' | 'TIME_OUT', opts?: { noPhoto?: boolean }) {
    setMsg(null)
    if (!employeeId) return setMsg({ err: 'Select an employee first.' })
    // Fallback path (gap #3): camera unavailable → placeholder photo + flag note,
    // so a broken webcam at an outlet never blocks a required daily clock-in.
    const noPhoto = opts?.noPhoto ?? false
    const photo = noPhoto ? PLACEHOLDER_PHOTO : captureFrame()
    if (!photo) return setMsg({ err: 'Camera not ready — cannot capture photo proof.' })
    setSubmitting(type)
    try {
      await post<Punch>('/ems/attendance', {
        employee_id: employeeId,
        type,
        photo,
        ...(noPhoto ? { note: FLAG_NOTE } : {}),
      })
      setMsg({
        ok: `${type === 'TIME_IN' ? 'Timed in' : 'Timed out'}: ${selected?.fullName} — ${new Date().toLocaleTimeString()}${noPhoto ? ' (no photo, flagged)' : ''}`,
      })
      loadPunches(employeeId)
    } catch (e) {
      setMsg({ err: e instanceof Error ? e.message : 'Punch failed.' })
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Attendance / DTR" subtitle="Photo-verified time clock — select your name, face the camera, punch in or out" />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Camera + punch ── */}
        <Card className="border-border bg-card p-5">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                <Camera className="h-8 w-8 text-zinc-500" />
                <p className="text-sm text-zinc-400">{camError}</p>
                <Button size="sm" variant="outline" onClick={() => void startCamera()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry camera
                </Button>
              </div>
            )}
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
            </span>
          </div>

          <div className="mt-4 space-y-3">
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
                loadPunches(v)
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

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => punch('TIME_IN', { noPhoto: !!camError })}
                disabled={!employeeId || submitting !== null}
                className={camError
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {submitting === 'TIME_IN' ? 'Submitting…' : camError ? 'Time In (no photo)' : 'Time In'}
              </Button>
              <Button
                onClick={() => punch('TIME_OUT', { noPhoto: !!camError })}
                disabled={!employeeId || submitting !== null}
                variant="outline"
                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {submitting === 'TIME_OUT' ? 'Submitting…' : camError ? 'Time Out (no photo)' : 'Time Out'}
              </Button>
            </div>
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

        {/* ── Recent punches for the selected employee ── */}
        <Card className="border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <UserCheck className="h-4 w-4 text-zinc-400" />
            {selected ? `${selected.fullName} — recent punches` : 'Recent punches'}
          </div>
          {!selected ? (
            <p className="py-8 text-center text-sm text-zinc-500">Select an employee to see their latest punches.</p>
          ) : punches.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No punches yet for {selected.fullName}.</p>
          ) : (
            <ul className="space-y-2">
              {punches.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-2">
                  <img src={p.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        p.type === 'TIME_IN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {p.type}
                    </span>
                    <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{fmtTime(p.capturedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

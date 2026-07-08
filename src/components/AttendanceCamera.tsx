import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

/**
 * Shared webcam capture plumbing for the two attendance surfaces:
 *   - src/pages/Attendance.tsx      (authenticated, in-shell page)
 *   - src/pages/AttendanceKiosk.tsx (public wall-tablet kiosk, /kiosk/attendance)
 *
 * `useAttendanceCamera` owns the getUserMedia stream lifecycle (acquired on
 * mount, released on unmount, re-acquirable via `startCamera` for a "Retry
 * camera" affordance) and exposes `captureFrame`, which snapshots the live
 * <video> onto a canvas and returns a JPEG data URL — the `photo` payload the
 * attendance endpoints require (Cloudinary upload server-side).
 *
 * `AttendanceCameraView` is the matching presentational block: the live video
 * with a LIVE badge and, when the camera failed, a centered error overlay with
 * a retry button. Sizing/aspect comes from `className` so the kiosk can render
 * it much larger than the in-shell page.
 */

export interface AttendanceCameraControls {
  /** Attach to the <video> — done for you when using AttendanceCameraView. */
  videoRef: RefObject<HTMLVideoElement>
  /** Human-readable error when the camera could not start; null when live. */
  camError: string | null
  /** (Re)acquire the webcam — safe to call repeatedly (drops any prior stream). */
  startCamera: () => Promise<void>
  /** Snapshot the current frame as a JPEG data URL, or null if not ready. */
  captureFrame: () => string | null
}

export function useAttendanceCamera(): AttendanceCameraControls {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [camError, setCamError] = useState<string | null>(null)

  const startCamera = useCallback(async () => {
    setCamError(null)
    // Drop any prior stream before re-acquiring.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      if (!stream) throw new Error('no camera')
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setCamError('Camera unavailable — grant camera permission and retry.')
    }
  }, [])

  useEffect(() => {
    void startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [startCamera])

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.6) // ~tens of KB, well under the 8 MB cap
  }, [])

  return { videoRef, camError, startCamera, captureFrame }
}

interface AttendanceCameraViewProps {
  videoRef: RefObject<HTMLVideoElement>
  camError: string | null
  onRetry: () => void
  /** Override the error copy shown in the overlay (defaults to `camError`). */
  errorHint?: string
  className?: string
}

export function AttendanceCameraView({
  videoRef,
  camError,
  onRetry,
  errorHint,
  className,
}: AttendanceCameraViewProps) {
  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black',
        className,
      )}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      {camError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <Camera className="h-8 w-8 text-zinc-500" />
          <p className="text-sm text-zinc-400">{errorHint ?? camError}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry camera
          </Button>
        </div>
      )}
      {!camError && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
        </span>
      )}
    </div>
  )
}

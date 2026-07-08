import { useCallback, useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'

/**
 * PhotoLightbox — reusable fullscreen photo viewer (attendance proof photos,
 * and any future image evidence).
 *
 * Built directly on the Radix Dialog primitives (NOT the styled ui/dialog
 * DialogContent, whose max-w-lg card chrome is wrong for a fullscreen
 * overlay) so focus-trap, Esc-to-close, backdrop-close, and scroll-lock all
 * come from the same a11y machinery every other dialog in the app uses.
 *
 * Zoom is dependency-free: click/tap toggles fit ↔ 2×, wheel zooms 1–4×,
 * dragging pans while zoomed. Prev/next appears when more than one photo is
 * supplied (e.g. a day's TIME_IN + TIME_OUT pair).
 */

export interface LightboxPhoto {
  url: string
  /** e.g. "Time in — Jul 9, 8:02 AM — Maria Santos" */
  caption?: string
}

// ---------------------------------------------------------------------------
// Cloudinary URL helpers
// ---------------------------------------------------------------------------

/**
 * Matches ONE inline transform segment right after /upload/ (a segment
 * containing recognizable transform keys like w_/h_/c_/q_/f_). Deliberately
 * does NOT match version segments (/upload/v1234/...), and non-Cloudinary or
 * data: URLs pass through every helper untouched — the attendance kiosk's
 * "camera unavailable" placeholder punch photo is a data: URI.
 */
const CLOUDINARY_TRANSFORM_RE = /\/upload\/[^/]*(?:w_|h_|c_|q_|f_)[^/]*\//

/**
 * Inverse of Menu.tsx's `thumb()`: strip any existing transform, then request
 * a large-but-bounded variant for the lightbox (w_1600/c_limit never
 * upscales; f_auto/q_auto keeps the transfer sane on outlet LTE).
 */
export function lightboxPhotoUrl(url: string): string {
  if (!url.includes('/upload/')) return url
  return url
    .replace(CLOUDINARY_TRANSFORM_RE, '/upload/')
    .replace('/upload/', '/upload/w_1600,c_limit,f_auto,q_auto/')
}

/** Small square thumbnail variant (same pattern as Menu.tsx's `thumb()`). */
export function photoThumbUrl(url: string, size = 96): string {
  if (!url.includes('/upload/')) return url
  return url
    .replace(CLOUDINARY_TRANSFORM_RE, '/upload/')
    .replace('/upload/', `/upload/w_${size},h_${size},c_fill,f_auto,q_auto/`)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MIN_ZOOM = 1
const MAX_ZOOM = 4
/** Pointer travel (px) below which a pointerup still counts as a click-to-toggle. */
const CLICK_SLOP_PX = 6

export default function PhotoLightbox({
  photos,
  initialIndex = 0,
  open,
  onOpenChange,
}: {
  photos: LightboxPhoto[]
  initialIndex?: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  // Pointer bookkeeping for drag-to-pan vs click-to-toggle discrimination.
  const pointerStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const movedRef = useRef(0)

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Re-arm on every open (and honor a changed initialIndex between opens).
  useEffect(() => {
    if (open) {
      setIndex(Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0)))
      resetView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIndex])

  const photo = photos[index] ?? null

  const goto = useCallback(
    (next: number) => {
      if (photos.length === 0) return
      setIndex(((next % photos.length) + photos.length) % photos.length)
      resetView()
    },
    [photos.length, resetView],
  )

  function toggleZoom() {
    if (zoom > 1) resetView()
    else setZoom(2)
  }

  function onWheel(e: React.WheelEvent) {
    // No preventDefault (React root wheel listeners are passive); Radix's
    // scroll-lock already keeps the page beneath from scrolling.
    const next = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.25 : 0.8), MIN_ZOOM), MAX_ZOOM)
    setZoom(next)
    if (next === 1) setPan({ x: 0, y: 0 })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    movedRef.current = 0
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = pointerStart.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    movedRef.current = Math.max(movedRef.current, Math.hypot(dx, dy))
    if (zoom > 1) setPan({ x: start.panX + dx, y: start.panY + dy })
  }

  function onPointerUp() {
    const wasClick = movedRef.current < CLICK_SLOP_PX
    pointerStart.current = null
    setDragging(false)
    if (wasClick) toggleZoom()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') goto(index + 1)
    else if (e.key === 'ArrowLeft') goto(index - 1)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          onKeyDown={onKeyDown}
          // The caption IS the description; silence Radix's missing-Description warning.
          aria-describedby={undefined}
        >
          {/* a11y name for the focus-trapped dialog */}
          <DialogPrimitive.Title className="sr-only">
            {photo?.caption ?? 'Photo viewer'}
          </DialogPrimitive.Title>

          {/* Top bar: counter + close */}
          <div className="pointer-events-none z-10 flex items-center justify-between p-4">
            <span className="rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums text-zinc-300">
              {photos.length > 1 ? `${index + 1} / ${photos.length}` : ' '}
            </span>
            <DialogPrimitive.Close
              className="pointer-events-auto rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              aria-label="Close photo viewer"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Stage — clicking the empty backdrop area closes; the image itself zooms. */}
          <div
            className="relative -mt-14 flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            onClick={(e) => {
              if (e.target === e.currentTarget) onOpenChange(false)
            }}
          >
            {photo && (
              <div
                className="touch-none select-none"
                style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  pointerStart.current = null
                  setDragging(false)
                }}
              >
                <img
                  key={photo.url}
                  src={lightboxPhotoUrl(photo.url)}
                  alt={photo.caption ?? ''}
                  draggable={false}
                  className="max-h-[80vh] max-w-[92vw] object-contain"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transition: dragging ? 'none' : 'transform 150ms ease-out',
                  }}
                />
              </div>
            )}

            {/* Prev / next */}
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => goto(index - 1)}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => goto(index + 1)}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          {/* Caption + zoom hint */}
          <div className="z-10 flex flex-col items-center gap-1 p-4 pb-6">
            {photo?.caption && (
              <p className="max-w-[90vw] truncate rounded-full bg-black/60 px-4 py-1.5 text-center text-sm text-zinc-200">
                {photo.caption}
              </p>
            )}
            <p className="flex items-center gap-1 text-[11px] text-zinc-500">
              {zoom > 1 ? <ZoomOut className="h-3 w-3" /> : <ZoomIn className="h-3 w-3" />}
              {zoom > 1
                ? `${zoom.toFixed(1)}× — drag to pan, click to fit`
                : 'Click to zoom, scroll to zoom freely'}
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

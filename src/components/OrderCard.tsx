/**
 * OrderCard — Single order in the unified feed (FR-OD-01, FR-OD-02)
 *
 * Displays: brand color chip, aggregator badge (pink=FoodPanda, green=GrabFood),
 * order ref, customer, items from print-job payloads, status, elapsed time,
 * and aggregated print-job status.
 *
 * The web app NEVER prints — it only DISPLAYS job status (Business Rule #6).
 */
import type { OrderDetail, Brand } from '../pages/Dashboard'

interface Props {
  order: OrderDetail
  brand: Brand | undefined
}

// ─── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  NEW:       'bg-blue-100 text-blue-800',
  PREPARING: 'bg-amber-100 text-amber-800',
  READY:     'bg-green-100 text-green-800',
  COMPLETED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-red-100 text-red-500',
}

// ─── Aggregator badge config ───────────────────────────────────────────────────

interface AggStyle {
  label: string
  cls: string
}

const AGG_STYLES: Record<string, AggStyle> = {
  FOODPANDA: { label: 'FoodPanda', cls: 'bg-pink-100 text-pink-700 border border-pink-200' },
  GRABFOOD:  { label: 'GrabFood',  cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  OTHER:     { label: 'Other',     cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getPrintSummary(jobs: OrderDetail['printJobs']): { label: string; cls: string } {
  if (jobs.length === 0) return { label: '—', cls: 'text-gray-400' }
  if (jobs.some(j => j.status === 'FAILED'))  return { label: 'FAILED',  cls: 'text-red-600 font-semibold' }
  if (jobs.some(j => j.status === 'PENDING')) return { label: 'PENDING', cls: 'text-amber-600 font-semibold' }
  return { label: 'PRINTED', cls: 'text-emerald-600 font-semibold' }
}

function elapsedLabel(placedAt: string): string {
  const ms = Date.now() - new Date(placedAt).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderCard({ order, brand }: Props) {
  const agg = AGG_STYLES[order.aggregator] ?? AGG_STYLES.OTHER
  const printSummary = getPrintSummary(order.printJobs)
  const brandColor = brand?.color ?? '#9ca3af'

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
      style={{ borderLeftColor: brandColor, borderLeftWidth: 4 }}
    >
      {/* ── Header: brand + aggregator + ref + status ── */}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2 flex-wrap">
        {/* Brand chip */}
        <span
          className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: brandColor }}
        >
          {brand?.name ?? 'Unknown Brand'}
        </span>

        {/* Aggregator badge */}
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${agg.cls}`}>
          {agg.label}
        </span>

        {/* Order ref */}
        <span className="text-xs text-gray-400 font-mono pt-0.5">{order.externalRef}</span>

        {/* Status — pushed right */}
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${STATUS_STYLES[order.status] ?? STATUS_STYLES.NEW}`}>
          {order.status}
        </span>
      </div>

      {/* ── Customer + time ── */}
      <div className="px-4 pb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {order.customerName ?? 'Guest'}
        </span>
        <span
          className="text-xs text-gray-400 shrink-0 ml-4"
          title={`Placed at ${formatTime(order.placedAt)}`}
        >
          {elapsedLabel(order.placedAt)} · {formatTime(order.placedAt)}
        </span>
      </div>

      {/* ── Items list ── */}
      {order.items.length > 0 && (
        <ul className="px-4 pb-3 space-y-1 border-t border-gray-50 pt-2">
          {order.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="font-semibold text-gray-900 shrink-0 w-5 text-right">{item.qty}×</span>
              <span className="flex-1">
                {item.name}
                {item.notes && (
                  <span className="ml-1 text-xs text-gray-400 italic">({item.notes})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Footer: total + print job status ── */}
      <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">
          ₱{Number(order.total).toFixed(2)}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-xs text-gray-400">Print:</span>
          <span className={`text-xs ${printSummary.cls}`}>{printSummary.label}</span>
        </span>
      </div>
    </div>
  )
}

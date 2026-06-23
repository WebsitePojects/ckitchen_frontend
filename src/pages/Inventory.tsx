/**
 * Inventory — Two-Tier Stock View + ITO Management + Low-Stock Alerts
 * Implements FR-IV-01..08 (CK1-SRS-001 §3.7)
 *
 * Features:
 *   FR-IV-01/02  Two-tier view: MAIN + KITCHEN warehouse stock tables
 *   FR-IV-03/04  ITO request (KITCHEN_STAFF|SUPER_ADMIN) + confirm (WAREHOUSE|SUPER_ADMIN)
 *   FR-IV-05     End-of-day consumption log (future: stub button shown)
 *   FR-IV-06/07  Below-threshold rows highlighted red; lowstock.alert toast
 *   FR-IV-08     Receive into MAIN (WAREHOUSE|SUPER_ADMIN)
 *   NFR-02       Real-time: stock.updated refreshes tiers; lowstock.alert toasts
 *
 * Business Rules:
 *   #4  ITO stock moves are atomic — backend enforces; UI shows both tiers post-confirm
 *   #8  Low-stock alerts are non-negotiable — prominent red toast, 10 s TTL
 *   #10 RBAC enforced server-side; UI hides/disables unreachable actions
 */
import { useCallback, useEffect, useState } from 'react'
import { get, post } from '../lib/api'
import { onSocketEvent } from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'

// ─── Role helpers ──────────────────────────────────────────────────────────────

/** Roles that can receive stock into MAIN warehouse (FR-IV-08) */
const CAN_RECEIVE: UserRole[] = ['SUPER_ADMIN', 'WAREHOUSE_PERSONNEL']
/** Roles that can request an ITO (FR-IV-04) */
const CAN_REQUEST_ITO: UserRole[] = ['SUPER_ADMIN', 'KITCHEN_STAFF']
/** Roles that can confirm an ITO (FR-IV-04) */
const CAN_CONFIRM_ITO: UserRole[] = ['SUPER_ADMIN', 'WAREHOUSE_PERSONNEL']

function hasRole(role: UserRole | undefined, allowed: UserRole[]): boolean {
  return !!role && allowed.includes(role)
}

// ─── API types ────────────────────────────────────────────────────────────────

interface Ingredient {
  id: string
  name: string
  unit: string
  unitCost: string
  lowStockThreshold: number
}

interface StockLine {
  ingredient_id: string
  ingredient_name: string
  quantity: number
  unit: string
  threshold: number
  below_threshold: boolean
}

type ItoStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED'

interface ItoItem {
  ingredient_id: string
  ingredient_name: string
  quantity: number
  unit: string
}

interface Ito {
  id: string
  from: 'MAIN'
  to: 'KITCHEN'
  status: ItoStatus
  requested_by: string
  confirmed_by: string | null
  requested_at: string
  confirmed_at: string | null
  items: ItoItem[]
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: string
  kind: 'lowstock' | 'success' | 'error' | 'info'
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatQty(qty: number, unit: string): string {
  return `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${unit}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Stock table ──────────────────────────────────────────────────────────────

interface StockTableProps {
  title: string
  tier: 'MAIN' | 'KITCHEN'
  rows: StockLine[]
  loading: boolean
  error: string | null
  /** IDs of ingredients that just got a lowstock.alert via socket (for extra highlight) */
  alertedIds: Set<string>
}

function StockTable({ title, tier, rows, loading, error, alertedIds }: StockTableProps) {
  const tierColor = tier === 'MAIN'
    ? { header: 'bg-slate-700', badge: 'bg-slate-100 text-slate-700' }
    : { header: 'bg-teal-700',  badge: 'bg-teal-100 text-teal-700' }

  return (
    <section className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0">
      {/* Header */}
      <div className={`${tierColor.header} px-4 py-3 flex items-center justify-between`}>
        <h2 className="text-base font-bold text-white tracking-wide">{title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tierColor.badge} tabular-nums`}>
          {loading ? '…' : `${rows.length} items`}
        </span>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="mb-3 h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
          <p className="text-sm">Loading stock…</p>
        </div>
      ) : error ? (
        <div className="p-6 text-center">
          <p className="text-sm font-medium text-red-700">{error}</p>
          <p className="mt-1 text-xs text-red-400">Check backend connection.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-300">
          <p className="text-3xl" aria-hidden>📦</p>
          <p className="mt-2 text-xs font-medium text-gray-400">No stock recorded</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ingredient</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Qty</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Threshold</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const isAlert = row.below_threshold || alertedIds.has(row.ingredient_id)
                return (
                  <tr
                    key={row.ingredient_id}
                    className={[
                      'transition-colors duration-300',
                      isAlert
                        ? 'bg-red-50 hover:bg-red-100'
                        : 'hover:bg-gray-50',
                    ].join(' ')}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {row.ingredient_name}
                      {isAlert && (
                        <span className="ml-2 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 uppercase">
                          Low
                        </span>
                      )}
                    </td>
                    <td className={[
                      'px-4 py-2.5 text-right font-mono tabular-nums font-semibold',
                      isAlert ? 'text-red-700' : 'text-gray-800',
                    ].join(' ')}>
                      {formatQty(row.quantity, row.unit)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-gray-400 text-xs">
                      {row.threshold} {row.unit}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isAlert ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          ⚠ Below threshold
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ─── Receive into MAIN form ────────────────────────────────────────────────────

interface ReceiveItem {
  ingredient_id: string
  quantity: string
}

interface ReceiveFormProps {
  ingredients: Ingredient[]
  onSuccess: () => void
  onToast: (kind: Toast['kind'], message: string) => void
}

function ReceiveForm({ ingredients, onSuccess, onToast }: ReceiveFormProps) {
  const [items, setItems] = useState<ReceiveItem[]>([{ ingredient_id: '', quantity: '' }])
  const [submitting, setSubmitting] = useState(false)

  function addRow() {
    setItems(prev => [...prev, { ingredient_id: '', quantity: '' }])
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function setField(idx: number, field: keyof ReceiveItem, value: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const valid = items.filter(it => it.ingredient_id && Number(it.quantity) > 0)
    if (valid.length === 0) {
      onToast('error', 'Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/inventory/receive', {
        items: valid.map(it => ({
          ingredient_id: it.ingredient_id,
          quantity: Number(it.quantity),
        })),
      })
      onToast('success', `Received ${valid.length} ingredient(s) into MAIN warehouse.`)
      setItems([{ ingredient_id: '', quantity: '' }])
      onSuccess()
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'Failed to receive stock.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-end">
          <div className="flex-1 min-w-0">
            {idx === 0 && (
              <label className="mb-1 block text-xs font-medium text-gray-600">Ingredient</label>
            )}
            <select
              value={item.ingredient_id}
              onChange={e => setField(idx, 'ingredient_id', e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select ingredient…</option>
              {ingredients.map(ing => (
                <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            {idx === 0 && (
              <label className="mb-1 block text-xs font-medium text-gray-600">Quantity</label>
            )}
            <input
              type="number"
              min="0.01"
              step="any"
              value={item.quantity}
              onChange={e => setField(idx, 'quantity', e.target.value)}
              required
              placeholder="0"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(idx)}
              aria-label="Remove row"
              className="mb-0 flex-none rounded-lg border border-gray-200 px-2 py-2 text-gray-400 hover:text-red-600 hover:border-red-200 transition text-sm"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          + Add row
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="ml-auto rounded-lg bg-slate-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-60"
        >
          {submitting ? 'Receiving…' : 'Receive into MAIN'}
        </button>
      </div>
    </form>
  )
}

// ─── ITO Request form ─────────────────────────────────────────────────────────

interface ItoRequestItem {
  ingredient_id: string
  quantity: string
}

interface ItoRequestFormProps {
  ingredients: Ingredient[]
  onSuccess: () => void
  onToast: (kind: Toast['kind'], message: string) => void
}

function ItoRequestForm({ ingredients, onSuccess, onToast }: ItoRequestFormProps) {
  const [items, setItems] = useState<ItoRequestItem[]>([{ ingredient_id: '', quantity: '' }])
  const [submitting, setSubmitting] = useState(false)

  function addRow() {
    setItems(prev => [...prev, { ingredient_id: '', quantity: '' }])
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function setField(idx: number, field: keyof ItoRequestItem, value: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const valid = items.filter(it => it.ingredient_id && Number(it.quantity) > 0)
    if (valid.length === 0) {
      onToast('error', 'Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/itos', {
        from: 'MAIN',
        to: 'KITCHEN',
        items: valid.map(it => ({
          ingredient_id: it.ingredient_id,
          quantity: Number(it.quantity),
        })),
      })
      onToast('success', `ITO requested for ${valid.length} ingredient(s). Awaiting warehouse confirmation.`)
      setItems([{ ingredient_id: '', quantity: '' }])
      onSuccess()
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'Failed to request ITO.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-end">
          <div className="flex-1 min-w-0">
            {idx === 0 && (
              <label className="mb-1 block text-xs font-medium text-gray-600">Ingredient</label>
            )}
            <select
              value={item.ingredient_id}
              onChange={e => setField(idx, 'ingredient_id', e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select ingredient…</option>
              {ingredients.map(ing => (
                <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            {idx === 0 && (
              <label className="mb-1 block text-xs font-medium text-gray-600">Quantity</label>
            )}
            <input
              type="number"
              min="0.01"
              step="any"
              value={item.quantity}
              onChange={e => setField(idx, 'quantity', e.target.value)}
              required
              placeholder="0"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(idx)}
              aria-label="Remove row"
              className="flex-none rounded-lg border border-gray-200 px-2 py-2 text-gray-400 hover:text-red-600 hover:border-red-200 transition text-sm"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          + Add row
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="ml-auto rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-teal-800 transition disabled:opacity-60"
        >
          {submitting ? 'Requesting…' : 'Request Transfer (ITO)'}
        </button>
      </div>
    </form>
  )
}

// ─── ITO List ─────────────────────────────────────────────────────────────────

const ITO_STATUS_STYLES: Record<ItoStatus, string> = {
  REQUESTED:  'bg-amber-100 text-amber-800 border border-amber-200',
  CONFIRMED:  'bg-emerald-100 text-emerald-800 border border-emerald-200',
  CANCELLED:  'bg-gray-100 text-gray-500 border border-gray-200',
}

interface ItoListProps {
  itos: Ito[]
  loading: boolean
  error: string | null
  canConfirm: boolean
  confirming: Set<string>
  onConfirm: (id: string) => void
}

function ItoList({ itos, loading, error, canConfirm, confirming, onConfirm }: ItoListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
        <p className="text-sm">Loading ITOs…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-sm font-medium text-red-700">{error}</p>
      </div>
    )
  }

  if (itos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-300">
        <p className="text-3xl" aria-hidden>↔</p>
        <p className="mt-2 text-xs font-medium text-gray-400">No transfer orders</p>
        <p className="mt-1 text-[11px] text-gray-300">Request a transfer to move stock MAIN → KITCHEN.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {itos.map(ito => {
        const isConfirming = confirming.has(ito.id)
        return (
          <div
            key={ito.id}
            className={[
              'rounded-xl border p-3 transition-colors',
              ito.status === 'REQUESTED'
                ? 'border-amber-200 bg-amber-50'
                : ito.status === 'CONFIRMED'
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-gray-200 bg-gray-50',
            ].join(' ')}
          >
            {/* ITO header */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-[10px] text-gray-400">{ito.id.slice(0, 8)}…</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ITO_STATUS_STYLES[ito.status]}`}>
                {ito.status}
              </span>
              <span className="ml-auto text-[11px] text-gray-400">
                {formatTime(ito.requested_at)}
              </span>
            </div>

            {/* Items */}
            <ul className="mb-2 space-y-0.5">
              {ito.items.map((it, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="font-medium">{it.ingredient_name}</span>
                  <span className="ml-auto font-mono tabular-nums text-xs text-gray-500">
                    {formatQty(it.quantity, it.unit)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Confirm button — only for REQUESTED ITOs and allowed roles */}
            {ito.status === 'REQUESTED' && canConfirm && (
              <button
                onClick={() => onConfirm(ito.id)}
                disabled={isConfirming}
                className={[
                  'w-full rounded-lg px-3 py-2 text-sm font-bold transition',
                  'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                ].join(' ')}
              >
                {isConfirming ? 'Confirming…' : 'Confirm Transfer'}
              </button>
            )}

            {ito.status === 'CONFIRMED' && ito.confirmed_at && (
              <p className="text-[11px] text-emerald-700 mt-1">
                Confirmed {formatTime(ito.confirmed_at)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── ToastBanner ──────────────────────────────────────────────────────────────

interface ToastBannerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 shadow-lg text-sm font-medium',
            t.kind === 'lowstock'
              ? 'bg-red-600 text-white'
              : t.kind === 'error'
                ? 'bg-red-100 text-red-800 border border-red-300'
                : t.kind === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 text-white',
          ].join(' ')}
        >
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { user } = useAuth()
  const role = user?.role

  // — Stock tiers
  const [mainStock,    setMainStock]    = useState<StockLine[]>([])
  const [kitchenStock, setKitchenStock] = useState<StockLine[]>([])
  const [mainLoading,    setMainLoading]    = useState(true)
  const [kitchenLoading, setKitchenLoading] = useState(true)
  const [mainError,    setMainError]    = useState<string | null>(null)
  const [kitchenError, setKitchenError] = useState<string | null>(null)

  // — Ingredients list (for receive + ITO forms)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])

  // — ITOs
  const [itos,       setItos]       = useState<Ito[]>([])
  const [itosLoading, setItosLoading] = useState(true)
  const [itosError,  setItosError]  = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Set<string>>(new Set())

  // — Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  // — Low-stock alert ingredient IDs (for extra row highlight beyond API flag)
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set())

  // — Panel visibility
  const [showReceive,     setShowReceive]     = useState(false)
  const [showRequestIto,  setShowRequestIto]  = useState(false)

  // ── Toast helper ────────────────────────────────────────────────────────────

  const addToast = useCallback((kind: Toast['kind'], message: string, ttl = 5000) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev.slice(-4), { id, kind, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, ttl)
  }, [])

  function dismissToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchMainStock = useCallback(async () => {
    setMainLoading(true)
    setMainError(null)
    try {
      const { data } = await get<StockLine[]>('/inventory?warehouse=MAIN')
      setMainStock(data)
    } catch (e) {
      setMainError(e instanceof Error ? e.message : 'Failed to load MAIN stock.')
    } finally {
      setMainLoading(false)
    }
  }, [])

  const fetchKitchenStock = useCallback(async () => {
    setKitchenLoading(true)
    setKitchenError(null)
    try {
      const { data } = await get<StockLine[]>('/inventory?warehouse=KITCHEN')
      setKitchenStock(data)
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : 'Failed to load KITCHEN stock.')
    } finally {
      setKitchenLoading(false)
    }
  }, [])

  const fetchItos = useCallback(async () => {
    setItosLoading(true)
    setItosError(null)
    try {
      const { data } = await get<Ito[]>('/itos')
      // Show most recent first
      data.sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
      setItos(data)
    } catch (e) {
      setItosError(e instanceof Error ? e.message : 'Failed to load ITOs.')
    } finally {
      setItosLoading(false)
    }
  }, [])

  const fetchIngredients = useCallback(async () => {
    try {
      const { data } = await get<Ingredient[]>('/ingredients')
      setIngredients(data)
    } catch {
      // Non-critical; forms will show empty dropdowns
    }
  }, [])

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    void Promise.all([
      fetchMainStock(),
      fetchKitchenStock(),
      fetchItos(),
      fetchIngredients(),
    ])
  }, [fetchMainStock, fetchKitchenStock, fetchItos, fetchIngredients])

  // ── Socket subscriptions ─────────────────────────────────────────────────────

  useEffect(() => {
    // stock.updated — refresh the affected warehouse tier
    const unsubStock = onSocketEvent('stock.updated', (payload: StockPayload) => {
      if (payload.warehouse === 'MAIN') {
        void fetchMainStock()
      } else if (payload.warehouse === 'KITCHEN') {
        void fetchKitchenStock()
      }
    })

    // lowstock.alert — Business Rule #8 — non-negotiable alert
    const unsubLowstock = onSocketEvent('lowstock.alert', (alert: LowStockAlert) => {
      addToast(
        'lowstock',
        `LOW STOCK: ${alert.ingredient_name} — ${alert.quantity} ${alert.unit} remaining (threshold: ${alert.low_stock_threshold} ${alert.unit})`,
        10_000,
      )
      // Also highlight the row on the table
      setAlertedIds(prev => new Set(prev).add(alert.ingredient_id))
    })

    return () => {
      unsubStock()
      unsubLowstock()
    }
  }, [fetchMainStock, fetchKitchenStock, addToast])

  // ── ITO confirm handler ──────────────────────────────────────────────────────

  async function handleConfirmIto(itoId: string) {
    setConfirming(prev => new Set(prev).add(itoId))
    try {
      await post(`/itos/${itoId}/confirm`)
      addToast('success', 'ITO confirmed — stock moved MAIN → KITCHEN.')
      // Refresh both tiers + ITO list (atomic move per Business Rule #4)
      await Promise.all([fetchMainStock(), fetchKitchenStock(), fetchItos()])
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to confirm ITO.')
    } finally {
      setConfirming(prev => {
        const next = new Set(prev)
        next.delete(itoId)
        return next
      })
    }
  }

  // ── Role flags ───────────────────────────────────────────────────────────────

  const canReceive    = hasRole(role, CAN_RECEIVE)
  const canRequestIto = hasRole(role, CAN_REQUEST_ITO)
  const canConfirmIto = hasRole(role, CAN_CONFIRM_ITO)

  // ── Summary counts ───────────────────────────────────────────────────────────

  const lowMain    = mainStock.filter(r => r.below_threshold).length
  const lowKitchen = kitchenStock.filter(r => r.below_threshold).length
  const pendingItos = itos.filter(i => i.status === 'REQUESTED').length

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">

      {/* ── Page header ── */}
      <header className="shrink-0 flex flex-wrap items-center gap-3 justify-between border-b border-gray-200 bg-white px-5 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 sm:text-xl">Inventory</h1>
          <p className="text-[11px] text-gray-400">Two-tier warehouse · MAIN + KITCHEN · Real-time</p>
        </div>

        {/* Summary pills */}
        <div className="flex flex-wrap items-center gap-2">
          {lowMain > 0 && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 tabular-nums">
              {lowMain} Low in MAIN
            </span>
          )}
          {lowKitchen > 0 && (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white tabular-nums animate-pulse">
              {lowKitchen} Low in KITCHEN
            </span>
          )}
          {pendingItos > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 tabular-nums">
              {pendingItos} ITO pending
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {canRequestIto && (
            <button
              onClick={() => { setShowRequestIto(v => !v); setShowReceive(false) }}
              className={[
                'rounded-lg px-3 py-1.5 text-xs font-bold transition border',
                showRequestIto
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100',
              ].join(' ')}
            >
              {showRequestIto ? 'Close ITO Form' : '+ Request Transfer'}
            </button>
          )}
          {canReceive && (
            <button
              onClick={() => { setShowReceive(v => !v); setShowRequestIto(false) }}
              className={[
                'rounded-lg px-3 py-1.5 text-xs font-bold transition border',
                showReceive
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {showReceive ? 'Close Receive Form' : '+ Receive into MAIN'}
            </button>
          )}
          <button
            onClick={() => void Promise.all([fetchMainStock(), fetchKitchenStock(), fetchItos()])}
            title="Refresh all"
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* ── Sliding action panels ── */}
      {showReceive && canReceive && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <h2 className="mb-3 text-sm font-bold text-slate-800">
            Receive Supplier Delivery into MAIN Warehouse (FR-IV-08)
          </h2>
          <ReceiveForm
            ingredients={ingredients}
            onSuccess={() => {
              void fetchMainStock()
              setShowReceive(false)
            }}
            onToast={addToast}
          />
        </div>
      )}

      {showRequestIto && canRequestIto && (
        <div className="shrink-0 border-b border-teal-200 bg-teal-50 px-5 py-4 sm:px-6">
          <h2 className="mb-3 text-sm font-bold text-teal-800">
            Request Internal Transfer Order — MAIN → KITCHEN (FR-IV-03)
          </h2>
          <ItoRequestForm
            ingredients={ingredients}
            onSuccess={() => {
              void fetchItos()
              setShowRequestIto(false)
            }}
            onToast={addToast}
          />
        </div>
      )}

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden flex-col xl:flex-row gap-0">

        {/* ── Left: two-tier stock tables ── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 min-w-0">
          {/* Two-tier tables: side-by-side on lg+, stacked on smaller */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StockTable
              title="MAIN Warehouse"
              tier="MAIN"
              rows={mainStock}
              loading={mainLoading}
              error={mainError}
              alertedIds={alertedIds}
            />
            <StockTable
              title="KITCHEN Warehouse"
              tier="KITCHEN"
              rows={kitchenStock}
              loading={kitchenLoading}
              error={kitchenError}
              alertedIds={alertedIds}
            />
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-100 border border-red-300" />
              Below threshold — repurchase or ITO required
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100 border border-emerald-300" />
              Stock OK
            </span>
            <span className="ml-auto text-[11px] italic">Real-time via stock.updated</span>
          </div>
        </main>

        {/* ── Right: ITO panel ── */}
        <aside className="w-full shrink-0 border-t border-gray-200 bg-gray-50 xl:w-80 xl:border-t-0 xl:border-l overflow-y-auto">
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800">
                Transfer Orders (ITO)
              </h2>
              {pendingItos > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 tabular-nums">
                  {pendingItos} pending
                </span>
              )}
            </div>

            {/* Role hint */}
            {!canConfirmIto && !canRequestIto && (
              <p className="mb-3 text-xs text-gray-400 italic">
                View only — your role cannot request or confirm ITOs.
              </p>
            )}
            {canRequestIto && !canConfirmIto && (
              <p className="mb-3 text-xs text-gray-400 italic">
                You can request ITOs. Warehouse personnel confirm them.
              </p>
            )}
            {canConfirmIto && (
              <p className="mb-3 text-xs text-gray-400 italic">
                Confirming an ITO atomically moves stock MAIN → KITCHEN.
              </p>
            )}

            <ItoList
              itos={itos}
              loading={itosLoading}
              error={itosError}
              canConfirm={canConfirmIto}
              confirming={confirming}
              onConfirm={id => void handleConfirmIto(id)}
            />
          </div>
        </aside>
      </div>

      {/* ── Toast notifications ── */}
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

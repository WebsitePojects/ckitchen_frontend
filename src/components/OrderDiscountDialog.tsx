/**
 * OrderDiscountDialog — apply + review discounts on a single order.
 *
 * Wires the 3-layer discount/approval backend (catalog discounts + ad-hoc
 * discounts + AUTO/SUPERVISOR/ADMIN approval gating) to the Orders page.
 * Controlled component: the parent (Orders.tsx) owns `open`/`order` state —
 * this dialog has no DialogTrigger of its own, matching the
 * WalkInOrderDialog/BrandActivityLog pattern already used on this page.
 *
 * Two ways to apply a discount:
 *  - Catalog: pick a pre-seeded `Discount` row (Senior/PWD/promo/etc) by id.
 *  - Custom / ad-hoc: pick a type + value directly (no catalog id).
 * Both require a `reason`; SENIOR/PWD additionally require `id_note` (the
 * backend 400s without it) — the form only shows/requires that field when
 * the effective type is SENIOR or PWD, whichever path produced it.
 *
 * NOTE: this is discount APPLICATION only — creating/editing catalog
 * discounts (promos) is out of scope for this pass (noted as a follow-up in
 * the PR/report); the catalog here is read-only.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Percent, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { CKApiError, get, post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import EmptyState from './common/EmptyState'

// ─── Types ────────────────────────────────────────────────────────────────

/** Minimal order shape the dialog needs — Orders.tsx's `Order` row satisfies this structurally. */
export interface DiscountOrderRef {
  id: string
  brandId: string
  externalRef: string
}

type DiscountType = 'PERCENT' | 'FIXED' | 'SENIOR' | 'PWD' | 'VOUCHER'
type ApprovalLevel = 'AUTO' | 'SUPERVISOR' | 'ADMIN'
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** Catalog row — `GET /discounts`. */
interface CatalogDiscount {
  id: string
  scope: 'ITEM' | 'ORDER'
  brandId?: string | null
  menuItemId?: string | null
  name: string
  type: DiscountType
  value: number | string
  code?: string | null
  vatExempt: boolean
  active: boolean
}

/** Applied discount row — `GET /orders/:id/discounts` → `.discounts[]`. */
interface OrderDiscount {
  id: string
  type: DiscountType
  label: string
  amount: number | string
  approvalLevel: ApprovalLevel
  status: ApprovalStatus
  reason: string
  idNote?: string | null
  requestedBy: string
  approvedBy?: string | null
  approvedAt?: string | null
}

interface OrderDiscountsResponse {
  subtotal: number | string
  discount_total: number | string
  effective_total: number | string
  discounts: OrderDiscount[]
}

/**
 * POST /orders/:id/discounts response shape is loosely specified ("returns
 * the created order_discount + the order's new effective total") — parsed
 * defensively below to cover a couple of plausible field names rather than
 * assuming one exact shape. The list itself is always re-fetched from GET
 * afterward regardless, so this is only used for the success toast copy.
 */
interface ApplyDiscountResponse {
  status?: ApprovalStatus
  approvalLevel?: ApprovalLevel
  orderDiscount?: Partial<OrderDiscount>
  discount?: Partial<OrderDiscount>
  order_discount?: Partial<OrderDiscount>
}

interface OrderDiscountDialogProps {
  order: DiscountOrderRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a discount is successfully applied — lets Orders.tsx refresh its approvals badge count. */
  onChanged?: () => void
}

const CUSTOM_SENTINEL = '__custom__'
const DISCOUNT_TYPES: DiscountType[] = ['PERCENT', 'FIXED', 'SENIOR', 'PWD', 'VOUCHER']

const STATUS_BADGE_CLASS: Record<ApprovalStatus, string> = {
  APPROVED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  REJECTED: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const LEVEL_LABEL: Record<ApprovalLevel, string> = {
  AUTO: 'Auto-approved',
  SUPERVISOR: 'Needs Supervisor',
  ADMIN: 'Needs Admin',
}

function money(n: number | string | undefined): string {
  return `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function requiresIdNote(type: DiscountType | undefined): boolean {
  return type === 'SENIOR' || type === 'PWD'
}

function formatCatalogValue(d: CatalogDiscount): string {
  const v = Number(d.value)
  return d.type === 'FIXED' || d.type === 'VOUCHER' ? `${money(v)} off` : `${v}% off`
}

export default function OrderDiscountDialog({ order, open, onOpenChange, onChanged }: OrderDiscountDialogProps) {
  const queryClient = useQueryClient()

  const [selectedValue, setSelectedValue] = useState('') // catalog discount id, or CUSTOM_SENTINEL
  const [customType, setCustomType] = useState<DiscountType>('PERCENT')
  const [customValue, setCustomValue] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [reason, setReason] = useState('')
  const [idNote, setIdNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function resetForm() {
    setSelectedValue('')
    setCustomType('PERCENT')
    setCustomValue('')
    setCustomLabel('')
    setReason('')
    setIdNote('')
  }

  // Fresh form whenever the dialog opens (or targets a different order) —
  // avoids carrying a half-filled form from a previously-viewed order.
  useEffect(() => {
    if (open) resetForm()
  }, [open, order?.id])

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) resetForm()
  }

  // ── Applied discounts + totals (GET /orders/:id/discounts) ──────────────
  const {
    data: summary,
    isLoading: loadingSummary,
    error: summaryError,
  } = useQuery({
    queryKey: ['order-discounts', order?.id],
    queryFn: async () => (await get<OrderDiscountsResponse>(`/orders/${order!.id}/discounts`)).data,
    enabled: open && !!order,
  })

  // ── Discount catalog (GET /discounts) ────────────────────────────────────
  // This endpoint applies at the ORDER level, so only ORDER-scope catalog
  // entries are offered here (ITEM-scope discounts belong on a per-item flow,
  // out of scope for this pass) — plus only entries that are active and
  // either brand-agnostic or scoped to this order's brand.
  const {
    data: catalog = [],
    isLoading: loadingCatalog,
    error: catalogError,
  } = useQuery({
    queryKey: ['discount-catalog'],
    queryFn: async () => (await get<CatalogDiscount[]>('/discounts')).data,
    enabled: open,
  })
  const applicableCatalog = useMemo(
    () =>
      catalog.filter(
        (d) => d.active && d.scope === 'ORDER' && (!d.brandId || d.brandId === order?.brandId),
      ),
    [catalog, order?.brandId],
  )

  const isCustom = selectedValue === CUSTOM_SENTINEL
  const selectedCatalog = applicableCatalog.find((d) => d.id === selectedValue)
  const effectiveType: DiscountType | undefined = isCustom ? customType : selectedCatalog?.type
  const idNoteRequired = requiresIdNote(effectiveType)

  const dataError = summaryError ?? catalogError
  const dataErrorMsg = dataError
    ? dataError instanceof Error ? dataError.message : 'Failed to load discount data.'
    : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!order || !selectedValue) return
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      toast.error('A reason is required to apply a discount.')
      return
    }
    if (idNoteRequired && !idNote.trim()) {
      toast.error('Senior/PWD discounts require an ID note.')
      return
    }
    if (isCustom && (!customValue.trim() || Number.isNaN(Number(customValue)) || Number(customValue) <= 0)) {
      toast.error('Enter a valid discount value.')
      return
    }

    setSubmitting(true)
    try {
      const body = isCustom
        ? {
            type: customType,
            value: Number(customValue),
            label: customLabel.trim() || undefined,
            reason: trimmedReason,
            ...(idNote.trim() ? { id_note: idNote.trim() } : {}),
          }
        : {
            discount_id: selectedValue,
            reason: trimmedReason,
            ...(idNote.trim() ? { id_note: idNote.trim() } : {}),
          }

      const res = await post<ApplyDiscountResponse>(`/orders/${order.id}/discounts`, body)
      const created = res.data?.orderDiscount ?? res.data?.discount ?? res.data?.order_discount
      const status = created?.status ?? res.data?.status
      const level = created?.approvalLevel ?? res.data?.approvalLevel

      if (status === 'PENDING') {
        toast.success('Discount submitted — pending approval', {
          description: level ? `Requires ${LEVEL_LABEL[level]}.` : undefined,
        })
      } else {
        toast.success('Discount applied')
      }

      resetForm()
      await queryClient.invalidateQueries({ queryKey: ['order-discounts', order.id] })
      onChanged?.()
    } catch (err) {
      // 409 AGGREGATOR_ORDER: manual discounts are walk-in (OTHER) only —
      // Orders.tsx already hides the trigger for FOODPANDA/GRABFOOD rows, but
      // a stale list (order re-ingested/edited since load) can still get here.
      if (err instanceof CKApiError && err.code === 'AGGREGATOR_ORDER') {
        toast.error('Discounts are not allowed on aggregator orders', {
          description:
            'Manual discounts apply to walk-in orders only — Foodpanda/GrabFood totals are set by the platform.',
        })
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to apply discount.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Discount — {order?.externalRef ?? 'Order'}</DialogTitle>
          <DialogDescription>
            Apply a catalog or ad-hoc discount. Larger discounts route to Supervisor/Admin
            approval before they count toward the effective total.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {dataErrorMsg && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
              {dataErrorMsg}
            </p>
          )}

          {/* Totals summary */}
          {loadingSummary ? (
            <p className="text-sm text-zinc-500">Loading discount summary…</p>
          ) : summary ? (
            <div className="space-y-1 rounded-md border border-border bg-background/40 p-3 text-sm">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(summary.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Discount total</span>
                <span className="tabular-nums text-emerald-400">−{money(summary.discount_total)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-1.5 font-semibold text-zinc-50">
                <span>Effective total</span>
                <span className="tabular-nums">{money(summary.effective_total)}</span>
              </div>
            </div>
          ) : null}

          {/* Applied discounts */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Applied Discounts</label>
            {loadingSummary ? null : !summary || summary.discounts.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No discounts applied"
                description="Apply a discount below."
                className="border-none bg-transparent py-6"
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {summary.discounts.map((d) => (
                  <li key={d.id} className="space-y-1 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{d.label}</span>
                      <span className="shrink-0 tabular-nums text-zinc-300">−{money(d.amount)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={STATUS_BADGE_CLASS[d.status]}>
                        {d.status}
                      </Badge>
                      <Badge variant="outline" className="border-zinc-600/50 bg-zinc-800/60 text-zinc-400">
                        {LEVEL_LABEL[d.approvalLevel]}
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500">Reason: {d.reason}</p>
                    {d.idNote && <p className="text-xs text-zinc-500">ID note: {d.idNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Apply discount form */}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 border-t border-border pt-3">
            <label className="text-xs font-medium text-zinc-400">Apply Discount</label>

            <Select value={selectedValue} onValueChange={setSelectedValue} disabled={loadingCatalog}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCatalog ? 'Loading…' : 'Select a discount…'} />
              </SelectTrigger>
              <SelectContent>
                {applicableCatalog.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} — {formatCatalogValue(d)}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SENTINEL}>Custom / ad-hoc discount…</SelectItem>
              </SelectContent>
            </Select>

            {isCustom && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Type</label>
                  <Select value={customType} onValueChange={(v) => setCustomType(v as DiscountType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DISCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">
                    Value {customType === 'PERCENT' || customType === 'SENIOR' || customType === 'PWD' ? '(%)' : '(₱)'}
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Label (optional)</label>
                  <Input
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="e.g. Manager comp"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Reason (required)</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this discount applied?" />
            </div>

            {idNoteRequired && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  ID Note (required for Senior/PWD)
                </label>
                <Input
                  value={idNote}
                  onChange={(e) => setIdNote(e.target.value)}
                  placeholder="Senior/PWD ID number or note"
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={submitting}>
                Close
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !selectedValue}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Percent className="h-3.5 w-3.5" />
                {submitting ? 'Applying…' : 'Apply Discount'}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

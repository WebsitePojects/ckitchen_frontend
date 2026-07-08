/**
 * DiscountApprovalsDialog — SUPERVISOR/ADMIN approval queue for discounts.
 *
 * Controlled component opened from an "Approvals" toolbar button on
 * Orders.tsx, gated there to OUTLET_MANAGER+ (OWNER passes automatically via
 * hasRole's short-circuit). Lists `GET /discounts/approvals?status=PENDING`
 * and lets an approver Approve/Reject each row. The backend re-checks the
 * approver's role per action (SUPERVISOR level needs OUTLET_MANAGER/OWNER,
 * ADMIN level needs OWNER) — a 403 here means this user's role clears the
 * page-level gate but not this specific row's level; surfaced via toast
 * rather than assumed impossible.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import EmptyState from './common/EmptyState'

type DiscountType = 'PERCENT' | 'FIXED' | 'SENIOR' | 'PWD' | 'VOUCHER'
type ApprovalLevel = 'SUPERVISOR' | 'ADMIN'

/** Pending row — `GET /discounts/approvals?status=PENDING`. Order ref is optional per the API contract ("if only ids, that's fine"). */
interface PendingApproval {
  id: string
  type: DiscountType
  label: string
  amount: number | string
  approvalLevel: ApprovalLevel
  status: 'PENDING'
  reason: string
  idNote?: string | null
  requestedBy: string
  orderId?: string
  order?: { id: string; externalRef?: string } | null
}

interface DiscountApprovalsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after every approve/reject — lets Orders.tsx refresh its toolbar badge count immediately. */
  onChanged?: () => void
}

const LEVEL_LABEL: Record<ApprovalLevel, string> = {
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin',
}

function money(n: number | string | undefined): string {
  return `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function orderRefFor(row: PendingApproval): string {
  return row.order?.externalRef ?? row.orderId ?? row.order?.id ?? '—'
}

export default function DiscountApprovalsDialog({ open, onOpenChange, onChanged }: DiscountApprovalsDialogProps) {
  const queryClient = useQueryClient()
  const [actioningId, setActioningId] = useState<string | null>(null)

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['discount-approvals'],
    queryFn: async () =>
      (await get<PendingApproval[]>('/discounts/approvals', { params: { status: 'PENDING' } })).data,
    enabled: open,
  })

  async function afterAction() {
    await queryClient.invalidateQueries({ queryKey: ['discount-approvals'] })
    // Broad prefix invalidation — any currently-mounted OrderDiscountDialog
    // for the affected order (or any other) picks up the new status too.
    queryClient.invalidateQueries({ queryKey: ['order-discounts'] })
    onChanged?.()
  }

  async function handleApprove(id: string) {
    setActioningId(id)
    try {
      await post(`/order-discounts/${id}/approve`)
      toast.success('Discount approved')
      await afterAction()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve discount.')
    } finally {
      setActioningId(null)
    }
  }

  async function handleReject(id: string) {
    setActioningId(id)
    try {
      await post(`/order-discounts/${id}/reject`)
      toast.success('Discount rejected')
      await afterAction()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject discount.')
    } finally {
      setActioningId(null)
    }
  }

  const errorMsg = error ? (error instanceof Error ? error.message : 'Failed to load approvals.') : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Discount Approvals</DialogTitle>
          <DialogDescription>Discounts pending Supervisor or Admin sign-off.</DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-zinc-500">Loading approvals…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No pending approvals"
            description="Every discount is auto-approved or already resolved."
            className="border-none bg-transparent py-10"
          />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-200">
                      {row.label}{' '}
                      <span className="font-mono text-xs text-zinc-500">· {orderRefFor(row)}</span>
                    </p>
                    <p className="text-xs text-zinc-500">Requested by {row.requestedBy}</p>
                  </div>
                  <span className="shrink-0 tabular-nums font-semibold text-zinc-100">
                    −{money(row.amount)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="border-zinc-600/50 bg-zinc-800/60 text-zinc-400">
                    {row.type}
                  </Badge>
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
                    Needs {LEVEL_LABEL[row.approvalLevel]}
                  </Badge>
                </div>

                <p className="text-xs text-zinc-500">Reason: {row.reason}</p>
                {row.idNote && <p className="text-xs text-zinc-500">ID note: {row.idNote}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    disabled={actioningId === row.id}
                    onClick={() => void handleReject(row.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                    disabled={actioningId === row.id}
                    onClick={() => void handleApprove(row.id)}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {actioningId === row.id ? 'Working…' : 'Approve'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

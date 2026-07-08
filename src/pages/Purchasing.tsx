/**
 * Purchasing — Purchase Requests → approval → Purchase Orders → Receiving
 * (ERP R3, CK1-ERP-006 §4). First UI over the fully-built backend module
 * (ckitchen_backend/src/modules/purchasing/routes.ts).
 *
 * Flow: requester raises a PR (DRAFT) → Submit (budget-checked: over-budget
 * WARNS, never blocks — BUDGET_ENFORCEMENT='WARN') → OWNER approves/rejects →
 * purchasing raises a PO (optionally FROM the approved PR) → Send → warehouse
 * receives (RR posts stock IN to the receiving user's MAIN warehouse).
 *
 * Role gates mirror the backend requireRole sets exactly (OWNER always passes
 * via hasRole's short-circuit):
 *   REQUESTER_ROLES = OWNER, PURCHASING, WAREHOUSE_OUTLET, KITCHEN_CREW
 *   APPROVER_ROLES  = OWNER
 *   PO_ROLES        = OWNER, PURCHASING
 *   RECEIVE_ROLES   = OWNER, WAREHOUSE_OUTLET
 */
import { useCallback, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  PackageCheck,
  Plus,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import DataTable from '../components/common/DataTable'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import PurchaseRequestDialog from '../components/purchasing/PurchaseRequestDialog'
import PurchaseOrderDialog, { type PoPrefill } from '../components/purchasing/PurchaseOrderDialog'
import ReceiveDialog from '../components/purchasing/ReceiveDialog'
import {
  deptLabel,
  num,
  peso,
  statusPillClass,
  type BudgetWarning,
  type Ingredient,
  type PrStatus,
  type PurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseRequest,
  type PurchaseRequestDetail,
  type ReceivingReport,
  type SupplierParty,
} from '../components/purchasing/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

const PR_STATUSES: PrStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CLOSED']

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusPillClass(status)}`}
    >
      {status}
    </span>
  )
}

/** Full supplier row from GET /suppliers (superset of SupplierParty). */
interface SupplierRow extends SupplierParty {
  contactName: string | null
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Purchasing() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Backend requireRole mirrors (OWNER short-circuits inside hasRole).
  const canRequest = hasRole(user?.role, ['PURCHASING', 'WAREHOUSE_OUTLET', 'KITCHEN_CREW'])
  const canApprove = hasRole(user?.role, []) // OWNER only
  const canPo = hasRole(user?.role, ['PURCHASING'])
  const canReceive = hasRole(user?.role, ['WAREHOUSE_OUTLET'])

  // ── Base lists ────────────────────────────────────────────────────────────
  const { data: prs = [], isLoading: prsLoading } = useQuery({
    queryKey: ['purchase-requests'],
    queryFn: async () => (await get<PurchaseRequest[]>('/purchase-requests')).data,
  })
  const { data: pos = [], isLoading: posLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => (await get<PurchaseOrder[]>('/purchase-orders')).data,
  })
  const { data: rrs = [], isLoading: rrsLoading } = useQuery({
    queryKey: ['receiving-reports'],
    queryFn: async () => (await get<ReceivingReport[]>('/receiving-reports')).data,
  })
  // Same key as MasterData so the lists share one cache entry.
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['masterdata', 'suppliers'],
    queryFn: async () => (await get<SupplierRow[]>('/suppliers')).data,
  })
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => (await get<Ingredient[]>('/ingredients')).data,
  })

  const activeSuppliers = useMemo(() => allSuppliers.filter((s) => s.isActive), [allSuppliers])
  const supplierById = useMemo(() => new Map(allSuppliers.map((s) => [s.id, s])), [allSuppliers])
  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos])

  // Resolve an RR's supplier name defensively — direct receipts carry supplier
  // info on the row itself (no PO to join through); PO-based ones fall back to
  // the linked PO's supplier.
  const resolveRrSupplier = useCallback(
    (r: ReceivingReport): string => {
      if (r.supplier?.name) return r.supplier.name
      if (r.supplierId) return supplierById.get(r.supplierId)?.name ?? '—'
      const po = r.poId ? poById.get(r.poId) : null
      return po ? supplierById.get(po.supplierId)?.name ?? '—' : '—'
    },
    [supplierById, poById],
  )

  // ── Per-row details (lines) for items-count / totals ─────────────────────
  // The list endpoints return bare rows (no lines); details are fetched per row
  // in parallel and cached under ['pr-detail'|'po-detail'|'rr-detail', id] so
  // dialogs (Create-PO prefill, Receive) reuse them.
  const prDetailQueries = useQueries({
    queries: prs.map((pr) => ({
      queryKey: ['pr-detail', pr.id],
      queryFn: async () =>
        (await get<PurchaseRequestDetail>(`/purchase-requests/${pr.id}`)).data,
      staleTime: 60_000,
    })),
  })
  const poDetailQueries = useQueries({
    queries: pos.map((po) => ({
      queryKey: ['po-detail', po.id],
      queryFn: async () => (await get<PurchaseOrderDetail>(`/purchase-orders/${po.id}`)).data,
      staleTime: 60_000,
    })),
  })
  const rrDetailQueries = useQueries({
    queries: rrs.map((rr) => ({
      queryKey: ['rr-detail', rr.id],
      queryFn: async () =>
        (await get<ReceivingReport & { lines: unknown[] }>(`/receiving-reports/${rr.id}`)).data,
      staleTime: 60_000,
    })),
  })

  const prDetails = useMemo(() => {
    const m = new Map<string, PurchaseRequestDetail>()
    for (const q of prDetailQueries) if (q.data) m.set(q.data.id, q.data)
    return m
  }, [prDetailQueries])
  const poDetails = useMemo(() => {
    const m = new Map<string, PurchaseOrderDetail>()
    for (const q of poDetailQueries) if (q.data) m.set(q.data.id, q.data)
    return m
  }, [poDetailQueries])
  const rrLineCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const q of rrDetailQueries) if (q.data) m.set(q.data.id, q.data.lines.length)
    return m
  }, [rrDetailQueries])

  // ── Dialog + busy state ───────────────────────────────────────────────────
  const [prDialogOpen, setPrDialogOpen] = useState(false)
  const [poDialogOpen, setPoDialogOpen] = useState(false)
  const [poPrefill, setPoPrefill] = useState<PoPrefill | null>(null)
  const [receivePo, setReceivePo] = useState<PurchaseOrder | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  function invalidatePrs() {
    void queryClient.invalidateQueries({ queryKey: ['purchase-requests'] })
    void queryClient.invalidateQueries({ queryKey: ['pr-detail'] })
    // Submits move committed spend — refresh the Master Data budget widgets.
    void queryClient.invalidateQueries({ queryKey: ['budgets'] })
    void queryClient.invalidateQueries({ queryKey: ['budget-status'] })
  }

  // ── PR actions (mirror backend transitions) ───────────────────────────────
  async function submitPr(pr: PurchaseRequest) {
    setBusy(`submit:${pr.id}`)
    try {
      const res = await post<PurchaseRequest & { budget_warning?: BudgetWarning }>(
        `/purchase-requests/${pr.id}/submit`,
      )
      const bw = res.data.budget_warning
      if (bw) {
        // WARN-only enforcement: the backend submitted it anyway — surface amber.
        toast.warning(`${pr.prNo} submitted — over budget`, {
          description: `${deptLabel(pr.department)} goes ${peso(bw.over_by)} over its monthly budget (budget ${peso(bw.budget)}, already committed ${peso(bw.committed)}). The approver decides.`,
          duration: 9000,
        })
      } else {
        toast.success(`${pr.prNo} submitted for approval.`)
      }
      invalidatePrs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit request.')
    } finally {
      setBusy(null)
    }
  }

  async function decidePr(pr: PurchaseRequest, action: 'approve' | 'reject') {
    setBusy(`${action}:${pr.id}`)
    try {
      await post(`/purchase-requests/${pr.id}/${action}`)
      toast.success(`${pr.prNo} ${action === 'approve' ? 'approved' : 'rejected'}.`)
      invalidatePrs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} request.`)
    } finally {
      setBusy(null)
    }
  }

  async function createPoFromPr(pr: PurchaseRequest) {
    setBusy(`po-from:${pr.id}`)
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['pr-detail', pr.id],
        queryFn: async () =>
          (await get<PurchaseRequestDetail>(`/purchase-requests/${pr.id}`)).data,
        staleTime: 60_000,
      })
      setPoPrefill({
        prId: pr.id,
        prNo: pr.prNo,
        lines: detail.lines.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: num(l.quantity),
          estUnitCost: num(l.estUnitCost),
        })),
      })
      setPoDialogOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the request lines.')
    } finally {
      setBusy(null)
    }
  }

  // ── PO actions ────────────────────────────────────────────────────────────
  async function sendPo(po: PurchaseOrder) {
    setBusy(`send:${po.id}`)
    try {
      await post(`/purchase-orders/${po.id}/send`)
      toast.success(`${po.poNo} sent to ${supplierById.get(po.supplierId)?.name ?? 'supplier'}.`)
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['po-detail'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send purchase order.')
    } finally {
      setBusy(null)
    }
  }

  // ── Sorted rows (newest first) ────────────────────────────────────────────
  const prRows = useMemo(
    () => [...prs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [prs],
  )
  const poRows = useMemo(
    () => [...pos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [pos],
  )
  const rrRows = useMemo(
    () => [...rrs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rrs],
  )

  const prCounts = useMemo(() => {
    const counts: Record<PrStatus, number> = {
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      REJECTED: 0,
      CLOSED: 0,
    }
    for (const pr of prs) counts[pr.status] = (counts[pr.status] ?? 0) + 1
    return counts
  }, [prs])

  // ── Columns ───────────────────────────────────────────────────────────────
  const prColumns = useMemo<ColumnDef<PurchaseRequest, unknown>[]>(
    () => [
      {
        id: 'prNo',
        header: 'Request',
        accessorFn: (r) => r.prNo,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-300">{row.original.prNo}</span>
        ),
      },
      {
        id: 'department',
        header: 'Department',
        accessorFn: (r) => deptLabel(r.department),
      },
      {
        id: 'items',
        header: 'Items',
        accessorFn: (r) => prDetails.get(r.id)?.lines.length ?? 0,
        cell: ({ row }) => {
          const d = prDetails.get(row.original.id)
          return <span className="tabular-nums">{d ? d.lines.length : '…'}</span>
        },
      },
      {
        id: 'total',
        header: 'Est. total',
        accessorFn: (r) =>
          prDetails
            .get(r.id)
            ?.lines.reduce((s, l) => s + num(l.quantity) * num(l.estUnitCost), 0) ?? 0,
        cell: ({ row }) => {
          const d = prDetails.get(row.original.id)
          if (!d) return <span className="text-zinc-600">…</span>
          const t = d.lines.reduce((s, l) => s + num(l.quantity) * num(l.estUnitCost), 0)
          return <span className="tabular-nums">{peso(t)}</span>
        },
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
      {
        id: 'requestedBy',
        header: 'Requested by',
        accessorFn: (r) => (r.requestedByUserId === user?.id ? 'You' : r.requestedByUserId),
        cell: ({ row }) =>
          row.original.requestedByUserId === user?.id ? (
            <span className="text-emerald-400">You</span>
          ) : (
            <span className="font-mono text-xs text-zinc-500" title={row.original.requestedByUserId}>
              {row.original.requestedByUserId.slice(0, 8)}
            </span>
          ),
      },
      {
        id: 'date',
        header: 'Date',
        accessorFn: (r) => r.createdAt,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-zinc-400">{fmtDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const pr = row.original
          return (
            <div className="flex justify-end gap-1.5">
              {pr.status === 'DRAFT' && canRequest && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void submitPr(pr)}
                  disabled={busy === `submit:${pr.id}`}
                  className="h-7 text-xs"
                >
                  <Send className="h-3 w-3" />
                  Submit
                </Button>
              )}
              {pr.status === 'SUBMITTED' && canApprove && (
                <>
                  <Button
                    size="sm"
                    onClick={() => void decidePr(pr, 'approve')}
                    disabled={busy === `approve:${pr.id}`}
                    className="h-7 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decidePr(pr, 'reject')}
                    disabled={busy === `reject:${pr.id}`}
                    className="h-7 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <XCircle className="h-3 w-3" />
                    Reject
                  </Button>
                </>
              )}
              {pr.status === 'APPROVED' && canPo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void createPoFromPr(pr)}
                  disabled={busy === `po-from:${pr.id}`}
                  className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                >
                  <FilePlus2 className="h-3 w-3" />
                  Create PO
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prDetails, user?.id, canRequest, canApprove, canPo, busy],
  )

  const poColumns = useMemo<ColumnDef<PurchaseOrder, unknown>[]>(
    () => [
      {
        id: 'poNo',
        header: 'PO',
        accessorFn: (r) => r.poNo,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-300">{row.original.poNo}</span>
        ),
      },
      {
        id: 'supplier',
        header: 'Supplier',
        accessorFn: (r) => supplierById.get(r.supplierId)?.name ?? '—',
        cell: ({ row }) => {
          const s = supplierById.get(row.original.supplierId)
          return s ? (
            <span className="text-zinc-200">{s.name}</span>
          ) : (
            <span className="text-zinc-600">—</span>
          )
        },
      },
      {
        id: 'items',
        header: 'Items',
        accessorFn: (r) => poDetails.get(r.id)?.lines.length ?? 0,
        cell: ({ row }) => {
          const d = poDetails.get(row.original.id)
          return <span className="tabular-nums">{d ? d.lines.length : '…'}</span>
        },
      },
      {
        id: 'total',
        header: 'Total',
        accessorFn: (r) =>
          poDetails.get(r.id)?.lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0) ??
          0,
        cell: ({ row }) => {
          const d = poDetails.get(row.original.id)
          if (!d) return <span className="text-zinc-600">…</span>
          const t = d.lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0)
          return <span className="tabular-nums">{peso(t)}</span>
        },
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
      {
        id: 'date',
        header: 'Date',
        accessorFn: (r) => r.createdAt,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-zinc-400">{fmtDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const po = row.original
          return (
            <div className="flex justify-end gap-1.5">
              {po.status === 'DRAFT' && canPo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void sendPo(po)}
                  disabled={busy === `send:${po.id}`}
                  className="h-7 text-xs"
                >
                  <Send className="h-3 w-3" />
                  Send
                </Button>
              )}
              {(po.status === 'SENT' || po.status === 'PARTIAL') && canReceive && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReceivePo(po)
                    setReceiveOpen(true)
                  }}
                  className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                >
                  <PackageCheck className="h-3 w-3" />
                  Receive
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poDetails, supplierById, canPo, canReceive, busy],
  )

  const rrColumns = useMemo<ColumnDef<ReceivingReport, unknown>[]>(
    () => [
      {
        id: 'rrNo',
        header: 'Receiving report',
        accessorFn: (r) => r.rrNo,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-300">{row.original.rrNo}</span>
        ),
      },
      {
        id: 'po',
        header: 'PO',
        accessorFn: (r) => (r.poId ? poById.get(r.poId)?.poNo ?? '—' : 'Direct'),
        cell: ({ row }) => {
          const poId = row.original.poId
          if (!poId) {
            return (
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 ring-1 ring-inset ring-zinc-500/30">
                Direct
              </span>
            )
          }
          return (
            <span className="font-mono text-xs text-zinc-400">
              {poById.get(poId)?.poNo ?? '—'}
            </span>
          )
        },
      },
      {
        id: 'supplier',
        header: 'Supplier',
        accessorFn: (r) => resolveRrSupplier(r),
        cell: ({ row }) => {
          const name = resolveRrSupplier(row.original)
          return name === '—' ? (
            <span className="text-zinc-600">—</span>
          ) : (
            <span className="text-zinc-200">{name}</span>
          )
        },
      },
      {
        id: 'lines',
        header: 'Lines',
        accessorFn: (r) => rrLineCounts.get(r.id) ?? 0,
        cell: ({ row }) => {
          const n = rrLineCounts.get(row.original.id)
          return <span className="tabular-nums">{n ?? '…'}</span>
        },
      },
      {
        id: 'date',
        header: 'Received',
        accessorFn: (r) => r.createdAt,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-zinc-400">{fmtDate(row.original.createdAt)}</span>
        ),
      },
    ],
    [poById, supplierById, rrLineCounts, resolveRrSupplier],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Purchasing"
        subtitle="Purchase requests, purchase orders, and receiving into the main warehouse"
      />

      <Tabs defaultValue="pr">
        <TabsList>
          <TabsTrigger value="pr">Purchase Requests</TabsTrigger>
          <TabsTrigger value="po">Purchase Orders</TabsTrigger>
          <TabsTrigger value="rr">Receiving</TabsTrigger>
        </TabsList>

        {/* ── Purchase Requests ── */}
        <TabsContent value="pr" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {PR_STATUSES.map((s) => (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusPillClass(s)}`}
              >
                {s}
                <span className="tabular-nums">{prCounts[s]}</span>
              </span>
            ))}
            <div className="ml-auto">
              {canRequest && (
                <Button onClick={() => setPrDialogOpen(true)} variant="outline">
                  <Plus className="h-4 w-4" />
                  New Request
                </Button>
              )}
            </div>
          </div>
          <DataTable
            columns={prColumns}
            data={prRows}
            loading={prsLoading}
            searchPlaceholder="Search requests…"
            emptyTitle="No purchase requests"
            emptyDescription={
              canRequest
                ? 'Raise your first request — it starts as DRAFT and goes to the owner for approval.'
                : 'Requests raised by purchasing, warehouse, or kitchen will appear here.'
            }
          />
        </TabsContent>

        {/* ── Purchase Orders ── */}
        <TabsContent value="po" className="mt-4 space-y-4">
          <div className="flex items-center justify-end">
            {canPo && (
              <Button
                onClick={() => {
                  setPoPrefill(null)
                  setPoDialogOpen(true)
                }}
                variant="outline"
              >
                <Plus className="h-4 w-4" />
                New PO
              </Button>
            )}
          </div>
          <DataTable
            columns={poColumns}
            data={poRows}
            loading={posLoading}
            searchPlaceholder="Search purchase orders…"
            emptyTitle="No purchase orders"
            emptyDescription={
              canPo
                ? 'Raise a PO directly, or approve a purchase request and create one from it.'
                : 'Purchase orders raised by purchasing will appear here.'
            }
          />
        </TabsContent>

        {/* ── Receiving ── */}
        <TabsContent value="rr" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Receiving reports post stock into the MAIN warehouse and write the stock ledger.
          </div>
          <DataTable
            columns={rrColumns}
            data={rrRows}
            loading={rrsLoading}
            searchPlaceholder="Search receiving reports…"
            emptyTitle="No receiving reports"
            emptyDescription="Receive a SENT purchase order to post the first one."
          />
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      <PurchaseRequestDialog
        open={prDialogOpen}
        onOpenChange={setPrDialogOpen}
        ingredients={ingredients}
      />
      <PurchaseOrderDialog
        open={poDialogOpen}
        onOpenChange={(o) => {
          setPoDialogOpen(o)
          if (!o) setPoPrefill(null)
        }}
        suppliers={activeSuppliers}
        ingredients={ingredients}
        prefill={poPrefill}
      />
      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={(o) => {
          setReceiveOpen(o)
          if (!o) setReceivePo(null)
        }}
        po={receivePo}
        ingredients={ingredients}
      />
    </PageContainer>
  )
}

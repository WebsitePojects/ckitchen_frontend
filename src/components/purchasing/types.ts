/**
 * Shared types + helpers for the Purchasing page (src/pages/Purchasing.tsx) and
 * its dialogs. Mirrors the backend contracts in
 * ckitchen_backend/src/modules/purchasing/routes.ts (coded against exactly):
 *
 *   GET  /purchase-requests[?status=&department=]  → PurchaseRequest[] (bare rows, no lines)
 *   GET  /purchase-requests/:id                    → { ...pr, lines: PrLine[] }
 *   POST /purchase-requests   { department, notes?, lines:[{ ingredient_id, quantity, est_unit_cost? }] }
 *   POST /purchase-requests/:id/submit  → pr  (may include budget_warning)
 *   POST /purchase-requests/:id/approve → pr
 *   POST /purchase-requests/:id/reject  → pr
 *   GET  /purchase-orders[?status=&supplier_id=]   → PurchaseOrder[] (bare rows, no lines)
 *   GET  /purchase-orders/:id                      → { ...po, lines: PoLine[] }
 *   POST /purchase-orders     { supplier_id, pr_id?, notes?, lines:[{ ingredient_id, quantity, unit_cost? }] }
 *   POST /purchase-orders/:id/send     → po
 *   POST /purchase-orders/:id/receive  { notes?, lines:[{ po_line_id, qty_received }] } → rr
 *   GET  /receiving-reports            → ReceivingReport[] (bare rows)
 */

// ─── Enums (mirror backend pgEnums) ──────────────────────────────────────────

export const DEPARTMENTS = [
  'KITCHEN',
  'WAREHOUSE',
  'PURCHASING',
  'SALES',
  'PRODUCTION',
  'QA',
  'ACCOUNTING',
  'ADMIN',
] as const
export type Department = (typeof DEPARTMENTS)[number]

export type PrStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CLOSED'
export type PoStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

// ─── Row shapes ──────────────────────────────────────────────────────────────

export interface Ingredient {
  id: string
  name: string
  unit: string
  unitCost: string
  lowStockThreshold: string
  /** Affiliated suppliers embedded by GET /ingredients (empty array when none). */
  suppliers: { supplierId: string; name: string; code: string }[]
}

export interface SupplierParty {
  id: string
  code: string
  name: string
  isActive: boolean
  paymentTermDays?: number
}

/** One affiliation row from GET /ingredients/:id/suppliers. */
export interface IngredientSupplier {
  id: string
  supplierId: string
  supplierSku: string | null
  lastUnitCost: string | number | null
  supplier: { id: string; code: string; name: string; isActive: boolean }
}

export interface PurchaseRequest {
  id: string
  prNo: string
  department: Department
  status: PrStatus
  requestedByUserId: string
  approvedByUserId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface PrLine {
  id: string
  prId: string
  ingredientId: string
  quantity: string
  estUnitCost: string
}

export interface PurchaseRequestDetail extends PurchaseRequest {
  lines: PrLine[]
}

export interface PurchaseOrder {
  id: string
  poNo: string
  supplierId: string
  prId: string | null
  status: PoStatus
  createdByUserId: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface PoLine {
  id: string
  poId: string
  ingredientId: string
  quantity: string
  unitCost: string
  qtyReceived: string
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PoLine[]
}

export interface ReceivingReport {
  id: string
  rrNo: string
  /** null for a direct receipt (received into MAIN without a purchase order). */
  poId: string | null
  /** Present on direct receipts (and, when the backend joins it, PO-based ones). */
  supplierId?: string | null
  supplier?: { id: string; code: string; name: string } | null
  warehouseId: string
  receivedByUserId: string
  notes: string | null
  createdAt: string
}

/** Present on POST /purchase-requests/:id/submit when the PR pushes committed over budget. */
export interface BudgetWarning {
  over_by: number
  budget: number
  committed: number
}

// ─── Formatting + status colors ──────────────────────────────────────────────

export function peso(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '₱0.00'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '₱0.00'
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

export function deptLabel(d: string): string {
  return d.charAt(0) + d.slice(1).toLowerCase()
}

/** Tailwind pill classes per PR/PO status — mirrors lib/theme.ts badge style. */
export function statusPillClass(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'RECEIVED':
      return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30'
    case 'SUBMITTED':
    case 'SENT':
      return 'bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/30'
    case 'PARTIAL':
      return 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30'
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30'
    default: // DRAFT / CLOSED
      return 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30'
  }
}

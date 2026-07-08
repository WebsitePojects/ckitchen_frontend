/**
 * DepartmentBudgets — first cut of the purchasing budget-threshold feature
 * (Minutes of Meeting 2026-06-24: "budget threshold for orders and cost").
 * Self-contained card rendered inside MasterData.tsx (Purchasing landing
 * page). Reads/writes the live backend contract:
 *   GET  /budgets?period=YYYY-MM              -> Array<{department, periodMonth, amount, note?}>
 *   PUT  /budgets  {department, period_month, amount, note?}   (OWNER/ACCOUNTING only)
 *   GET  /budgets/:department/status?period=YYYY-MM -> {department, period, budget, committed, remaining}
 *
 * Departments are the backend enum (KITCHEN, WAREHOUSE, PURCHASING, SALES,
 * PRODUCTION) unioned with any extra department strings the API happens to
 * return in GET /budgets rows — so a department the org has budgeted for
 * shows even before the frontend's hardcoded list knows its name, while a
 * department with NO budget row yet still shows (with a "no budget set"
 * empty state) so OWNER/ACCOUNTING can set one.
 *
 * Defensive by design: every fetch defaults to an empty/zeroed shape rather
 * than throwing into the page, since the backend for this endpoint may not
 * be deployed yet (built in parallel against this same contract).
 */
import { useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Save, Wallet, X as XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { get, put } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Button } from './ui/button'

interface BudgetRow {
  department: string
  periodMonth: string
  amount: number
  note?: string
}

interface BudgetStatus {
  department: string
  period: string
  budget: number
  committed: number
  remaining: number
}

const DEFAULT_DEPARTMENTS = ['KITCHEN', 'WAREHOUSE', 'PURCHASING', 'SALES', 'PRODUCTION']

/** Same ₱ + thousands + 2-decimal convention as DiscountApprovalsDialog/OrderDiscountDialog. */
function money(n: number | undefined): string {
  return `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

export default function DepartmentBudgets() {
  const { user } = useAuth()
  // OWNER auto-passes via hasRole's short-circuit; ACCOUNTING is the other writer per the spec.
  const canEdit = hasRole(user?.role, ['ACCOUNTING'])
  const queryClient = useQueryClient()

  const period = useMemo(() => currentPeriod(), [])

  const { data: budgetRows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ['budgets', period],
    queryFn: async () => (await get<BudgetRow[]>('/budgets', { params: { period } })).data,
  })

  const departments = useMemo(() => {
    const extra = budgetRows
      .map((r) => r.department)
      .filter((d) => !DEFAULT_DEPARTMENTS.includes(d))
    return [...DEFAULT_DEPARTMENTS, ...Array.from(new Set(extra)).sort()]
  }, [budgetRows])

  const statusQueries = useQueries({
    queries: departments.map((dept) => ({
      queryKey: ['budget-status', dept, period],
      queryFn: async () => (await get<BudgetStatus>(`/budgets/${dept}/status`, { params: { period } })).data,
    })),
  })

  const [editing, setEditing] = useState<string | null>(null)
  const [amountDraft, setAmountDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit(dept: string, current: number) {
    setEditing(dept)
    setAmountDraft(current ? String(current) : '')
  }

  function cancelEdit() {
    setEditing(null)
    setAmountDraft('')
  }

  async function saveEdit(dept: string) {
    const amount = Number(amountDraft)
    if (!amountDraft.trim() || Number.isNaN(amount) || amount < 0) {
      toast.error('Enter a valid non-negative budget amount.')
      return
    }
    setSaving(true)
    try {
      await put('/budgets', { department: dept, period_month: period, amount })
      toast.success(`${dept} budget set to ${money(amount)} for ${periodLabel(period)}`)
      // Broad prefix invalidation: refreshes the list + every department's status card.
      void queryClient.invalidateQueries({ queryKey: ['budgets'] })
      void queryClient.invalidateQueries({ queryKey: ['budget-status'] })
      cancelEdit()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save budget.')
    } finally {
      setSaving(false)
    }
  }

  const initialLoading = rowsLoading && budgetRows.length === 0

  return (
    <Card className="border-border bg-card">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-emerald-400" />
          Department Budgets
        </CardTitle>
        <CardDescription>
          {periodLabel(period)} — committed purchase spend against each department&apos;s monthly budget
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {initialLoading ? (
          <p className="py-4 text-sm text-zinc-500">Loading budgets…</p>
        ) : (
          departments.map((dept, i) => {
            const status = statusQueries[i]?.data
            const row = budgetRows.find((r) => r.department === dept)
            const budget = status?.budget ?? row?.amount ?? 0
            const committed = status?.committed ?? 0
            const remaining = status?.remaining ?? budget - committed
            const hasBudget = budget > 0
            const pct = hasBudget ? Math.max(0, Math.min(100, (committed / budget) * 100)) : 0

            let textClass = 'text-emerald-400'
            let barClass = 'bg-emerald-500'
            if (!hasBudget) {
              textClass = 'text-zinc-500'
              barClass = 'bg-zinc-600'
            } else if (remaining < 0) {
              textClass = 'text-red-400'
              barClass = 'bg-red-500'
            } else if (remaining / budget < 0.2) {
              textClass = 'text-amber-400'
              barClass = 'bg-amber-500'
            }

            const isEditing = editing === dept

            return (
              <div key={dept} className="rounded-lg border border-border/60 bg-zinc-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100">{dept}</p>
                    {row?.note && <p className="truncate text-xs text-zinc-500">{row.note}</p>}
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        autoFocus
                        value={amountDraft}
                        onChange={(e) => setAmountDraft(e.target.value)}
                        placeholder="Amount"
                        className="h-8 w-32"
                      />
                      <Button size="sm" onClick={() => void saveEdit(dept)} disabled={saving}>
                        <Save className="mr-1 h-3.5 w-3.5" />
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-right">
                        <p className="text-[11px] text-zinc-500">Budget</p>
                        <p className="text-sm font-semibold tabular-nums text-zinc-100">{money(budget)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-zinc-500">Committed</p>
                        <p className="text-sm font-semibold tabular-nums text-zinc-300">{money(committed)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-zinc-500">Remaining</p>
                        <p className={`text-sm font-semibold tabular-nums ${textClass}`}>{money(remaining)}</p>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="outline" onClick={() => startEdit(dept, budget)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full rounded-full transition-all duration-300 ${barClass}`} style={{ width: `${pct}%` }} />
                </div>
                {!hasBudget && (
                  <p className="mt-1 text-[11px] text-zinc-600">
                    No budget set for {periodLabel(period)}{canEdit ? ' — click Edit to set one.' : '.'}
                  </p>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

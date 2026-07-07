/**
 * SimulatorPanel — Start / Stop the order simulator (FR-IN-03)
 *
 * Calls POST /simulator/start  { brand_ids, rate_per_min }
 *       POST /simulator/stop
 *
 * SUPER_ADMIN only on the backend; the panel is visible to all authenticated
 * users in the prototype (RBAC enforced server-side per Business Rule #10).
 *
 * `running`/`loading`/`error` now live in SimulatorContext (mounted at the
 * app root — see App.tsx), not local state: this panel lives on the
 * Dashboard, so navigating away and back used to unmount/remount it and
 * lose track of an already-running backend simulator. The context hydrates
 * from GET /simulator/status on load, so returning here reflects the real
 * backend state instead of always showing "Start".
 */
import { useEffect, useState } from 'react'
import { Activity, Play, Square } from 'lucide-react'
import type { Brand } from '../pages/Dashboard'
import { useSimulator } from '../context/SimulatorContext'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface Props {
  brands: Brand[]
}

export default function SimulatorPanel({ brands }: Props) {
  const { running, brandIds: ctxBrandIds, rate: ctxRate, loading, error, start, stop } = useSimulator()

  const [selectedIds, setSelectedIds] = useState<string[]>(ctxBrandIds)
  const [rate, setRate]               = useState<number>(ctxRate)
  // Validation errors (empty selection / out-of-range rate) are checked
  // client-side before ever calling the context — kept local since they're
  // not API failures. Rendered alongside the context's `error` below.
  const [validationError, setValidationError] = useState<string | null>(null)

  // Sync local selection/rate from the context whenever it reports the
  // simulator as running — covers both the initial GET /simulator/status
  // hydration (which resolves asynchronously, after this panel's first
  // render) and a fresh mount while it was already running (e.g. navigated
  // away and back). Without this, the brand chips/rate input would show
  // empty/default values even though the simulator is actually running with
  // a real brand selection.
  useEffect(() => {
    if (running) {
      setSelectedIds(ctxBrandIds)
      setRate(ctxRate)
    }
  }, [running, ctxBrandIds, ctxRate])

  function toggleBrand(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id],
    )
  }

  function selectAll() {
    setSelectedIds(activeBrands.map(b => b.id))
  }

  function clearAll() {
    setSelectedIds([])
  }

  async function handleStart() {
    if (selectedIds.length === 0) {
      setValidationError('Select at least one brand to simulate.')
      return
    }
    if (Number.isNaN(rate) || rate < 0.1 || rate > 60) {
      setValidationError('Rate must be a number between 0.1 and 60 orders/min.')
      return
    }
    setValidationError(null)
    await start(selectedIds, rate)
  }

  async function handleStop() {
    setValidationError(null)
    await stop()
  }

  const activeBrands = brands.filter(b => b.isActive)

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-200">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" aria-hidden />
            Order Simulator
          </span>
          {running && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Running
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Brand toggles */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Brands
            </span>
            {!running && activeBrands.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded text-xs text-emerald-500 transition-colors duration-200 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded text-xs text-zinc-500 transition-colors duration-200 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  None
                </button>
              </div>
            )}
          </div>

          {activeBrands.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No active brands</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeBrands.map(brand => {
                const selected = selectedIds.includes(brand.id)
                return (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => toggleBrand(brand.id)}
                    disabled={running}
                    className={[
                      'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition duration-200',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                      selected
                        ? 'text-white ring-transparent'
                        : 'bg-transparent text-zinc-400 ring-zinc-700 hover:ring-zinc-500',
                    ].join(' ')}
                    style={selected ? { backgroundColor: brand.color, borderColor: brand.color } : {}}
                  >
                    {brand.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Rate */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500 shrink-0">
            Rate
          </label>
          <input
            type="number"
            min={0.1}
            max={60}
            step={0.1}
            value={rate}
            onChange={e => setRate(Number(e.target.value))}
            disabled={running}
            className={[
              'w-16 rounded-md border border-border bg-background px-2 py-1 text-xs text-zinc-200',
              'tabular-nums focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          />
          <span className="text-xs text-zinc-500">orders / min</span>
        </div>

        {/* Start / Stop */}
        {!running ? (
          <Button
            onClick={() => void handleStart()}
            disabled={loading || activeBrands.length === 0}
            className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            size="sm"
          >
            <Play className="h-3.5 w-3.5" />
            {loading ? 'Starting...' : 'Start Simulator'}
          </Button>
        ) : (
          <Button
            onClick={() => void handleStop()}
            disabled={loading}
            variant="destructive"
            className="w-full"
            size="sm"
          >
            <Square className="h-3.5 w-3.5" />
            {loading ? 'Stopping...' : 'Stop Simulator'}
          </Button>
        )}

        {/* Error — client-side validation takes priority over a stale API error */}
        {(validationError ?? error) && (
          <p className="text-xs text-red-400">{validationError ?? error}</p>
        )}

        {/* Helper note */}
        <p className="text-[10px] leading-snug text-zinc-600">
          Orders will appear in the feed in real time. Only SUPER_ADMIN can start/stop the simulator.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * SimulatorPanel — Start / Stop the order simulator (FR-IN-03)
 *
 * Calls POST /simulator/start  { brand_ids, rate_per_min }
 *       POST /simulator/stop
 *
 * SUPER_ADMIN only on the backend; the panel is visible to all authenticated
 * users in the prototype (RBAC enforced server-side per Business Rule #10).
 */
import { useState } from 'react'
import { post } from '../lib/api'
import type { Brand } from '../pages/Dashboard'
import type { CKApiError } from '../lib/api'

interface Props {
  brands: Brand[]
}

export default function SimulatorPanel({ brands }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rate, setRate]               = useState<number>(2)
  const [running, setRunning]         = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  function toggleBrand(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id],
    )
  }

  function selectAll() {
    setSelectedIds(brands.filter(b => b.isActive).map(b => b.id))
  }

  function clearAll() {
    setSelectedIds([])
  }

  async function handleStart() {
    if (selectedIds.length === 0) {
      setError('Select at least one brand to simulate.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await post('/simulator/start', { brand_ids: selectedIds, rate_per_min: rate })
      setRunning(true)
    } catch (e) {
      const ce = e as CKApiError
      setError(ce?.message ?? 'Failed to start simulator.')
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    setError(null)
    try {
      await post('/simulator/stop')
      setRunning(false)
    } catch (e) {
      const ce = e as CKApiError
      setError(ce?.message ?? 'Failed to stop simulator.')
    } finally {
      setLoading(false)
    }
  }

  const activebrands = brands.filter(b => b.isActive)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <span
            className={[
              'h-2 w-2 rounded-full',
              running ? 'bg-green-500 animate-pulse' : 'bg-gray-300',
            ].join(' ')}
          />
          Order Simulator
        </h2>
        {running && (
          <span className="text-xs text-green-600 font-medium">Running</span>
        )}
      </div>

      {/* Brand toggles */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">Brands</span>
          {!running && activebrands.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-brand-600 hover:underline"
              >
                All
              </button>
              <button
                onClick={clearAll}
                className="text-xs text-gray-400 hover:underline"
              >
                None
              </button>
            </div>
          )}
        </div>

        {activebrands.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No active brands</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activebrands.map(brand => {
              const selected = selectedIds.includes(brand.id)
              return (
                <button
                  key={brand.id}
                  onClick={() => toggleBrand(brand.id)}
                  disabled={running}
                  className={[
                    'rounded-full px-2.5 py-0.5 text-xs font-medium border transition',
                    selected
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50',
                  ].join(' ')}
                  style={
                    selected
                      ? { backgroundColor: brand.color, borderColor: brand.color }
                      : {}
                  }
                >
                  {brand.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Rate */}
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">Rate</label>
        <input
          type="number"
          min={0.1}
          max={60}
          step={0.1}
          value={rate}
          onChange={e => setRate(Number(e.target.value))}
          disabled={running}
          className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-xs text-gray-400">orders / min</span>
      </div>

      {/* Start / Stop */}
      {!running ? (
        <button
          onClick={() => void handleStart()}
          disabled={loading || activebrands.length === 0}
          className="w-full rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Starting…' : 'Start Simulator'}
        </button>
      ) : (
        <button
          onClick={() => void handleStop()}
          disabled={loading}
          className="w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Stopping…' : 'Stop Simulator'}
        </button>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {/* Helper note */}
      <p className="mt-3 text-[10px] text-gray-400 leading-snug">
        Orders will appear in the feed in real time.
        Only SUPER_ADMIN can start/stop the simulator.
      </p>
    </div>
  )
}

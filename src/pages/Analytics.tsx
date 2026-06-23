/**
 * Analytics — Per-brand performance & aggregator split
 * Stub page. Full implementation: Task 14 (FR-AN).
 * Will show per-brand revenue ranking (flag weakest), orders-by-hour chart,
 * aggregator split (FoodPanda / GrabFood / other), and margin analysis.
 */
export default function Analytics() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      <p className="mt-2 text-sm text-gray-500">
        Per-brand revenue ranking, orders by hour, aggregator split, and margin analysis.
        <br />
        <span className="italic text-gray-400">Full implementation in Task 14.</span>
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-4xl">📊</p>
        <p className="mt-3 text-sm font-medium text-gray-600">No analytics data yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Analytics surface after orders are ingested and processed.
        </p>
      </div>
    </div>
  )
}

/**
 * Dashboard — Unified Order Feed
 * Stub page. Full implementation: Task 11 (FR-OD-01..07).
 * Will show real-time orders across all brands/aggregators with brand color
 * labels, aggregator badges, and a distinct audible alert on order.created.
 */
export default function Dashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Order Dashboard</h1>
      <p className="mt-2 text-sm text-gray-500">
        Unified real-time feed across all brands and aggregators.
        <br />
        <span className="italic text-gray-400">Full implementation in Task 11.</span>
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-4xl">📋</p>
        <p className="mt-3 text-sm font-medium text-gray-600">No orders yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Start the backend simulator or ingest a manual order to see the feed.
        </p>
      </div>
    </div>
  )
}

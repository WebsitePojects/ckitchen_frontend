/**
 * Kitchen Display — Station-grouped active orders
 * Stub page. Full implementation: Task 12 (FR-KD-01..05).
 * Will show station-grouped active orders, elapsed prep time, one-click
 * stage advance (NEW→PREPARING→READY→COMPLETED), overdue highlights.
 */
export default function Kitchen() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Kitchen Display</h1>
      <p className="mt-2 text-sm text-gray-500">
        Station-grouped active orders with stage controls.
        <br />
        <span className="italic text-gray-400">Full implementation in Task 12.</span>
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-4xl">🍳</p>
        <p className="mt-3 text-sm font-medium text-gray-600">No active orders</p>
        <p className="mt-1 text-xs text-gray-400">
          Orders in NEW or PREPARING state will appear here.
        </p>
      </div>
    </div>
  )
}

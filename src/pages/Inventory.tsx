/**
 * Inventory — Two-tier stock view + ITO management
 * Stub page. Full implementation: Task 13 (FR-IV).
 * Will show MAIN + KITCHEN warehouse stock, below-threshold highlights,
 * ITO request/confirm flow, and lowstock.alert toasts.
 */
export default function Inventory() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
      <p className="mt-2 text-sm text-gray-500">
        Two-tier stock (MAIN + KITCHEN warehouses), ITO requests, and low-stock alerts.
        <br />
        <span className="italic text-gray-400">Full implementation in Task 13.</span>
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-4xl">📦</p>
        <p className="mt-3 text-sm font-medium text-gray-600">Stock data not loaded</p>
        <p className="mt-1 text-xs text-gray-400">
          Connect to the backend to view MAIN and KITCHEN warehouse levels.
        </p>
      </div>
    </div>
  )
}

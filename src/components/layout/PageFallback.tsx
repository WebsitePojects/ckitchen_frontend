/**
 * Shown only while a page's code chunk is still downloading (rare: chunks are prefetched
 * on sidebar hover and during idle time). A layout-shaped skeleton instead of a spinner,
 * so the screen does not jump when the page arrives. Same gutters as PageContainer.
 */
export default function PageFallback() {
  return (
    <div className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6" role="status" aria-label="Loading page">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-muted/50" />
    </div>
  )
}

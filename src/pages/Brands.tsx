import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tags, CheckCircle2, XCircle, Store, History } from 'lucide-react'
import { get } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Card, CardContent } from '../components/ui/card'
import BrandActivityLog from '../components/BrandActivityLog'

interface Brand {
  id: string
  name: string
  color: string
  logoUrl?: string | null
  salesPerfId?: string | null
  isActive: boolean
}

export default function Brands() {
  const { selectedOutletId } = useOutlet()

  // Cache-first (perf): navigating back to Brands from another page shows
  // the last-fetched list instantly instead of a fresh loading spinner.
  // Keyed by selectedOutletId per the outlet-cache-correctness rule — GET
  // /brands isn't currently outlet-filtered server-side (it returns every
  // brand regardless of X-Outlet-Id), but keying by outlet anyway means this
  // stays correct for free if/when that filtering lands, at the cost of one
  // extra (identical) fetch per outlet switch today.
  const {
    data: brands = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
  })
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load brands') : null

  // Per-brand activity dialog state (MOTM 2026-07-01 #10) — the dialog itself
  // owns fetching (via useQuery) for whichever brand+month is selected.
  const [activityBrand, setActivityBrand] = useState<Brand | null>(null)

  const active = useMemo(() => brands.filter((b) => b.isActive).length, [brands])

  return (
    <PageContainer>
      <PageHeader title="Brands" subtitle="Every food brand under this cloud kitchen" />

      <KpiRibbon>
        <KpiCard icon={Tags} label="Total Brands" value={brands.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={active} />
        <KpiCard icon={XCircle} label="Inactive" value={brands.length - active} />
        <KpiCard icon={Store} label="Location" value="1" />
      </KpiRibbon>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading brands…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : brands.length === 0 ? (
        <EmptyState icon={Tags} title="No brands" description="Add a brand from Merchant Management." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {brands.map((b) => (
            <Card key={b.id} className="border-border bg-card">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                    style={{ backgroundColor: b.color }}
                  >
                    {b.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-100">{b.name}</p>
                    <p className="text-xs text-zinc-500">{b.salesPerfId ?? 'No sales ID'}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${b.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                    />
                    <span className={b.isActive ? 'text-emerald-400' : 'text-zinc-500'}>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: b.color }} />
                    {b.color}
                  </span>
                </div>
                <button
                  onClick={() => setActivityBrand(b)}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors duration-200 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <History className="h-3.5 w-3.5" />
                  Activity log
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Brand activity log dialog (MOTM 2026-07-01 #10) ── */}
      <BrandActivityLog
        brand={activityBrand}
        open={activityBrand !== null}
        onOpenChange={(o) => { if (!o) setActivityBrand(null) }}
      />
    </PageContainer>
  )
}

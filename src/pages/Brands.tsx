import { useEffect, useMemo, useState } from 'react'
import { Tags, CheckCircle2, XCircle, Store } from 'lucide-react'
import { get } from '../lib/api'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Card, CardContent } from '../components/ui/card'

interface Brand {
  id: string
  name: string
  color: string
  logoUrl?: string | null
  salesPerfId?: string | null
  isActive: boolean
}

export default function Brands() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    get<Brand[]>('/brands')
      .then((r) => alive && setBrands(r.data))
      .catch((e) => alive && setError(e?.message ?? 'Failed to load brands'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const active = useMemo(() => brands.filter((b) => b.isActive).length, [brands])

  return (
    <div className="space-y-5">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

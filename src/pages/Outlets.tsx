import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2 } from 'lucide-react'
import { get } from '../lib/api'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import EmptyState from '../components/common/EmptyState'
import { Card } from '../components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

interface Brand {
  id: string
  name: string
  color: string
}
interface Account {
  id: string
  aggregator: string
  externalMerchantId?: string
  external_merchant_id?: string
  isActive?: boolean
  is_active?: boolean
}
interface Outlet {
  id: string
  brand: Brand
  aggregator: string
  merchantId: string
  active: boolean
}

export default function Outlets() {
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: brands } = await get<Brand[]>('/brands')
        const lists = await Promise.all(
          brands.map((b) =>
            get<Account[]>(`/brands/${b.id}/accounts`)
              .then((r) => ({ brand: b, accounts: r.data }))
              .catch(() => ({ brand: b, accounts: [] as Account[] })),
          ),
        )
        if (!alive) return
        const flat: Outlet[] = []
        for (const { brand, accounts } of lists) {
          for (const a of accounts) {
            flat.push({
              id: a.id,
              brand,
              aggregator: a.aggregator,
              merchantId: a.externalMerchantId ?? a.external_merchant_id ?? '—',
              active: a.isActive ?? a.is_active ?? true,
            })
          }
        }
        setOutlets(flat)
      } catch (e) {
        if (alive) setError((e as { message?: string })?.message ?? 'Failed to load outlets')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const fp = outlets.filter((o) => o.aggregator === 'FOODPANDA').length
    const gf = outlets.filter((o) => o.aggregator === 'GRABFOOD').length
    const active = outlets.filter((o) => o.active).length
    return { fp, gf, active }
  }, [outlets])

  return (
    <div className="space-y-5">
      <PageHeader title="Outlets" subtitle="Each brand's listing on a delivery platform" />

      <KpiRibbon>
        <KpiCard icon={Building2} label="Total Outlets" value={outlets.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={stats.active} />
        <KpiCard icon={Building2} label="foodpanda" value={stats.fp} />
        <KpiCard icon={Building2} label="GrabFood" value={stats.gf} />
      </KpiRibbon>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading outlets…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : outlets.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No outlets"
            description="Add aggregator accounts to brands from Merchant Management."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Brand</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Merchant ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlets.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell><BrandChip brand={o.brand} /></TableCell>
                  <TableCell><AggregatorBadge aggregator={o.aggregator} /></TableCell>
                  <TableCell className="font-mono text-xs text-zinc-400">{o.merchantId}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full ${o.active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                      <span className={o.active ? 'text-emerald-400' : 'text-zinc-500'}>
                        {o.active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

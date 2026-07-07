import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Link2 } from 'lucide-react'
import { get } from '../lib/api'
import PageContainer from '../components/layout/PageContainer'
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

interface ChannelListing {
  id: string
  brand: Brand
  aggregator: string
  merchantId: string
  active: boolean
}

export default function ChannelListings() {
  const [listings, setListings] = useState<ChannelListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: brands } = await get<Brand[]>('/brands')
        const lists = await Promise.all(
          brands.map((brand) =>
            get<Account[]>(`/brands/${brand.id}/accounts`)
              .then((response) => ({ brand, accounts: response.data }))
              .catch(() => ({ brand, accounts: [] as Account[] })),
          ),
        )
        if (!alive) return

        const flat: ChannelListing[] = []
        for (const { brand, accounts } of lists) {
          for (const account of accounts) {
            flat.push({
              id: account.id,
              brand,
              aggregator: account.aggregator,
              merchantId: account.externalMerchantId ?? account.external_merchant_id ?? '—',
              active: account.isActive ?? account.is_active ?? true,
            })
          }
        }
        setListings(flat)
      } catch (e) {
        if (alive) setError((e as { message?: string })?.message ?? 'Failed to load listings')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const foodpanda = listings.filter((listing) => listing.aggregator === 'FOODPANDA').length
    const grabfood = listings.filter((listing) => listing.aggregator === 'GRABFOOD').length
    const active = listings.filter((listing) => listing.active).length
    return { foodpanda, grabfood, active }
  }, [listings])

  return (
    <PageContainer>
      <PageHeader
        title="Channel Listings"
        subtitle="Each brand's Foodpanda, GrabFood, or delivery-platform merchant listing"
      />

      <KpiRibbon>
        <KpiCard icon={Link2} label="Total Listings" value={listings.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={stats.active} />
        <KpiCard icon={Link2} label="foodpanda" value={stats.foodpanda} />
        <KpiCard icon={Link2} label="GrabFood" value={stats.grabfood} />
      </KpiRibbon>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading channel listings…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No channel listings"
            description="Add Foodpanda or GrabFood accounts to brands from Merchant Management."
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
              {listings.map((listing) => (
                <TableRow key={listing.id} className="border-border">
                  <TableCell>
                    <BrandChip brand={listing.brand} />
                  </TableCell>
                  <TableCell>
                    <AggregatorBadge aggregator={listing.aggregator} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-400">
                    {listing.merchantId}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          listing.active ? 'bg-emerald-400' : 'bg-zinc-600'
                        }`}
                      />
                      <span className={listing.active ? 'text-emerald-400' : 'text-zinc-500'}>
                        {listing.active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  )
}

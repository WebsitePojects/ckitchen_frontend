import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Link2, Radio } from 'lucide-react'
import { get } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import type { ListingChannel } from '../lib/salesChannels'
import SalesChannelsPanel from '../components/channels/SalesChannelsPanel'
import { outletScopedPath } from '../lib/outletScope'
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
  channel?: ListingChannel | null
}

interface ChannelListing {
  id: string
  brand: Brand
  aggregator: string
  channel: ListingChannel | null
  merchantId: string
  active: boolean
}

export default function ChannelListings() {
  // Outlet-scoping leak fix: this page used to fetch every brand platform-wide
  // with no outlet dependency at all, so switching the header outlet never
  // refetched it — a Cubao user would keep seeing CloudKitchen ONE's brands
  // and listings. `?location_id=` (backend, parallel wave) scopes GET /brands
  // to brands deployed at that outlet; selectedOutletId in the effect's deps
  // makes an outlet switch actually re-run the fetch.
  const { selectedOutletId } = useOutlet()
  const { user } = useAuth()
  const isOwner = hasRole(user?.role, [])

  // One cached query (keyed by outlet) so "Offer at all brands" can refresh it.
  const listingsQuery = useQuery({
    queryKey: ['channel-listings', selectedOutletId],
    queryFn: async (): Promise<ChannelListing[]> => {
      const { data: brands } = await get<Brand[]>(outletScopedPath('/brands', selectedOutletId))
      const lists = await Promise.all(
        brands.map((brand) =>
          get<Account[]>(`/brands/${brand.id}/accounts`)
            .then((response) => ({ brand, accounts: response.data }))
            .catch(() => ({ brand, accounts: [] as Account[] })),
        ),
      )
      return lists.flatMap(({ brand, accounts }) =>
        accounts.map((account) => ({
          id: account.id,
          brand,
          aggregator: account.aggregator,
          channel: account.channel ?? null,
          merchantId: account.externalMerchantId ?? account.external_merchant_id ?? '—',
          active: account.isActive ?? account.is_active ?? true,
        })),
      )
    },
  })
  const listings = useMemo(() => listingsQuery.data ?? [], [listingsQuery.data])
  const loading = listingsQuery.isPending
  const error = listingsQuery.isError ? (listingsQuery.error instanceof Error ? listingsQuery.error.message : 'Failed to load listings') : null

  const stats = useMemo(() => {
    const active = listings.filter((listing) => listing.active).length
    const channelsInUse = new Set(listings.filter((l) => l.active).map((l) => l.channel?.id ?? l.aggregator)).size
    return { active, channelsInUse }
  }, [listings])

  return (
    <PageContainer>
      <PageHeader
        title="Channel Listings"
        subtitle="Sales channels, and each brand's listing on them"
      />

      <SalesChannelsPanel canManage={isOwner} />

      <KpiRibbon>
        <KpiCard icon={Link2} label="Total Listings" value={listings.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={stats.active} />
        <KpiCard icon={Radio} label="Channels in use" value={stats.channelsInUse} />
      </KpiRibbon>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading channel listings…</p>
        ) : error ? (
          <p className="p-6 text-sm text-danger-text">{error}</p>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No channel listings"
            description="Add a brand's store ID for GrabFood or foodpanda in Merchant Management, or offer a manual channel above."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Brand</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Store ID</TableHead>
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
                    <AggregatorBadge aggregator={listing.aggregator} channel={listing.channel} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {/* Manual channels get a generated id nobody types; say what it means instead. */}
                    {listing.aggregator === 'OTHER' ? <span className="font-sans">Keyed in manually</span> : listing.merchantId}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          listing.active ? 'bg-emerald-400' : 'bg-zinc-600'
                        }`}
                      />
                      <span className={listing.active ? 'text-ink-accent' : 'text-muted-foreground'}>
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

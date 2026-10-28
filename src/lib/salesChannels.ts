/**
 * Sales channels (D60): GrabFood, foodpanda, Walk-in and the owner's own (Lalamove, phone…).
 * The server owns the list; screens never hard-code channel names.
 */
import { useQuery } from '@tanstack/react-query'
import { get } from './api'

export type ChannelIntegration = 'GRABFOOD' | 'FOODPANDA' | 'MANUAL'

export interface SalesChannel {
  id: string
  code: 'GRABFOOD' | 'FOODPANDA' | 'WALK_IN' | null
  name: string
  integration: ChannelIntegration
  color: string
  defaultCommissionRate: number | null
  defaultMarketingRate: number | null
  isActive: boolean
  isSystem: boolean
}

/** The channel a listing belongs to, as GET /brands/:id/accounts returns it. */
export interface ListingChannel {
  id: string
  name: string
  color: string
  integration: ChannelIntegration
  code?: SalesChannel['code']
  isActive?: boolean
}

export const SALES_CHANNELS_KEY = ['sales-channels'] as const

export function useSalesChannels(opts: { activeOnly?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...SALES_CHANNELS_KEY, opts.activeOnly ? 'active' : 'all'],
    queryFn: async () => (await get<SalesChannel[]>(`/sales-channels${opts.activeOnly ? '?active=true' : ''}`)).data,
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export const INTEGRATION_LABEL: Record<ChannelIntegration, string> = {
  GRABFOOD: 'GrabFood partner API',
  FOODPANDA: 'foodpanda partner API',
  MANUAL: 'Keyed in by staff',
}

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Store } from 'lucide-react'
import { patch, post, CKApiError } from '../../lib/api'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import { INTEGRATION_LABEL, SALES_CHANNELS_KEY, useSalesChannels, type SalesChannel } from '../../lib/salesChannels'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'

/**
 * Where the owner sets up sales channels (D60). GrabFood and foodpanda come with every
 * workspace (partner APIs); anything else (Lalamove, ShopeeFood, Facebook, phone) is added here
 * and keyed in from New Order. "Offer at all brands" creates the listing each brand outlet
 * needs for that channel, so it appears in New Order immediately.
 */
export default function SalesChannelsPanel({ canManage }: { canManage: boolean }) {
  const channels = useSalesChannels()
  const [editing, setEditing] = useState<SalesChannel | 'new' | null>(null)
  const queryClient = useQueryClient()
  const offer = useSubmitGuard()

  const offerAtAllBrands = offer.guard(async (channel: SalesChannel) => {
    try {
      const res = await post<{ created: number; activeListings: number }>(`/sales-channels/${channel.id}/listings`, {})
      toast.success(
        res.data.created > 0
          ? `${channel.name} added to ${res.data.created} brand outlet(s)`
          : `${channel.name} is already offered at every brand outlet`,
      )
      await queryClient.invalidateQueries({ queryKey: ['channel-listings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not offer the channel.')
    }
  })

  return (
    <section className="ledger-section" aria-labelledby="sales-channels-title">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="sales-channels-title" className="text-ws-section font-semibold text-foreground">
            Sales channels
          </h2>
          <p className="text-sm text-muted-foreground">
            Where orders come from. Add any delivery app or ordering channel; staff key its orders in from New Order.
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add channel
          </Button>
        )}
      </div>

      {channels.isPending ? (
        <p className="py-3 text-sm text-muted-foreground">Loading channels…</p>
      ) : channels.isError ? (
        <p className="py-3 text-sm text-danger-text">{channels.error instanceof Error ? channels.error.message : 'Could not load channels.'}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {(channels.data ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {c.name}
                  {!c.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">switched off</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {INTEGRATION_LABEL[c.integration]}
                  {c.defaultCommissionRate != null && ` · ${c.defaultCommissionRate}% commission`}
                  {c.defaultMarketingRate != null && ` · ${c.defaultMarketingRate}% marketing`}
                </p>
              </div>
              {canManage && c.integration === 'MANUAL' && c.code !== 'WALK_IN' && c.isActive && (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={offer.pending} onClick={() => void offerAtAllBrands(c)}>
                  <Store className="h-3.5 w-3.5" aria-hidden /> Offer at all brands
                </Button>
              )}
              {canManage && (
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <ChannelDialog channel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ChannelDialog({ channel, onClose }: { channel: SalesChannel | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { pending, guard } = useSubmitGuard()
  // One key per "add channel" intent; kept across a failed try so a retry replays.
  const requestId = useRef(crypto.randomUUID())
  const [name, setName] = useState(channel?.name ?? '')
  const [color, setColor] = useState(channel?.color ?? '#F16622')
  const [commission, setCommission] = useState(channel?.defaultCommissionRate?.toString() ?? '')
  const [marketing, setMarketing] = useState(channel?.defaultMarketingRate?.toString() ?? '')
  const [active, setActive] = useState(channel?.isActive ?? true)
  const [error, setError] = useState<string | null>(null)

  const rate = (v: string) => (v.trim() === '' ? null : Number(v))

  const submit = guard(async () => {
    const c = rate(commission)
    const m = rate(marketing)
    if (!name.trim()) return setError('Give the channel a name.')
    if ((c !== null && !(c >= 0 && c <= 100)) || (m !== null && !(m >= 0 && m <= 100))) return setError('Rates are percentages from 0 to 100.')
    setError(null)
    try {
      if (channel) {
        await patch(`/sales-channels/${channel.id}`, {
          name: name.trim(),
          color,
          default_commission_rate: c,
          default_marketing_rate: m,
          ...(channel.code === 'WALK_IN' ? {} : { is_active: active }),
        })
        toast.success(`${name.trim()} saved`)
      } else {
        await post('/sales-channels', {
          client_request_id: requestId.current,
          name: name.trim(),
          color,
          default_commission_rate: c,
          default_marketing_rate: m,
        })
        toast.success(`${name.trim()} added`, { description: 'Use "Offer at all brands" so it shows up in New Order.' })
      }
      await queryClient.invalidateQueries({ queryKey: SALES_CHANNELS_KEY })
      onClose()
    } catch (e) {
      setError(e instanceof CKApiError || e instanceof Error ? e.message : 'Could not save the channel.')
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{channel ? `Edit ${channel.name}` : 'Add a sales channel'}</DialogTitle>
          <DialogDescription>
            {channel?.integration && channel.integration !== 'MANUAL'
              ? 'Orders arrive through the partner API. You can rename it and set its default rates.'
              : 'Orders on this channel are keyed in by staff from New Order (no app integration needed).'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Lalamove, ShopeeFood, Phone orders" disabled={pending} autoFocus />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              Colour
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-10 p-1" disabled={pending} />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              Commission %
              <Input type="number" min="0" max="100" step="any" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" disabled={pending} />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              Marketing %
              <Input type="number" min="0" max="100" step="any" inputMode="decimal" value={marketing} onChange={(e) => setMarketing(e.target.value)} placeholder="0" disabled={pending} />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">Rates are defaults for new listings; each brand's listing can differ.</p>
          {channel && channel.code !== 'WALK_IN' && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={active} onCheckedChange={setActive} disabled={pending} aria-label="Channel active" />
              Active (shown in New Order)
            </label>
          )}
          {error && (
            <p className="text-xs text-danger-text" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : channel ? 'Save' : 'Add channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Link2, Loader2 } from 'lucide-react'
import { get, post } from '../../lib/api'
import { joinLinkUrl } from '../../lib/joinToken'
import type { OutletSummary } from '../../context/OutletContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import OutletMultiSelect from './OutletMultiSelect'
import { ROLES_V2, ROLE_LABEL, roleSeesAllOutlets } from './roles'

/** Mirrors GET/POST /admin/join-links (ckitchen_backend src/modules/join-links/routes.ts). */
interface JoinLink {
  id: string
  inviteeName: string
  role: string
  outletIds: string[]
  status: 'active' | 'used' | 'revoked' | 'expired'
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedByName: string | null
  /** Present only while the link can still be used. */
  token: string | null
}

const JOIN_LINKS_KEY = ['admin', 'join-links'] as const
const EXPIRY_CHOICES = [1, 3, 7, 14, 30] as const

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

function CopyLinkField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the field stays selectable.
    }
  }
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Join link" />
      <Button type="button" onClick={() => void copy()} className="shrink-0">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/**
 * "Create join link": the owner names the person, picks a role (and outlets for outlet
 * roles), and gets a one-time link to send by Messenger. No email needed; the person signs
 * in with any Google account.
 */
export function CreateJoinLinkDialog({ outlets }: { outlets: OutletSummary[] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('KITCHEN_CREW')
  const [outletIds, setOutletIds] = useState<string[]>([])
  const [days, setDays] = useState('7')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<JoinLink | null>(null)
  // One id per "create" intent: a retry after a timeout replays the same link on the server.
  const requestId = useRef<string>(crypto.randomUUID())

  function reset() {
    setName('')
    setRole('KITCHEN_CREW')
    setOutletIds(outlets.length === 1 ? [outlets[0]!.id] : [])
    setDays('7')
    setFormError(null)
    setCreated(null)
    requestId.current = crypto.randomUUID()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!name.trim()) {
      setFormError('Enter who this link is for.')
      return
    }
    const allOutlets = roleSeesAllOutlets(role)
    if (!allOutlets && outletIds.length === 0) {
      setFormError(`Pick at least one outlet: a ${ROLE_LABEL[role] ?? role} only sees the outlets you give them.`)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      const { data } = await post<JoinLink>('/admin/join-links', {
        invitee_name: name.trim(),
        role,
        outlet_ids: allOutlets ? [] : outletIds,
        expires_in_days: Number(days),
        request_id: requestId.current,
      })
      setCreated(data)
      void queryClient.invalidateQueries({ queryKey: JOIN_LINKS_KEY })
    } catch (err) {
      setFormError(errMsg(err, 'Could not create the link.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset()
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Link2 className="h-4 w-4" aria-hidden />
          Join link
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {created?.token ? (
          <>
            <DialogHeader>
              <DialogTitle>Link for {created.inviteeName}</DialogTitle>
              <DialogDescription>
                Send it by Messenger or Viber. They open it, sign in with any Google account, and join as{' '}
                <span className="font-medium text-foreground">{ROLE_LABEL[created.role] ?? created.role}</span>. It works once and
                expires {fmtDate(created.expiresAt)}. Anyone holding it can use it, so send it only to them.
              </DialogDescription>
            </DialogHeader>
            <CopyLinkField url={joinLinkUrl(created.token)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New join link</DialogTitle>
              <DialogDescription>No email needed. The person signs in with their own Google account.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="join-name" className="text-xs font-medium text-muted-foreground">Who is it for?</label>
                <Input id="join-name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} placeholder="e.g. Juan dela Cruz" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Select value={role} onValueChange={setRole} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES_V2.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {role === 'OWNER' && (
                  <p className="text-[11px] text-warn-text">An owner can see and change everything, including users and settings.</p>
                )}
              </div>
              {!roleSeesAllOutlets(role) && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Outlet access</label>
                  <OutletMultiSelect outlets={outlets} selected={outletIds} onChange={setOutletIds} disabled={submitting} />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Link expires after</label>
                <Select value={days} onValueChange={setDays} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPIRY_CHOICES.map((d) => (
                      <SelectItem key={d} value={String(d)}>{d === 1 ? '1 day' : `${d} days`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formError && <p role="alert" className="text-xs text-danger-text">{formError}</p>}
              <DialogFooter>
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? <><Loader2 className="animate-spin" aria-hidden /> Creating…</> : 'Create link'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function statusText(link: JoinLink): string {
  switch (link.status) {
    case 'active':
      return `Waiting · expires ${fmtDate(link.expiresAt)}`
    case 'used':
      return `Joined${link.usedByName ? ` as ${link.usedByName}` : ''} · ${link.usedAt ? fmtDate(link.usedAt) : ''}`
    case 'revoked':
      return 'Cancelled'
    case 'expired':
      return 'Expired'
  }
}

/** Recent join links: copy an unused one again, or cancel it. */
export default function JoinLinksPanel() {
  const queryClient = useQueryClient()
  const { data: links = [], isLoading, error } = useQuery({
    queryKey: JOIN_LINKS_KEY,
    queryFn: async () => (await get<JoinLink[]>('/admin/join-links')).data,
  })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Per-row guard: a double tap on Cancel must not send two requests (the ref stops a
  // second tap before React re-renders; the state disables the button).
  const revokingIds = useRef<Set<string>>(new Set())
  const [revokingId, setRevokingId] = useState<string | null>(null)

  async function copy(link: JoinLink) {
    if (!link.token) return
    try {
      await navigator.clipboard.writeText(joinLinkUrl(link.token))
      setCopiedId(link.id)
      setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2000)
    } catch {
      toast.error('Could not copy. Create the link again to see it in full.')
    }
  }

  async function revoke(link: JoinLink) {
    if (revokingIds.current.has(link.id)) return
    revokingIds.current.add(link.id)
    setRevokingId(link.id)
    try {
      await post(`/admin/join-links/${link.id}/revoke`)
      toast.success(`Link for ${link.inviteeName} cancelled`)
      void queryClient.invalidateQueries({ queryKey: JOIN_LINKS_KEY })
    } catch (err) {
      toast.error(errMsg(err, 'Could not cancel the link.'))
    } finally {
      revokingIds.current.delete(link.id)
      setRevokingId(null)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base text-foreground">Join links</CardTitle>
        <p className="text-ws-small text-muted-foreground">
          One-time links for people to join with their own Google account. Create one with Join link.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">Loading links…</p>
        ) : error ? (
          <p className="px-6 pb-4 text-sm text-danger-text">{errMsg(error, 'Failed to load join links.')}</p>
        ) : links.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">No join links yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {link.inviteeName}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{ROLE_LABEL[link.role] ?? link.role}</span>
                  </p>
                  <p className={link.status === 'active' ? 'text-xs text-ink-accent' : 'text-xs text-muted-foreground'}>
                    {statusText(link)}
                  </p>
                </div>
                {link.status === 'active' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void copy(link)}>
                      {copiedId === link.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                      {copiedId === link.id ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-text"
                      disabled={revokingId === link.id}
                      onClick={() => void revoke(link)}
                    >
                      {revokingId === link.id ? 'Cancelling…' : 'Cancel'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

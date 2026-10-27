import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  SlidersHorizontal,
  Bell,
  Volume2,
  Plug,
  Printer,
  Info,
  Clock,
  ShieldCheck,
  ArrowRight,
  Boxes,
} from 'lucide-react'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Switch } from '../components/ui/switch'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { PLATFORM_NAME, PLATFORM_ATTRIBUTION } from '../lib/branding'
import { useAuth } from '../auth/AuthContext'
import { hasRole, canAccess } from '../auth/access'
import { NAV_GROUPS } from '../components/layout/nav-items'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { get, put } from '../lib/api'
import { usePermissions } from '../context/PermissionsContext'

function ToggleRow({
  icon: Icon,
  label,
  desc,
  checked,
  onChange,
}: {
  icon: typeof Bell
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-transparent px-2 py-3 hover:border-border hover:bg-card/40">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Access Control — the one section of Settings that is actually live. OWNER
// gets a pointer into the real RBAC editor (Users & Roles → Permissions
// Matrix, ckitchen_frontend/src/pages/Users.tsx). Everyone else sees a
// read-only summary of their OWN access, sourced from the bundled frontend
// PAGE_ROLES map (auth/access.ts) rather than the backend — GET /admin/rbac
// is OWNER-only (403s for anyone else), so there is no live matrix a
// non-OWNER account could fetch here even read-only.
// ---------------------------------------------------------------------------

function AccessControlCard() {
  const { user } = useAuth()
  const isOwner = hasRole(user?.role, ['OWNER'])

  const accessiblePages = useMemo(
    () => NAV_GROUPS.flatMap((g) => g.items).filter((i) => user != null && canAccess(user.role, i.to)),
    [user],
  )

  return (
    <Card className="border-border bg-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-500" /> Access Control
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isOwner ? (
          <>
            <p className="text-muted-foreground">
              Manage which roles can reach which pages, plus per-user accounts, outlet access, password resets,
              and account status, from Users &amp; Roles.
            </p>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/users?tab=matrix">
                Open Permissions Matrix
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Your role (<span className="text-foreground">{user?.role ? user.role.replace(/_/g, ' ') : '—'}</span>)
              can access:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {accessiblePages.length === 0 ? (
                <span className="text-xs text-muted-foreground">No pages configured for this role.</span>
              ) : (
                accessiblePages.map((p) => (
                  <Badge key={p.to} variant="outline" className="border-border text-foreground">
                    {p.label}
                  </Badge>
                ))
              )}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              Page access is enforced server-side. Contact an OWNER to request a change.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

interface BusinessModule {
  key: string
  label: string
  description: string
  enabled: boolean
}

/**
 * Owner switches whole parts of ORION on or off for this business; disabled modules
 * disappear from everyone's sidebar (backend: /business-modules + /me/permissions).
 */
function ModulesCard() {
  const queryClient = useQueryClient()
  const { refresh } = usePermissions()
  const { data: modules = [], isPending, error } = useQuery({
    queryKey: ['business-modules'],
    queryFn: async () => (await get<BusinessModule[]>('/business-modules')).data,
  })
  // Per-module in-flight guard: a double tap on one switch must send one request.
  const pendingRef = useRef<Set<string>>(new Set())
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set())

  async function toggle(mod: BusinessModule, enabled: boolean) {
    if (pendingRef.current.has(mod.key)) return
    pendingRef.current.add(mod.key)
    setPendingKeys(new Set(pendingRef.current))
    try {
      await put(`/business-modules/${mod.key}`, { enabled })
      await queryClient.invalidateQueries({ queryKey: ['business-modules'] })
      refresh()
      toast.success(`${mod.label} ${enabled ? 'turned on' : 'turned off'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the module.')
    } finally {
      pendingRef.current.delete(mod.key)
      setPendingKeys(new Set(pendingRef.current))
    }
  }

  return (
    <Card className="border-border bg-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <Boxes className="h-4 w-4 text-ink-accent" aria-hidden /> Modules
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Turn off what this business doesn't use. Its pages disappear for everyone and come back when you turn it on.
          Ordering, kitchen, menu, inventory, reports, outlets, users and settings are always on.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {isPending && <p className="py-3 text-sm text-muted-foreground">Loading modules…</p>}
        {error && <p className="py-3 text-sm text-danger-text">Could not load modules.</p>}
        {modules.map((m) => (
          <div key={m.key} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.description}</p>
            </div>
            <Switch
              checked={m.enabled}
              disabled={pendingKeys.has(m.key)}
              onCheckedChange={(v) => void toggle(m, v)}
              aria-label={`${m.label}: ${m.enabled ? 'on' : 'off'}`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const isOwner = hasRole(user?.role, ['OWNER'])
  const [t, setT] = useState({
    sound: true,
    lowstock: true,
    overdue: true,
    autoReprint: true,
  })
  const set = (k: keyof typeof t) => (v: boolean) => setT((s) => ({ ...s, [k]: v }))

  return (
    <PageContainer>
      <PageHeader title="Settings" subtitle="System configuration" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Business modules — owner only */}
        {isOwner && <ModulesCard />}

        {/* Access Control — live */}
        <AccessControlCard />

        {/* General */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-emerald-500" /> General
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Location name" defaultValue="Main Cloud Kitchen" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency" defaultValue="PHP (₱)" />
              <Field label="Timezone" defaultValue="Asia/Manila" />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Overdue prep threshold (min)" defaultValue="15" />
              </div>
              <Clock className="mb-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <Bell className="h-4 w-4 text-emerald-500" /> Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow icon={Volume2} label="New-order sound alert" desc="Audible chime on each new order." checked={t.sound} onChange={set('sound')} />
            <ToggleRow icon={Bell} label="Low-stock alerts" desc="Toast when an ingredient crosses its threshold." checked={t.lowstock} onChange={set('lowstock')} />
            <ToggleRow icon={Clock} label="Overdue order alerts" desc="Flag orders past the prep threshold." checked={t.overdue} onChange={set('overdue')} />
          </CardContent>
        </Card>

        {/* Aggregator integration */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <Plug className="h-4 w-4 text-emerald-500" /> Aggregator Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="foodpanda" value={<Badge variant="outline" className="border-input text-muted-foreground">Simulator</Badge>} />
            <Row label="GrabFood" value={<Badge variant="outline" className="border-input text-muted-foreground">Simulator</Badge>} />
            <Row label="Middleware (Deliverect / UrbanPiper)" value={<Badge variant="outline" className="border-amber-500/40 text-warn-text">Not connected</Badge>} />
            <p className="pt-1 text-xs text-muted-foreground">
              Live order feed is a later phase — middleware-first behind the normalized adapter.
            </p>
          </CardContent>
        </Card>

        {/* Print agent */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <Printer className="h-4 w-4 text-emerald-500" /> Print Agent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow icon={Printer} label="Auto-reprint on failure" desc="Retry a failed ticket automatically." checked={t.autoReprint} onChange={set('autoReprint')} />
            <Row label="Agent token" value={<span className="font-mono text-xs text-muted-foreground">••••••••••••</span>} />
            <p className="pt-1 text-xs text-muted-foreground">
              Physical printing is handled by the desktop Print Agent (mock in the prototype). The web app never prints.
            </p>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-border bg-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <Info className="h-4 w-4 text-emerald-500" /> About
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Row label="Product" value={PLATFORM_NAME} />
            <Row label="Version" value="Prototype" />
            <Row label="Database" value="Supabase (Postgres)" />
            <Row label="By" value={PLATFORM_ATTRIBUTION} />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        General, notification, integration, and print-agent settings are presentational in the prototype. Access
        Control above is live — role-based page permissions are enforced server-side.
      </p>
    </PageContainer>
  )
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      <Input defaultValue={defaultValue} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

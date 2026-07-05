import { useState, type ReactNode } from 'react'
import {
  SlidersHorizontal,
  Bell,
  Volume2,
  Plug,
  Printer,
  Info,
  Clock,
} from 'lucide-react'
import PageHeader from '../components/common/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Switch } from '../components/ui/switch'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { PLATFORM_NAME, PLATFORM_ATTRIBUTION } from '../lib/branding'

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
    <div className="flex items-center justify-between gap-4 rounded-lg border border-transparent px-2 py-3 hover:border-border hover:bg-zinc-900/40">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 text-zinc-400" />
        <div>
          <p className="text-sm font-medium text-zinc-100">{label}</p>
          <p className="text-xs text-zinc-500">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export default function Settings() {
  const [t, setT] = useState({
    sound: true,
    lowstock: true,
    overdue: true,
    autoReprint: true,
  })
  const set = (k: keyof typeof t) => (v: boolean) => setT((s) => ({ ...s, [k]: v }))

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="System configuration" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* General */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
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
              <Clock className="mb-2.5 h-4 w-4 text-zinc-500" />
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
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
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <Plug className="h-4 w-4 text-emerald-500" /> Aggregator Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="foodpanda" value={<Badge variant="outline" className="border-zinc-600 text-zinc-400">Simulator</Badge>} />
            <Row label="GrabFood" value={<Badge variant="outline" className="border-zinc-600 text-zinc-400">Simulator</Badge>} />
            <Row label="Middleware (Deliverect / UrbanPiper)" value={<Badge variant="outline" className="border-amber-500/40 text-amber-400">Not connected</Badge>} />
            <p className="pt-1 text-xs text-zinc-600">
              Live order feed is a later phase — middleware-first behind the normalized adapter.
            </p>
          </CardContent>
        </Card>

        {/* Print agent */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <Printer className="h-4 w-4 text-emerald-500" /> Print Agent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow icon={Printer} label="Auto-reprint on failure" desc="Retry a failed ticket automatically." checked={t.autoReprint} onChange={set('autoReprint')} />
            <Row label="Agent token" value={<span className="font-mono text-xs text-zinc-500">••••••••••••</span>} />
            <p className="pt-1 text-xs text-zinc-600">
              Physical printing is handled by the desktop Print Agent (mock in the prototype). The web app never prints.
            </p>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-border bg-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
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

      <p className="text-xs text-zinc-600">Settings are presentational in the prototype.</p>
    </div>
  )
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</label>
      <Input defaultValue={defaultValue} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  )
}

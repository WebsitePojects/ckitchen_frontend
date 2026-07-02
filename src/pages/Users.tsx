import { useState } from 'react'
import {
  Users as UsersIcon,
  ShieldCheck,
  KeyRound,
  UserCog,
  Check,
  Minus,
  Lock,
  Timer,
  Globe,
  CalendarClock,
  BellRing,
} from 'lucide-react'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { useAuth } from '../auth/AuthContext'

// The 8 users created by the backend seed (`npm run seed`). The prototype backend
// has no users-CRUD endpoint, so this team list is seed-derived (accurate to the DB).
// No backend users-list API exists yet (see audit-frontend.md) — table is seed-derived.
// Real emails only ship in DEV builds; production masks them via Vite's compile-time DEV
// constant so Vite's dead-code elimination drops the real-email branch entirely.
const SEED_USERS = import.meta.env.DEV
  ? [
      { name: 'Admin', email: 'admin@cloudkitchen.local', role: 'SUPER_ADMIN' },
      { name: 'Super Admin', email: 'super_admin@cloudkitchen.local', role: 'SUPER_ADMIN' },
      { name: 'Brand Manager', email: 'brand_manager@cloudkitchen.local', role: 'BRAND_MANAGER' },
      { name: 'Kitchen Staff', email: 'kitchen_staff@cloudkitchen.local', role: 'KITCHEN_STAFF' },
      { name: 'Warehouse', email: 'warehouse@cloudkitchen.local', role: 'WAREHOUSE' },
      { name: 'Supplier Coordinator', email: 'supplier_coordinator@cloudkitchen.local', role: 'SUPPLIER_COORDINATOR' },
      { name: 'Accountant', email: 'accountant@cloudkitchen.local', role: 'ACCOUNTANT' },
      { name: 'Rider', email: 'rider@cloudkitchen.local', role: 'RIDER' },
    ]
  : [
      { name: 'Admin', email: '***@cloudkitchen.local', role: 'SUPER_ADMIN' },
      { name: 'Super Admin', email: '***@cloudkitchen.local', role: 'SUPER_ADMIN' },
      { name: 'Brand Manager', email: '***@cloudkitchen.local', role: 'BRAND_MANAGER' },
      { name: 'Kitchen Staff', email: '***@cloudkitchen.local', role: 'KITCHEN_STAFF' },
      { name: 'Warehouse', email: '***@cloudkitchen.local', role: 'WAREHOUSE' },
      { name: 'Supplier Coordinator', email: '***@cloudkitchen.local', role: 'SUPPLIER_COORDINATOR' },
      { name: 'Accountant', email: '***@cloudkitchen.local', role: 'ACCOUNTANT' },
      { name: 'Rider', email: '***@cloudkitchen.local', role: 'RIDER' },
    ]

const ROLES = [
  'SUPER_ADMIN',
  'BRAND_MANAGER',
  'KITCHEN_STAFF',
  'WAREHOUSE',
  'SUPPLIER_COORDINATOR',
  'ACCOUNTANT',
  'RIDER',
] as const

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  BRAND_MANAGER: 'Brand Manager',
  KITCHEN_STAFF: 'Kitchen Staff',
  WAREHOUSE: 'Warehouse',
  SUPPLIER_COORDINATOR: 'Supplier Coord.',
  ACCOUNTANT: 'Accountant',
  RIDER: 'Rider',
}

const ROLE_CLASS: Record<string, string> = {
  SUPER_ADMIN: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  BRAND_MANAGER: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  KITCHEN_STAFF: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  WAREHOUSE: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  SUPPLIER_COORDINATOR: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ACCOUNTANT: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  RIDER: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
}

// Permissions matrix — from CK1-API-003 §1 Role Authorization Matrix.
const MATRIX: { area: string; roles: string[] }[] = [
  { area: 'Dashboard (view)', roles: [...ROLES] },
  { area: 'Brands & Menu (write)', roles: ['SUPER_ADMIN', 'BRAND_MANAGER'] },
  { area: 'Order stages (advance)', roles: ['SUPER_ADMIN', 'KITCHEN_STAFF'] },
  { area: 'Inventory & ITO confirm', roles: ['SUPER_ADMIN', 'WAREHOUSE'] },
  { area: 'ITO request & consumption', roles: ['SUPER_ADMIN', 'KITCHEN_STAFF'] },
  { area: 'Purchasing & suppliers', roles: ['SUPER_ADMIN', 'SUPPLIER_COORDINATOR'] },
  { area: 'Print reprint', roles: ['SUPER_ADMIN', 'KITCHEN_STAFF'] },
  { area: 'Analytics (read)', roles: ['SUPER_ADMIN', 'BRAND_MANAGER', 'ACCOUNTANT'] },
  { area: 'Config / Users / Printers', roles: ['SUPER_ADMIN'] },
  { area: 'Delivery queue', roles: ['SUPER_ADMIN', 'RIDER'] },
]

const SECURITY_CONTROLS = [
  { id: '2fa', icon: ShieldCheck, label: 'Two-Factor Authentication (2FA)', desc: 'Require a second factor at login.', on: false },
  { id: 'timeout', icon: Timer, label: 'Session Timeout', desc: 'Auto sign-out after inactivity.', on: true },
  { id: 'ip', icon: Globe, label: 'Restrict IP Access', desc: 'Allow sign-in only from approved networks.', on: false },
  { id: 'expiry', icon: CalendarClock, label: 'Password Expiry', desc: 'Force a password reset every 90 days.', on: false },
  { id: 'alerts', icon: BellRing, label: 'Login Alerts', desc: 'Notify on sign-in from a new device.', on: true },
]

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function Users() {
  const { user } = useAuth()
  const [security, setSecurity] = useState(() =>
    Object.fromEntries(SECURITY_CONTROLS.map((c) => [c.id, c.on])) as Record<string, boolean>,
  )

  return (
    <div className="space-y-5">
      <PageHeader title="Users & Roles" subtitle="Accounts, permissions and security controls" />

      <KpiRibbon>
        <KpiCard icon={UsersIcon} label="Total Users" value={SEED_USERS.length} />
        <KpiCard icon={Check} label="Active" value={SEED_USERS.length} />
        <KpiCard icon={UserCog} label="Roles" value={ROLES.length} />
        <KpiCard icon={KeyRound} label="2FA Enabled" value={security['2fa'] ? 'On' : 'Off'} />
      </KpiRibbon>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="bg-card">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="matrix">Permissions Matrix</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* Users */}
        <TabsContent value="users" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base text-zinc-100">Team</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SEED_USERS.map((u) => {
                    const isYou = user?.email === u.email
                    return (
                      <TableRow key={u.name} className="border-border">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-zinc-100">
                              {u.name}
                              {isYou && <span className="ml-2 text-xs text-emerald-400">(you)</span>}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-zinc-400">{u.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ROLE_CLASS[u.role]}>
                            {ROLE_LABEL[u.role]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                          </span>
                        </TableCell>
                        <TableCell className="text-zinc-500">{isYou ? 'Just now' : '—'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Permissions matrix */}
        <TabsContent value="matrix" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base text-zinc-100">Permissions Matrix</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="min-w-[12rem]">Capability</TableHead>
                    {ROLES.map((r) => (
                      <TableHead key={r} className="text-center text-xs">
                        {ROLE_LABEL[r]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MATRIX.map((row) => (
                    <TableRow key={row.area} className="border-border">
                      <TableCell className="font-medium text-zinc-200">{row.area}</TableCell>
                      {ROLES.map((r) => (
                        <TableCell key={r} className="text-center">
                          {row.roles.includes(r) ? (
                            <Check className="mx-auto h-4 w-4 text-emerald-400" aria-label="allowed" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-zinc-700" aria-label="denied" />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
                <Lock className="h-4 w-4 text-emerald-500" /> Security Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {SECURITY_CONTROLS.map((c) => {
                const Icon = c.icon
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-transparent px-2 py-3 hover:border-border hover:bg-zinc-900/40"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 text-zinc-400" />
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{c.label}</p>
                        <p className="text-xs text-zinc-500">{c.desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={security[c.id]}
                      onCheckedChange={(v) => setSecurity((s) => ({ ...s, [c.id]: v }))}
                    />
                  </div>
                )
              })}
              <p className="px-2 pt-2 text-xs text-zinc-600">
                Security controls are presentational in the prototype.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

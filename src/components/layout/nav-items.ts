import {
  LayoutDashboard,
  ReceiptText,
  Building2,
  Link2,
  Tags,
  ChefHat,
  Printer,
  Store,
  UtensilsCrossed,
  Users,
  BarChart3,
  Settings,
  UserCog,
  ScrollText,
  ListOrdered,
  Camera,
  Handshake,
  Boxes,
  ShoppingCart,
  Tablet,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Grouped, role-filtered sidebar nav — platform-ia-navigation.md §4. The old
 * flat 18-item list is retired; the legacy '/merchants' route ("Merchant &
 * Food Brand Management" read-only table) left the nav entirely post-D30
 * ("merchant" = Brand) — App.tsx redirects that route to /channel-listings so
 * old links don't 404. '/merchant-management' below is its DIFFERENT,
 * newer replacement: the full add/edit/remove-brand + items + availability
 * control surface (MerchantManagement.tsx), not the old read-only table.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/pos', label: 'New Order', icon: ShoppingBag },
      { to: '/orders', label: 'Live Orders', icon: ReceiptText },
      { to: '/kitchen', label: 'Kitchen (KDS)', icon: ChefHat },
      { to: '/merchant-console', label: 'Merchant Console', icon: Tablet },
      { to: '/printers', label: 'Printers & Print Monitor', icon: Printer },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/brands', label: 'Brands', icon: Tags },
      { to: '/menu', label: 'Menu', icon: UtensilsCrossed },
      { to: '/channel-listings', label: 'Channel Listings', icon: Link2 },
      { to: '/merchant-management', label: 'Merchant Management', icon: Store },
    ],
  },
  {
    label: 'Stock',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/stock-ledger', label: 'Stock Ledger', icon: ListOrdered },
      { to: '/purchasing', label: 'Purchasing', icon: ShoppingCart },
      { to: '/master-data', label: 'Master Data', icon: Handshake },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: UserCog },
      { to: '/attendance', label: 'Attendance / DTR', icon: Camera },
      { to: '/users', label: 'Users & Roles', icon: Users },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/audit', label: 'Activity Log', icon: ScrollText },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/outlets', label: 'Outlets', icon: Building2 },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

/** Route -> where it sits in the nav, for the header breadcrumb ("Stock / Inventory"). */
export const NAV_LOOKUP: ReadonlyMap<string, { group: string; label: string }> = new Map(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.to, { group: g.label, label: i.label }] as const)),
)

/** Phone tab bar slots, in priority order; the first four the user can open are shown. */
export const TAB_BAR_PRIORITY = ['/pos', '/orders', '/kitchen', '/inventory', '/', '/menu', '/attendance', '/reports'] as const

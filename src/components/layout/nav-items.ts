import {
  LayoutDashboard,
  ReceiptText,
  Building2,
  Link2,
  Tags,
  ChefHat,
  Printer,
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
 * flat 18-item list is retired; '/merchants' ("Merchant Management") has left
 * the nav entirely post-D30 ("merchant" = Brand) — App.tsx redirects that
 * route to /channel-listings so old links don't 404.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
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
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/stock-ledger', label: 'Stock Ledger', icon: ListOrdered },
    ],
  },
  {
    label: 'Purchasing',
    items: [
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
      { to: '/audit', label: 'Audit Log', icon: ScrollText },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/outlets', label: 'Outlets', icon: Building2 },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

import {
  LayoutDashboard,
  ReceiptText,
  Store,
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
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Sidebar nav — exact order + icons per the UI Reskin Plan. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ReceiptText },
  { to: '/merchants', label: 'Merchant Management', icon: Store },
  { to: '/outlets', label: 'Outlets', icon: Building2 },
  { to: '/channel-listings', label: 'Channel Listings', icon: Link2 },
  { to: '/brands', label: 'Brands', icon: Tags },
  { to: '/kitchen', label: 'Kitchen Stations', icon: ChefHat },
  { to: '/printers', label: 'Printers', icon: Printer },
  { to: '/menu', label: 'Menu Management', icon: UtensilsCrossed },
  { to: '/stock-ledger', label: 'Stock Ledger', icon: ListOrdered },
  { to: '/users', label: 'Users & Roles', icon: Users },
  { to: '/employees', label: 'Employees', icon: UserCog },
  { to: '/attendance', label: 'Attendance / DTR', icon: Camera },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

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
  { to: '/users', label: 'Users & Roles', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

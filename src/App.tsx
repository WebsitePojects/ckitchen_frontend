import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import {
  Building2,
  Printer,
  ReceiptText,
  Settings,
  Store,
  Tags,
  UtensilsCrossed,
  Users,
} from 'lucide-react'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Kitchen from './pages/Kitchen'
import Inventory from './pages/Inventory'
import Analytics from './pages/Analytics'
import ComingSoon from './pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected shell */}
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route
                path="orders"
                element={<ComingSoon title="Orders" subtitle="Full order feed" icon={ReceiptText} />}
              />
              <Route
                path="merchants"
                element={
                  <ComingSoon title="Merchant Management" subtitle="Brands, outlets & performance" icon={Store} />
                }
              />
              <Route
                path="outlets"
                element={<ComingSoon title="Outlets" subtitle="Outlet directory" icon={Building2} />}
              />
              <Route path="brands" element={<ComingSoon title="Brands" subtitle="Brand directory" icon={Tags} />} />
              <Route path="kitchen" element={<Kitchen />} />
              <Route
                path="printers"
                element={<ComingSoon title="Printers" subtitle="Print queue & printer status" icon={Printer} />}
              />
              <Route
                path="menu"
                element={
                  <ComingSoon title="Menu Management" subtitle="Items & availability" icon={UtensilsCrossed} />
                }
              />
              <Route path="inventory" element={<Inventory />} />
              <Route
                path="users"
                element={<ComingSoon title="Users & Roles" subtitle="Accounts & permissions" icon={Users} />}
              />
              <Route path="reports" element={<Analytics />} />
              <Route
                path="settings"
                element={<ComingSoon title="Settings" subtitle="System configuration" icon={Settings} />}
              />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

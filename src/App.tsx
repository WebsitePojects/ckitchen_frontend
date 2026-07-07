import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { RequireAccess } from './auth/RequireAccess'
import RoleLanding from './auth/RoleLanding'
import { OutletProvider } from './context/OutletContext'
import { SimulatorProvider } from './context/SimulatorContext'
import { PermissionsProvider } from './context/PermissionsContext'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Kitchen from './pages/Kitchen'
import Tv from './pages/Tv'
import Inventory from './pages/Inventory'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Menu from './pages/Menu'
import Printers from './pages/Printers'
import UsersPage from './pages/Users'
import Orders from './pages/Orders'
import Brands from './pages/Brands'
import Outlets from './pages/Outlets'
import ChannelListings from './pages/ChannelListings'
import Employees from './pages/Employees'
import AuditTrail from './pages/AuditTrail'
import StockLedger from './pages/StockLedger'
import Attendance from './pages/Attendance'
import MasterData from './pages/MasterData'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <OutletProvider>
      <PermissionsProvider>
      <SimulatorProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />

            {/* Protected shell */}
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                {/* '/merchants' left the nav post-D30 ("merchant" = Brand) — kept as an
                    unconditional redirect (outside RequireAccess) so old links don't 404. */}
                <Route path="merchants" element={<Navigate to="/channel-listings" replace />} />
                <Route element={<RequireAccess />}>
                <Route index element={<RoleLanding />} />
                <Route path="orders" element={<Orders />} />
                <Route path="outlets" element={<Outlets />} />
                <Route path="channel-listings" element={<ChannelListings />} />
                <Route path="brands" element={<Brands />} />
                <Route path="kitchen" element={<Kitchen />} />
                <Route path="printers" element={<Printers />} />
                <Route path="menu" element={<Menu />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="stock-ledger" element={<StockLedger />} />
                <Route path="master-data" element={<MasterData />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="employees" element={<Employees />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="audit" element={<AuditTrail />} />
                <Route path="reports" element={<Analytics />} />
                <Route path="settings" element={<Settings />} />
                </Route>
              </Route>

              {/* TV display board (D32) — fullscreen, no AppShell chrome (no
                  sidebar/topbar), but still authenticated + role-gated via
                  RequireAccess (platform-ia-navigation.md §6). */}
              <Route element={<RequireAccess />}>
                <Route path="tv" element={<Tv />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SimulatorProvider>
      </PermissionsProvider>
      </OutletProvider>
    </AuthProvider>
    </QueryClientProvider>
  )
}

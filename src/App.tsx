import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Kitchen from './pages/Kitchen'
import Inventory from './pages/Inventory'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Merchants from './pages/Merchants'
import Menu from './pages/Menu'
import Printers from './pages/Printers'
import UsersPage from './pages/Users'
import Orders from './pages/Orders'
import Brands from './pages/Brands'
import Outlets from './pages/Outlets'
import ChannelListings from './pages/ChannelListings'

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
              <Route path="orders" element={<Orders />} />
              <Route path="merchants" element={<Merchants />} />
              <Route path="outlets" element={<Outlets />} />
              <Route path="channel-listings" element={<ChannelListings />} />
              <Route path="brands" element={<Brands />} />
              <Route path="kitchen" element={<Kitchen />} />
              <Route path="printers" element={<Printers />} />
              <Route path="menu" element={<Menu />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="reports" element={<Analytics />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

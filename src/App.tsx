import { Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import ThemeProvider from './components/layout/ThemeProvider'
import { AppAuthProvider } from './auth/ClerkAuthAdapter'
import { RequireAuth } from './auth/RequireAuth'
import { RequireAccess } from './auth/RequireAccess'
import { RequireAttendance } from './auth/RequireAttendance'
import RoleLanding from './auth/RoleLanding'
import { OutletProvider } from './context/OutletContext'
import { SimulatorProvider } from './context/SimulatorContext'
import { PermissionsProvider } from './context/PermissionsContext'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import { lazyPage } from './lib/pageLoaders'
import PageFallback from './components/layout/PageFallback'

// Pages load as separate chunks (see lib/pageLoaders.ts); Login and the shell stay eager
// so the first screen paints immediately.
const Kitchen = lazyPage('/kitchen')
const Tv = lazyPage('/tv')
const Inventory = lazyPage('/inventory')
const Analytics = lazyPage('/reports')
const Settings = lazyPage('/settings')
const Menu = lazyPage('/menu')
const Printers = lazyPage('/printers')
const UsersPage = lazyPage('/users')
const Orders = lazyPage('/orders')
const Pos = lazyPage('/pos')
const Brands = lazyPage('/brands')
const Outlets = lazyPage('/outlets')
const OutletProfile = lazyPage('/outlet-profile')
const ChannelListings = lazyPage('/channel-listings')
const MerchantManagement = lazyPage('/merchant-management')
const Employees = lazyPage('/employees')
const EmployeeProfile = lazyPage('/employee-profile')
const AuditTrail = lazyPage('/audit')
const StockLedger = lazyPage('/stock-ledger')
const Attendance = lazyPage('/attendance')
const AttendanceKiosk = lazyPage('/kiosk/attendance')
const MasterData = lazyPage('/master-data')
const Purchasing = lazyPage('/purchasing')
const MerchantConsole = lazyPage('/merchant-console')

export default function App() {
  return (
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
    <AppAuthProvider>
      <OutletProvider>
      <PermissionsProvider>
      <SimulatorProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            {/* Public attendance kiosk (CK1-EMS-005 §3) — wall-tablet time
                clock, deliberately OUTSIDE RequireAuth (unauthenticated by
                design; photo is the identity evidence) and absent from
                PAGE_ROLES. Fullscreen, no AppShell chrome (Tv.tsx pattern). */}
            <Route path="/kiosk/attendance" element={<AttendanceKiosk />} />

            {/* Protected shell */}
            <Route element={<RequireAuth />}>
              {/* Attendance gate — the "second middleware after login" (client
                  directive 2026-07-08): non-OWNER staff with a linked employee
                  record are bounced to /attendance until today's TIME_IN.
                  Wraps BOTH the AppShell routes and /tv; /attendance itself is
                  exempted inside the guard so it can never trap its own
                  redirect target. */}
              <Route element={<RequireAttendance />}>
              <Route element={<AppShell />}>
                {/* '/merchants' left the nav post-D30 ("merchant" = Brand) — kept as an
                    unconditional redirect (outside RequireAccess) so old links don't 404. */}
                <Route path="merchants" element={<Navigate to="/channel-listings" replace />} />
                {/* Employee 360 detail — deliberately OUTSIDE <RequireAccess>:
                    that guard matches the RAW pathname ('/employees/<uuid>')
                    against page keys, and the persisted RBAC matrix
                    (/me/permissions) only ever contains parent keys like
                    '/employees', so the Set lookup would bounce every
                    non-OWNER role even when Employees is allowed. The page
                    self-gates instead: it inherits '/employees' permissions
                    via usePermissions().canAccessPage('/employees') and
                    redirects to the role landing exactly like RequireAccess
                    would (see EmployeeProfile.tsx). */}
                <Route path="employees/:id" element={<EmployeeProfile />} />
                {/* Outlet 360 detail — self-gates on '/outlets' (+ outlet-scope
                    check) for the SAME reason employees/:id sits outside
                    RequireAccess: the guard matches the raw '/outlets/<uuid>'
                    pathname against page keys the RBAC matrix never stores.
                    See OutletProfile.tsx for the scope-aware gate. */}
                <Route path="outlets/:id" element={<OutletProfile />} />
                <Route element={<RequireAccess />}>
                <Route index element={<RoleLanding />} />
                <Route path="orders" element={<Orders />} />
                <Route path="pos" element={<Pos />} />
                <Route path="outlets" element={<Outlets />} />
                <Route path="channel-listings" element={<ChannelListings />} />
                <Route path="merchant-management" element={<MerchantManagement />} />
                {/* Merchant Console — per-listing live order queue + store pause +
                    item availability (the per-merchant Grab tablet / foodpanda
                    phone replacement — Documents/AGGREGATOR_API_INTEGRATION_SPEC.md). */}
                <Route path="merchant-console" element={<MerchantConsole />} />
                <Route path="brands" element={<Brands />} />
                <Route path="kitchen" element={<Kitchen />} />
                <Route path="printers" element={<Printers />} />
                <Route path="menu" element={<Menu />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="stock-ledger" element={<StockLedger />} />
                <Route path="master-data" element={<MasterData />} />
                <Route path="purchasing" element={<Purchasing />} />
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
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </SimulatorProvider>
      </PermissionsProvider>
      </OutletProvider>
    </AppAuthProvider>
    </QueryClientProvider>
    </ThemeProvider>
  )
}

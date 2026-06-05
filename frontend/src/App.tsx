import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import Orders from './pages/Orders'
import CreateShippingLabel from './pages/CreateShippingLabel'
import BatchItems from './pages/BatchItems'
import Settings from './pages/Settings'
import DropboxFetcher from './pages/DropboxFetcher'
import AdminUsers from './pages/AdminUsers'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route index element={<Orders />} />
                <Route path="/orders" element={<Navigate to="/" replace />} />
                <Route path="/create-label" element={<CreateShippingLabel />} />
                <Route path="/create-label/batches/:batchId" element={<BatchItems />} />
                <Route path="/dropbox-fetcher" element={<DropboxFetcher />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>

            {/* Admin-only routes */}
            <Route element={<ProtectedRoute adminOnly />}>
              <Route element={<Layout />}>
                <Route path="/admin/users" element={<AdminUsers />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

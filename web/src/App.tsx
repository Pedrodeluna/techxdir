import { Navigate, Route, Routes } from 'react-router-dom'
import { BadgeApp } from './features/badge/BadgeApp'
import { ToastProvider } from './features/badge/Toast'
import { AuthProvider, RequireAuth } from './lib/auth'
import { Auth } from './pages/Auth'
import { AuthCallback } from './pages/AuthCallback'
import { Landing } from './pages/Landing'
import { Organizations } from './pages/Organizations'
import { Admin } from './pages/Admin'
import { AdminsSection } from './pages/admin/AdminsSection'
import { EventsSection } from './pages/admin/EventsSection'
import { OrgsSection } from './pages/admin/OrgsSection'
import { Summary } from './pages/admin/Summary'
import { UsersSection } from './pages/admin/UsersSection'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/entrar" element={<Auth />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/ejemplo" element={<BadgeApp sample />} />
          <Route path="/acreditacion" element={<RequireAuth><BadgeApp /></RequireAuth>} />
          <Route path="/organizaciones" element={<RequireAuth><Organizations /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>}>
            <Route index element={<Summary />} />
            <Route path="organizaciones" element={<OrgsSection />} />
            <Route path="eventos" element={<EventsSection />} />
            <Route path="usuarios" element={<UsersSection />} />
            <Route path="administradores" element={<AdminsSection />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}

import { Navigate, Route, Routes } from 'react-router-dom'
import { BadgeApp } from './features/badge/BadgeApp'
import { ToastProvider } from './features/badge/Toast'
import { AuthProvider, RequireAuth } from './lib/auth'
import { Auth } from './pages/Auth'
import { AuthCallback } from './pages/AuthCallback'
import { Landing } from './pages/Landing'
import { Organizations } from './pages/Organizations'

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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}

import { Navigate, Route, Routes } from 'react-router-dom'
import { BadgeApp } from './features/badge/BadgeApp'
import { ToastProvider } from './features/badge/Toast'
import { Landing } from './pages/Landing'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/acreditacion" element={<BadgeApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}

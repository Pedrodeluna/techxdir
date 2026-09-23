import { Navigate, Route, Routes } from 'react-router-dom'
import { BadgeApp } from './features/badge/BadgeApp'
import { ToastProvider } from './features/badge/Toast'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/acreditacion" element={<BadgeApp />} />
        <Route path="*" element={<Navigate to="/acreditacion" replace />} />
      </Routes>
    </ToastProvider>
  )
}

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)
  const timer = useRef<number>(undefined)

  const notify = useCallback((text: string) => {
    setMsg(text)
    setShow(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShow(false), 2200)
  }, [])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className={`toast${show ? ' show' : ''}`} role="status">{msg}</div>
    </ToastContext.Provider>
  )
}

export const useNotify = () => useContext(ToastContext)

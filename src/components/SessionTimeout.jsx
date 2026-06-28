// SessionTimeout — drop-in idle auto-logout for any authenticated
// surface. Mount it INSIDE the auth context (so useAuth + useNavigate
// work) and AFTER the user has signed in. Defaults to the dashboard's
// 60-minute idle window with a 5-minute warning toast.
//
// Usage (Layout.jsx):
//   import SessionTimeout from './SessionTimeout'
//   …
//   <SessionTimeout />

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { IDLE, useIdleLogout } from '../lib/session-timeout'

export default function SessionTimeout({
  timeoutMs = IDLE.DASHBOARD,
  warnBeforeMs = 5 * 60 * 1000,
  loginPath = '/login',
}) {
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const [warning, setWarning] = useState(null)

  useIdleLogout({
    enabled: !!user,
    timeoutMs,
    warnBeforeMs,
    onWarn: () =>
      setWarning(
        "You'll be signed out in 5 minutes due to inactivity. Move the mouse or press a key to stay signed in.",
      ),
    onTimeout: async () => {
      try {
        await signOut({ scope: 'local' })
      } catch {
        /* ignore — we still redirect */
      }
      setWarning(null)
      navigate(loginPath, { replace: true })
    },
  })

  if (!warning) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: '0.65rem 1rem',
        textAlign: 'center',
        background: 'rgba(251,191,36,0.95)',
        color: '#111827',
        fontSize: '0.85rem',
        fontWeight: 500,
      }}
      onClick={() => setWarning(null)}
    >
      {warning}
    </div>
  )
}

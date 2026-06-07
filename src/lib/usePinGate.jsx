import { useCallback, useMemo, useState } from 'react'
import PinModal from '../components/PinModal'
import { pinRequiredFor, isRecentlyVerified } from './pinSecurity'
import { useAuth } from '../context/AuthContext'

// usePinGate — wraps any sensitive action with an account-level PIN check.
//
// Returns { gate, PinGateElement }:
//   gate(actionFn, actionLabel?)   — for roles that need a PIN (admin/sales,
//                                    non-demo) this ALWAYS opens the modal,
//                                    which verifies the PIN SERVER-SIDE before
//                                    running actionFn. DEFAULT-DENY: if no PIN
//                                    is set the modal blocks the action and
//                                    tells the user to set one in Profile.
//   PinGateElement                 — JSX to render once per page.
//
// A successful verify is cached for the admin session (sessionStorage) so the
// gate doesn't prompt on every click; gate() skips the modal while that cache
// is fresh. Demo mode is exempt — the action bubbles to the page's demoBlock().
export default function usePinGate() {
  const { role, isDemo } = useAuth()
  const [pending, setPending] = useState(null) // { run, label } | null

  const requirePin = pinRequiredFor(role) && !isDemo

  const gate = useCallback(
    (actionFn, actionLabel) => {
      if (typeof actionFn !== 'function') return
      // Roles that don't need the PIN gate (partners, demo): just run.
      if (!pinRequiredFor(role) || isDemo) {
        actionFn()
        return
      }
      // Recently verified this session — don't re-prompt.
      if (isRecentlyVerified()) {
        actionFn()
        return
      }
      // Otherwise always require a server-verified PIN before running.
      setPending({ run: actionFn, label: actionLabel })
    },
    [role, isDemo],
  )

  const PinGateElement = useMemo(
    () => (
      <PinModal
        isOpen={!!pending}
        actionLabel={pending?.label}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const fn = pending?.run
          setPending(null)
          if (fn) fn()
        }}
      />
    ),
    [pending],
  )

  return { gate, PinGateElement, requirePin }
}

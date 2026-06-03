import { useCallback, useMemo, useState } from 'react'
import PinModal from '../components/PinModal'
import { pinRequiredFor, isPinSet } from './pinSecurity'
import { useAuth } from '../context/AuthContext'

// usePinGate — wraps any write-action with a PIN confirmation modal.
//
// Returns { gate, PinGateElement }:
//   gate(actionFn, actionLabel?)   — runs actionFn() immediately for roles
//                                    that don't need a PIN; otherwise opens
//                                    the modal and runs actionFn on confirm.
//   PinGateElement                 — JSX to render once per page (renders the
//                                    modal when gated).
//
// Demo mode is exempt — actions still bubble through to the page's own
// demoBlock() handler, which surfaces the demo toast.
export default function usePinGate() {
  const { role, isDemo } = useAuth()
  const [pending, setPending] = useState(null) // { run, label } | null

  const requirePin = pinRequiredFor(role) && !isDemo && isPinSet()
  const noPinSetForRequiredRole = pinRequiredFor(role) && !isDemo && !isPinSet()

  const gate = useCallback(
    (actionFn, actionLabel) => {
      if (typeof actionFn !== 'function') return
      // Roles that don't need the PIN gate (partners, demo): just run.
      if (!pinRequiredFor(role) || isDemo) {
        actionFn()
        return
      }
      // No PIN configured yet — surface a console hint and run anyway, so the
      // dashboard doesn't soft-lock the very first admin. The Profile page
      // will tell them to set a PIN.
      if (noPinSetForRequiredRole) {
        actionFn()
        return
      }
      setPending({ run: actionFn, label: actionLabel })
    },
    [role, isDemo, noPinSetForRequiredRole],
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

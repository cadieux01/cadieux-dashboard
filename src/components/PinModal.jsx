import { useEffect, useRef, useState } from 'react'
import { PIN_LENGTH, MAX_ATTEMPTS, verifyPin, isPinSet, resetPin } from '../lib/pinSecurity'

const SECURITY_QUESTION = 'Who is your best friend?'

// ============================================================================
// PinModal — 6-digit PIN entry overlay used to gate sensitive dashboard
// actions. The PIN is verified SERVER-SIDE (account-level) via verifyPin().
// On open it asks the server whether a PIN is set for this account; if none is
// set it DEFAULT-DENIES (no Confirm) and points the user to Profile.
// Props:
//   isOpen        boolean   show / hide
//   onConfirm()             called once the PIN verifies on the server
//   onCancel()              called on Cancel or backdrop click
//   actionLabel             optional verb shown in the prompt
// ============================================================================
export default function PinModal({ isOpen, onConfirm, onCancel, actionLabel }) {
  const [digits, setDigits] = useState(() => Array(PIN_LENGTH).fill(''))
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [lockMs, setLockMs] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS)
  const [noPin, setNoPin] = useState(false)
  const [checking, setChecking] = useState(true)
  // Forgot-PIN recovery: 'verify' (default) or 'forgot' (security question).
  const [mode, setMode] = useState('verify')
  const [answer, setAnswer] = useState('')
  const [newDigits, setNewDigits] = useState(() => Array(PIN_LENGTH).fill(''))
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)
  const refs = useRef([])
  const newRefs = useRef([])

  // On open: reset, then ask the server whether a PIN exists for this account.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setDigits(Array(PIN_LENGTH).fill(''))
    setError(null)
    setVerifying(false)
    setLockMs(0)
    setAttemptsLeft(MAX_ATTEMPTS)
    setNoPin(false)
    setChecking(true)
    setMode('verify')
    setAnswer('')
    setNewDigits(Array(PIN_LENGTH).fill(''))
    setResetting(false)
    setResetError(null)
    isPinSet()
      .then((set) => {
        if (cancelled) return
        setNoPin(!set)
        setChecking(false)
        if (set) setTimeout(() => refs.current[0]?.focus(), 50)
      })
      .catch((e) => {
        if (cancelled) return
        // DEFAULT-DENY on error: keep the gate closed, surface the problem.
        setChecking(false)
        setError(e.message || 'Could not reach the PIN service.')
      })
    return () => { cancelled = true }
  }, [isOpen])

  // Tick the lockout countdown every second.
  useEffect(() => {
    if (!isOpen || lockMs <= 0) return
    const t = setInterval(() => {
      setLockMs((prev) => {
        const next = prev - 1000
        if (next <= 0) {
          setError(null)
          setAttemptsLeft(MAX_ATTEMPTS)
          return 0
        }
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [isOpen, lockMs])

  if (!isOpen) return null

  const handleChange = (i, v) => {
    const ch = v.replace(/\D/g, '').slice(0, 1)
    const next = [...digits]
    next[i] = ch
    setDigits(next)
    setError(null)
    if (ch && i < PIN_LENGTH - 1) refs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits]
        next[i] = ''
        setDigits(next)
      } else if (i > 0) {
        refs.current[i - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < PIN_LENGTH - 1) {
      refs.current[i + 1]?.focus()
    } else if (e.key === 'Enter') {
      attemptVerify()
    }
  }

  const handlePaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array(PIN_LENGTH).fill('')
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setDigits(next)
    setError(null)
    refs.current[Math.min(text.length, PIN_LENGTH - 1)]?.focus()
  }

  const attemptVerify = async () => {
    if (verifying || lockMs > 0 || noPin) return
    const pin = digits.join('')
    if (pin.length !== PIN_LENGTH) {
      setError(`Please enter all ${PIN_LENGTH} digits.`)
      return
    }
    setVerifying(true)
    setError(null)
    try {
      await verifyPin(pin)
      onConfirm()
    } catch (e) {
      setError(e.message)
      if (typeof e.lockedMs === 'number' && e.lockedMs > 0) setLockMs(e.lockedMs)
      if (typeof e.attemptsLeft === 'number') setAttemptsLeft(e.attemptsLeft)
      if (e.noPin) setNoPin(true)
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => refs.current[0]?.focus(), 0)
    } finally {
      setVerifying(false)
    }
  }

  const handleNewChange = (i, v) => {
    const ch = v.replace(/\D/g, '').slice(0, 1)
    const next = [...newDigits]
    next[i] = ch
    setNewDigits(next)
    setResetError(null)
    if (ch && i < PIN_LENGTH - 1) newRefs.current[i + 1]?.focus()
  }

  const handleNewKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (newDigits[i]) {
        const next = [...newDigits]
        next[i] = ''
        setNewDigits(next)
      } else if (i > 0) {
        newRefs.current[i - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      newRefs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < PIN_LENGTH - 1) {
      newRefs.current[i + 1]?.focus()
    }
  }

  const attemptReset = async () => {
    if (resetting) return
    if (!answer.trim()) {
      setResetError('Please answer the security question.')
      return
    }
    const newPin = newDigits.join('')
    if (newPin.length !== PIN_LENGTH) {
      setResetError(`Please enter all ${PIN_LENGTH} digits for the new PIN.`)
      return
    }
    setResetting(true)
    setResetError(null)
    try {
      await resetPin(answer, newPin)
      // New PIN is live; close the gate (the action re-verifies with it).
      onCancel()
    } catch (e) {
      setResetError(e.message || 'Could not reset the PIN.')
      setNewDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => newRefs.current[0]?.focus(), 0)
    } finally {
      setResetting(false)
    }
  }

  const lockSeconds = Math.ceil(lockMs / 1000)
  const lockMm = Math.floor(lockSeconds / 60)
  const lockSs = String(lockSeconds % 60).padStart(2, '0')

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(2,70,40,0.4)] p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[#E8E0D4] bg-white p-5 shadow-[0_24px_64px_rgba(2,70,40,0.18)] animate-[fadeIn_200ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#024628] text-[#fbf3d4]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.343 3-3V6a3 3 0 10-6 0v2c0 1.657 1.343 3 3 3zm-6 0h12v9a2 2 0 01-2 2H8a2 2 0 01-2-2v-9z" />
            </svg>
          </div>
          <div>
            <h2 id="pin-modal-title" className="font-display text-lg font-semibold text-slate-100">
              {mode === 'forgot' ? 'Reset dashboard PIN' : 'Security Verification'}
            </h2>
            <p className="text-xs text-slate-400">
              {mode === 'forgot'
                ? 'Answer the security question to set a new PIN.'
                : actionLabel ? `Confirm: ${actionLabel}` : 'Enter your dashboard PIN to confirm.'}
            </p>
          </div>
        </div>

        {mode === 'forgot' ? (
          <>
            <div className="my-4">
              <label className="mb-1 block text-sm font-medium text-slate-300">{SECURITY_QUESTION}</label>
              <input
                type="text"
                autoFocus
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); setResetError(null) }}
                placeholder="Your answer"
                disabled={resetting}
                className="w-full rounded-lg border border-[#D1C9BC] bg-white px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-[#024628] focus:ring-2 focus:ring-[#024628]/40 disabled:opacity-50"
              />
            </div>

            <div className="mb-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">New 6-digit PIN</label>
              <div className="flex justify-center gap-2">
                {newDigits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (newRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleNewChange(i, e.target.value)}
                    onKeyDown={(e) => handleNewKeyDown(i, e)}
                    disabled={resetting}
                    className="h-11 w-10 rounded-lg border border-[#D1C9BC] bg-white text-center font-display text-xl font-bold text-slate-100 outline-none transition-colors focus:border-[#024628] focus:ring-2 focus:ring-[#024628]/40 disabled:opacity-50"
                    aria-label={`New PIN digit ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {resetError && (
              <p className="mb-3 mt-2 text-center text-sm font-semibold text-rose-400">{resetError}</p>
            )}
          </>
        ) : checking ? (
          <div className="my-6 flex items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-[#024628] border-t-transparent" />
          </div>
        ) : noPin ? (
          <div className="my-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
            No dashboard PIN has been set for this account. An admin must set one
            in <span className="font-semibold">Profile → Dashboard Security PIN</span> before
            this action can be approved.
          </div>
        ) : (
          <>
            <div className="my-4 flex justify-center gap-2" onPaste={handlePaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (refs.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={lockMs > 0 || verifying}
                  className="h-11 w-10 rounded-lg border border-[#D1C9BC] bg-white text-center font-display text-xl font-bold text-slate-100 outline-none transition-colors focus:border-[#024628] focus:ring-2 focus:ring-[#024628]/40 disabled:opacity-50"
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>

            {lockMs > 0 && (
              <p className="mb-3 rounded-lg border border-rose-700/40 bg-rose-500/10 px-3 py-2 text-center text-sm font-semibold text-rose-300">
                Locked. Try again in {lockMm}:{lockSs}
              </p>
            )}

            {error && lockMs === 0 && (
              <p className="mb-3 text-center text-sm font-semibold text-rose-400">{error}</p>
            )}

            <p className="mb-2 text-center text-[11px] text-slate-500">
              {MAX_ATTEMPTS} wrong attempts = 5 min lockout
              {lockMs === 0 && attemptsLeft < MAX_ATTEMPTS ? ` · ${attemptsLeft} left` : ''}
            </p>

            <p className="mb-4 text-center">
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(null) }}
                className="text-xs font-semibold text-[#024628] underline-offset-2 hover:underline"
              >
                Forgot PIN?
              </button>
            </p>
          </>
        )}

        <div className="flex gap-2">
          {mode === 'forgot' ? (
            <>
              <button
                type="button"
                onClick={() => { setMode('verify'); setResetError(null); setTimeout(() => refs.current[0]?.focus(), 0) }}
                disabled={resetting}
                className="flex-1 rounded-lg border border-[#D1C9BC] bg-white px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-[#F0EBE3] disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={attemptReset}
                disabled={resetting}
                className="flex-1 rounded-lg bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset PIN'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-lg border border-[#D1C9BC] bg-white px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-[#F0EBE3]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={attemptVerify}
                disabled={checking || noPin || lockMs > 0 || verifying}
                className="flex-1 rounded-lg bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifying ? 'Verifying…' : 'Confirm'}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  PIN_LENGTH,
  verifyPin,
  isPinSet,
  getLockoutRemainingMs,
  getAttempts,
  MAX_ATTEMPTS,
} from '../lib/pinSecurity'

// ============================================================================
// PinModal — 6-digit PIN entry overlay used to gate every dashboard write.
// Props:
//   isOpen        boolean   show / hide
//   onConfirm()             called once the PIN verifies
//   onCancel()              called on Cancel or backdrop click
//   actionLabel             optional verb shown in the prompt (e.g. "Delete partner")
// ============================================================================
export default function PinModal({ isOpen, onConfirm, onCancel, actionLabel }) {
  const [digits, setDigits] = useState(() => Array(PIN_LENGTH).fill(''))
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [lockMs, setLockMs] = useState(0)
  const [attempts, setAttempts] = useState(0)
  const refs = useRef([])

  // Reset internal state every time the modal opens.
  useEffect(() => {
    if (!isOpen) return
    setDigits(Array(PIN_LENGTH).fill(''))
    setError(null)
    setVerifying(false)
    setAttempts(getAttempts())
    setLockMs(getLockoutRemainingMs())
    // Autofocus the first input after the modal mounts.
    const t = setTimeout(() => refs.current[0]?.focus(), 50)
    return () => clearTimeout(t)
  }, [isOpen])

  // Tick the lockout countdown every second.
  useEffect(() => {
    if (!isOpen || lockMs <= 0) return
    const t = setInterval(() => {
      const next = getLockoutRemainingMs()
      setLockMs(next)
      if (next <= 0) {
        setError(null)
        setAttempts(0)
      }
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
    if (verifying) return
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
      setAttempts(getAttempts())
      setLockMs(getLockoutRemainingMs())
      // Clear digits + refocus first box so user can retry without manual clearing.
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => refs.current[0]?.focus(), 0)
    } finally {
      setVerifying(false)
    }
  }

  const lockSeconds = Math.ceil(lockMs / 1000)
  const lockMm = Math.floor(lockSeconds / 60)
  const lockSs = String(lockSeconds % 60).padStart(2, '0')
  const noPin = !isPinSet()

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
            <h2 id="pin-modal-title" className="font-display text-lg font-semibold text-slate-100">Security Verification</h2>
            <p className="text-xs text-slate-400">
              {actionLabel ? `Confirm: ${actionLabel}` : 'Enter your dashboard PIN to confirm.'}
            </p>
          </div>
        </div>

        {noPin ? (
          <div className="my-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
            No dashboard PIN has been set on this device. Ask an admin to set one
            in <span className="font-semibold">Profile → Dashboard Security PIN</span>.
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

            <p className="mb-4 text-center text-[11px] text-slate-500">
              {MAX_ATTEMPTS} wrong attempts = 5 min lockout · {attempts > 0 && lockMs === 0 ? `${attempts} attempted` : 'enter PIN'}
            </p>
          </>
        )}

        <div className="flex gap-2">
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
            disabled={noPin || lockMs > 0 || verifying}
            className="flex-1 rounded-lg bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying ? 'Verifying…' : 'Confirm'}
          </button>
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

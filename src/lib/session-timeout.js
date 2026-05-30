// Inactivity auto-logout hook for the Sunny dashboard.
//
// Tracks pointer/keyboard/scroll/visibility, resets an idle timer on
// each interaction, optionally warns shortly before expiry, then calls
// onTimeout (e.g. supabase.auth.signOut() + navigate('/login')).
// Cross-tab safe via a shared "last activity" timestamp in localStorage.

import { useCallback, useEffect, useRef } from 'react'

export const IDLE = {
  SUPER_ADMIN: 30 * 60 * 1000, // 30 minutes (parity with cadieux.in/admin)
  DASHBOARD: 60 * 60 * 1000, // 60 minutes
}

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
]

const LS_KEY = 'cdx_last_activity'
const WRITE_THROTTLE_MS = 5_000

export function useIdleLogout({
  timeoutMs,
  onTimeout,
  onWarn,
  warnBeforeMs = 60_000,
  enabled = true,
}) {
  const idleTimer = useRef(null)
  const warnTimer = useRef(null)
  const lastWrite = useRef(0)
  const firedRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (warnTimer.current) clearTimeout(warnTimer.current)
  }, [])

  const arm = useCallback(() => {
    clearTimers()
    if (warnBeforeMs > 0 && warnBeforeMs < timeoutMs && onWarn) {
      warnTimer.current = setTimeout(
        () => onWarn(warnBeforeMs),
        timeoutMs - warnBeforeMs,
      )
    }
    idleTimer.current = setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      Promise.resolve(onTimeout()).catch(() => {})
    }, timeoutMs)
  }, [clearTimers, onTimeout, onWarn, timeoutMs, warnBeforeMs])

  const onActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastWrite.current > WRITE_THROTTLE_MS) {
      lastWrite.current = now
      try {
        localStorage.setItem(LS_KEY, String(now))
      } catch {
        /* ignore */
      }
    }
    arm()
  }, [arm])

  useEffect(() => {
    if (!enabled) return undefined

    firedRef.current = false

    let initialDelay = timeoutMs
    try {
      const stored = Number(localStorage.getItem(LS_KEY))
      if (Number.isFinite(stored) && stored > 0) {
        const elapsed = Date.now() - stored
        if (elapsed >= timeoutMs) {
          firedRef.current = true
          Promise.resolve(onTimeout()).catch(() => {})
          return undefined
        }
        initialDelay = timeoutMs - elapsed
      }
    } catch {
      /* ignore */
    }

    clearTimers()
    idleTimer.current = setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      Promise.resolve(onTimeout()).catch(() => {})
    }, initialDelay)

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    const onStorage = (e) => {
      if (e.key === LS_KEY) arm()
    }
    window.addEventListener('storage', onStorage)
    const onVisible = () => {
      if (document.visibilityState === 'visible') onActivity()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimers()
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity)
      }
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutMs])
}

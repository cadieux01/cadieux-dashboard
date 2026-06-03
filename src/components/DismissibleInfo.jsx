import { useState } from 'react'
import AlertBanner from './AlertBanner'

// Compact info banner that remembers its dismissal in localStorage, so a
// one-time hint (e.g. "Phone login") is shown once and never nags again.
export default function DismissibleInfo({ storageKey, type = 'info', title, message }) {
  const key = `dismissed:${storageKey}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  if (dismissed) return null

  const handleDismiss = () => {
    try {
      localStorage.setItem(key, '1')
    } catch {
      // ignore storage failures — still hide for this session
    }
    setDismissed(true)
  }

  return <AlertBanner type={type} title={title} message={message} onDismiss={handleDismiss} />
}

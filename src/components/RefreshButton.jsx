import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'

/**
 * Compact ghost refresh button. Icon-only on mobile, "Refresh" text on desktop.
 * Spins the icon for at least 0.5s while refreshing, then shows a subtle
 * "Updated" label for 2s.
 *
 * Props:
 *   onRefresh()   async callback that re-fetches the page data
 *   loading       external loading flag (also spins the icon)
 */
export default function RefreshButton({ onRefresh, loading = false }) {
  const [spinning, setSpinning] = useState(false)
  const [showUpdated, setShowUpdated] = useState(false)
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const handleClick = async () => {
    if (spinning || loading) return
    setSpinning(true)
    setShowUpdated(false)
    const started = Date.now()
    try {
      await onRefresh?.()
    } finally {
      // Keep the spin visible for at least 0.5s so it doesn't flicker.
      const remaining = Math.max(0, 500 - (Date.now() - started))
      timers.current.push(
        setTimeout(() => {
          setSpinning(false)
          setShowUpdated(true)
          timers.current.push(setTimeout(() => setShowUpdated(false), 2000))
        }, remaining)
      )
    }
  }

  const busy = spinning || loading

  return (
    <div className="flex items-center gap-2">
      {showUpdated && <span className="text-xs font-medium text-emerald-400">Updated</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label="Refresh"
        title="Refresh"
        className="inline-flex items-center gap-2 rounded-lg border border-[#E8E0D4] bg-[#F0EBE3] px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-[#ECE5DA] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCw size={16} className={busy ? 'animate-spin' : ''} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </div>
  )
}

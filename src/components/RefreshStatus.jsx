import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'

function relativeTime(ts) {
  if (!ts) return 'just now'
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs} seconds ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Drop-in bottom-of-page refresh status. Renders:
 *   - a fixed pull-to-refresh spinner at the top while pulling / refreshing
 *   - a muted "Last updated: X ago" line that re-ticks every 30s and refreshes
 *     when clicked
 *
 * Position-independent (the pull spinner is fixed), so render it at the end of
 * the page content.
 *
 * Props: { pullDistance, refreshing, at, onRefresh }
 */
export default function RefreshStatus({ pullDistance = 0, refreshing = false, at, onRefresh }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const showSpinner = pullDistance > 0 || refreshing

  return (
    <>
      {showSpinner && (
        <div
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2"
          style={{ opacity: refreshing ? 1 : Math.min(1, pullDistance / 60) }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E8E0D4] bg-white shadow-lg">
            <RotateCw
              size={16}
              className={`text-slate-200 ${refreshing ? 'animate-spin' : ''}`}
              style={refreshing ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }}
            />
          </div>
        </div>
      )}
      <div className="mt-8 flex justify-center pb-2">
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-slate-500 transition hover:text-slate-300"
        >
          Last updated: {relativeTime(at)}
        </button>
      </div>
    </>
  )
}

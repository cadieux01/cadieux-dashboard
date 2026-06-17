import { useEffect, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { getStockPool } from '../lib/allot'

// ============================================================================
// Central stock summary — current AVAILABLE central units per variant + total.
// "Available" = non-expired batch units minus units already reserved by pending
// allotments (the same getStockPool figure the Allot page uses), so the number
// reads identically on both the Allot view and the Batches view.
//   • Controlled: pass `pool` ({ variant:{ total, available } }) when the parent
//     already loaded it (Allot).
//   • Self-fetching: omit `pool`; re-fetches whenever `refreshKey` changes.
// ============================================================================

const VARIANT_KEYS = ['multigrain', 'plain']
const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

export default function CentralStockSummary({ pool: poolProp, refreshKey }) {
  const [poolState, setPoolState] = useState(null)

  useEffect(() => {
    if (poolProp !== undefined) return undefined
    let alive = true
    getStockPool()
      .then((p) => {
        if (alive) setPoolState(p)
      })
      .catch((e) => console.warn('CentralStockSummary load failed:', e.message))
    return () => {
      alive = false
    }
  }, [poolProp, refreshKey])

  const pool = poolProp !== undefined ? poolProp : poolState
  const totalAvail = VARIANT_KEYS.reduce((sum, v) => sum + (pool?.[v]?.available || 0), 0)

  return (
    <div className={CARD}>
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Central stock</h2>
      <div className="grid grid-cols-3 gap-3">
        {VARIANT_KEYS.map((v) => (
          <div key={v} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-4 sm:px-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{VARIANTS[v]?.short || v}</p>
            <p className="mt-1 font-display text-3xl font-bold text-slate-100">{pool?.[v]?.available || 0}</p>
            <p className="mt-0.5 text-xs text-slate-500">available · {pool?.[v]?.total || 0} total</p>
          </div>
        ))}
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-4 sm:px-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Total</p>
          <p className="mt-1 font-display text-3xl font-bold text-emerald-300">{totalAvail}</p>
          <p className="mt-0.5 text-xs text-slate-500">all variants available</p>
        </div>
      </div>
    </div>
  )
}

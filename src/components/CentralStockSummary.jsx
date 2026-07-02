import { useEffect, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { getStockPool } from '../lib/allot'

// ============================================================================
// Central stock summary — DISPLAY-ONLY breakdown per variant.
//
// For each variant we show four numbers so the admin always knows why the big
// number is what it is:
//   • Total      Σ quantity_remaining across ALL batches (expired kept in)
//   • Active     Σ quantity_remaining of NON-EXPIRED batches (usable pool)
//   • Reserved   Σ units of PENDING allotments (subtracted from active)
//   • Available  logistics.central_available(v) = max(0, Active − Reserved)
//
// Nothing here changes writes, RPCs, triggers, allot_guard, FIFO, or the
// assignment chain. Expired stock stays counted in Total; it just drops out of
// Active. If Available < Active, that gap is the pending-allotment reservation
// and we show it explicitly so the number is never mysterious.
//
//   • Controlled: pass `pool` (from getStockPool()) when the parent already
//     loaded it (Allot).
//   • Self-fetching: omit `pool`; re-fetches whenever `refreshKey` changes.
// ============================================================================

const VARIANT_KEYS = ['multigrain', 'plain']
const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

function StatRow({ label, value, valueCls = 'text-slate-200' }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </div>
  )
}

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
  const totalActive = VARIANT_KEYS.reduce((sum, v) => sum + (pool?.[v]?.active || 0), 0)
  const totalAll = VARIANT_KEYS.reduce((sum, v) => sum + (pool?.[v]?.total || 0), 0)
  const totalReserved = VARIANT_KEYS.reduce((sum, v) => sum + (pool?.[v]?.pending || 0), 0)
  const totalExpired = Math.max(0, totalAll - totalActive)

  return (
    <div className={CARD}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Central stock</h2>
        <p className="text-xs text-slate-500">Available = Active − Reserved</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {VARIANT_KEYS.map((v) => {
          const active = pool?.[v]?.active || 0
          const total = pool?.[v]?.total || 0
          const expired = pool?.[v]?.expired || 0
          const pending = pool?.[v]?.pending || 0
          const avail = pool?.[v]?.available || 0
          return (
            <div key={v} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-4 sm:px-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {VARIANTS[v]?.short || v}
                </p>
                {expired > 0 && (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
                    {expired} expired
                  </span>
                )}
              </div>
              <p className="mt-1 font-display text-3xl font-bold text-slate-100">{avail}</p>
              <p className="mt-0.5 text-xs text-slate-500">available to allot</p>
              <div className="mt-3 space-y-1 border-t border-slate-800/70 pt-2">
                <StatRow label="Total (incl. expired)" value={total} />
                <StatRow label="Active (non-expired)" value={active} valueCls="text-emerald-300" />
                <StatRow
                  label="Reserved (pending)"
                  value={pending}
                  valueCls={pending > 0 ? 'text-amber-300' : 'text-slate-300'}
                />
              </div>
              {pending > 0 && (
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  {pending} unit{pending === 1 ? '' : 's'} reserved by pending allotments.
                </p>
              )}
            </div>
          )
        })}

        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-4 sm:px-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Total available</p>
          <p className="mt-1 font-display text-3xl font-bold text-emerald-300">{totalAvail}</p>
          <p className="mt-0.5 text-xs text-slate-500">all variants</p>
          <div className="mt-3 space-y-1 border-t border-emerald-500/20 pt-2">
            <StatRow label="Total (incl. expired)" value={totalAll} />
            <StatRow label="Active (non-expired)" value={totalActive} valueCls="text-emerald-200" />
            <StatRow
              label="Reserved (pending)"
              value={totalReserved}
              valueCls={totalReserved > 0 ? 'text-amber-300' : 'text-slate-300'}
            />
            {totalExpired > 0 && (
              <StatRow label="Expired (still in Total)" value={totalExpired} valueCls="text-rose-300" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { getStockPool } from '../lib/allot'
import { listBatches } from '../lib/batches'
import { getBatchHolders } from '../lib/batchHolders'

// ============================================================================
// Central stock summary — DISPLAY-ONLY lifecycle breakdown per variant.
//
// Sections rendered top-to-bottom in this order:
//
//   ACTIVE    In central, non-expired. Ready to allot / assign out.
//             (Reserved by pending allotments is called out as a caveat so
//              the number reconciles with Available = Active − Reserved.)
//   RUNNING   Delivered to agents / partners, non-expired, still unsold.
//   SOLD      Sold through to end customers (all-time, across every batch).
//   EXPIRED   Batch expiry_at ≤ now, still-unsold units (in central OR held).
//
// Derivation per batch (identity: qty = qty_remaining + held + sold):
//   held = Σ getBatchHolders()[batch.id].units
//   sold = max(0, qty − qty_remaining − held)
//   expired = expiry_at ≤ now
//   → expired batch: EXPIRED += qty_remaining + held; SOLD += sold
//   → live batch:    ACTIVE += qty_remaining; RUNNING += held; SOLD += sold
//
// Nothing here changes writes, RPCs, triggers, allot_guard, FIFO, or the
// assignment chain. Pure additive READ over listBatches() + getBatchHolders().
//
//   • Controlled: pass `pool` (from getStockPool()) when the parent already
//     loaded it (Allot). We still self-fetch batches + holders for lifecycle.
//   • Self-fetching: omit `pool`; re-fetches whenever `refreshKey` changes.
// ============================================================================

const VARIANT_KEYS = ['multigrain', 'plain']
const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

function computeLifecycle(batches, holdersByBatch, nowMs) {
  const zero = () => ({ active: 0, running: 0, sold: 0, expired: 0 })
  const perVariant = { multigrain: zero(), plain: zero() }
  for (const b of batches || []) {
    const v = b.variant
    if (!perVariant[v]) continue
    const rem = Number(b.quantity_remaining || 0)
    const qty = Number(b.quantity || 0)
    const held = (holdersByBatch?.[b.id] || []).reduce(
      (s, h) => s + Number(h.units || 0),
      0,
    )
    const sold = Math.max(0, qty - rem - held)
    const expMs = b.expiry_at ? new Date(b.expiry_at).getTime() : null
    const isExpired = expMs != null && expMs <= nowMs
    if (isExpired) {
      perVariant[v].expired += rem + held
    } else {
      perVariant[v].active += rem
      perVariant[v].running += held
    }
    perVariant[v].sold += sold
  }
  return perVariant
}

// Colour + tone tokens per lifecycle group, kept consistent with the rest of
// the app (emerald=active, amber=running/reserved, slate=neutral/sold,
// rose=expired).
const SECTIONS = [
  {
    key: 'active',
    label: 'Active',
    caption: 'In central, non-expired · ready to allot',
    dotCls: 'bg-emerald-400',
    borderCls: 'border-emerald-500/25',
    bgCls: 'bg-emerald-500/5',
    numberCls: 'text-emerald-300',
  },
  {
    key: 'running',
    label: 'Running',
    caption: 'With agents / partners · non-expired, unsold',
    dotCls: 'bg-amber-400',
    borderCls: 'border-amber-500/25',
    bgCls: 'bg-amber-500/5',
    numberCls: 'text-amber-300',
  },
  {
    key: 'sold',
    label: 'Sold',
    caption: 'Sold through to end customers · all-time',
    dotCls: 'bg-slate-400',
    borderCls: 'border-slate-700',
    bgCls: 'bg-slate-800/40',
    numberCls: 'text-slate-200',
  },
  {
    key: 'expired',
    label: 'Expired',
    caption: 'Past expiry · still-unsold units (central + held)',
    dotCls: 'bg-rose-400',
    borderCls: 'border-rose-500/25',
    bgCls: 'bg-rose-500/5',
    numberCls: 'text-rose-300',
  },
]

function VariantChip({ v, value, numberCls }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">
        {VARIANTS[v]?.short || v}
      </span>
      <span className={`text-lg font-semibold tabular-nums ${numberCls}`}>
        {value}
      </span>
    </div>
  )
}

export default function CentralStockSummary({ pool: poolProp, refreshKey }) {
  const [poolState, setPoolState] = useState(null)
  const [batches, setBatches] = useState([])
  const [holders, setHolders] = useState({})
  const [now, setNow] = useState(Date.now())

  // Pool: controlled or self-fetched (kept for the Reserved caveat under Active).
  useEffect(() => {
    if (poolProp !== undefined) return undefined
    let alive = true
    getStockPool()
      .then((p) => {
        if (alive) setPoolState(p)
      })
      .catch((e) => console.warn('CentralStockSummary pool load failed:', e.message))
    return () => {
      alive = false
    }
  }, [poolProp, refreshKey])

  // Batches + holders drive the 4-way lifecycle split. Always self-fetched
  // because they aren't otherwise on Allot; refetched with refreshKey.
  useEffect(() => {
    let alive = true
    Promise.all([listBatches(), getBatchHolders()])
      .then(([bs, hs]) => {
        if (!alive) return
        setBatches(bs || [])
        setHolders(hs || {})
      })
      .catch((e) => console.warn('CentralStockSummary batches load failed:', e.message))
    return () => {
      alive = false
    }
  }, [refreshKey])

  // Tick "now" every second so a batch flipping to expired mid-view is
  // reflected without waiting on the next refetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const pool = poolProp !== undefined ? poolProp : poolState
  const lifecycle = computeLifecycle(batches, holders, now)

  const totals = SECTIONS.reduce((acc, s) => {
    acc[s.key] = VARIANT_KEYS.reduce((sum, v) => sum + (lifecycle[v]?.[s.key] || 0), 0)
    return acc
  }, {})

  const reservedByVariant = {
    multigrain: pool?.multigrain?.pending || 0,
    plain: pool?.plain?.pending || 0,
  }
  const reservedTotal = reservedByVariant.multigrain + reservedByVariant.plain

  return (
    <div className={CARD}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Central stock</h2>
        <p className="text-xs text-slate-500">Active → Running → Sold → Expired</p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((s) => {
          const total = totals[s.key] || 0
          return (
            <div
              key={s.key}
              className={`rounded-xl border ${s.borderCls} ${s.bgCls} px-3 py-3 sm:px-4 sm:py-4`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${s.dotCls}`} />
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                      {s.label}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    {s.caption}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-4">
                  {VARIANT_KEYS.map((v) => (
                    <VariantChip
                      key={v}
                      v={v}
                      value={lifecycle[v]?.[s.key] || 0}
                      numberCls={s.numberCls}
                    />
                  ))}
                  <div className="border-l border-slate-800 pl-4">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Total</p>
                    <p className={`font-display text-2xl font-bold tabular-nums ${s.numberCls}`}>
                      {total}
                    </p>
                  </div>
                </div>
              </div>

              {s.key === 'active' && reservedTotal > 0 && (
                <p className="mt-2 text-[11px] leading-snug text-amber-300/80">
                  {reservedTotal} unit{reservedTotal === 1 ? '' : 's'} reserved by pending
                  allotments{reservedByVariant.multigrain > 0 || reservedByVariant.plain > 0 ? ' — ' : ''}
                  {reservedByVariant.multigrain > 0 && (
                    <span>{reservedByVariant.multigrain} {VARIANTS.multigrain?.short || 'multigrain'}</span>
                  )}
                  {reservedByVariant.multigrain > 0 && reservedByVariant.plain > 0 && ', '}
                  {reservedByVariant.plain > 0 && (
                    <span>{reservedByVariant.plain} {VARIANTS.plain?.short || 'plain'}</span>
                  )}
                  . Available to allot = Active − Reserved.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

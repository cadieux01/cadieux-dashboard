import { useEffect, useRef, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { formatDateTimeDDMMYY } from '../lib/date'
import {
  getPartnerHoldingsByBatch,
  getPartnerUnsold,
  recordPartnerUnsoldExpired,
} from '../lib/partnerInventory'
import { batchMsLeft, fmtBatchLeft } from '../lib/batches'

// ============================================================================
// PartnerUnsold — the partner's EXPIRY → UNSOLD lifecycle (Stage 7, final).
//
//   Received by batch in-hand batch lots with a LIVE countdown (d:h:m:s) on the
//                     carried clock — green, amber ≤ 24h, rose once expired.
//   Expired in hand   lots whose freshness clock has hit ZERO (derived live
//                     from a 1s tick, no cron). admin/sales get a one-tap
//                     "Record as unsold"; the partner just sees them in red.
//   Unsold list       formally recorded wasted stock (reason 'expired'). The
//                     row keeps the ORIGINAL batch timeline (clock not reset),
//                     so it always reads EXPIRED. Tracking only, no charge.
//
// Partners can't read central_stock_batches directly, so the holdings + unsold
// reads and the record write all go through SECURITY DEFINER RPCs. Recording is
// admin/sales-only (canManage) — the partner surface is read-only.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

// green / amber (≤24h) / rose (expired) for a live countdown.
function freshnessCls(ms) {
  if (ms == null) return 'text-slate-500'
  if (ms <= 0) return 'text-rose-400'
  if (ms <= 24 * 60 * 60 * 1000) return 'text-amber-400'
  return 'text-emerald-400'
}

export default function PartnerUnsold({ partnerId, canManage = false }) {
  const [holdings, setHoldings] = useState([])
  const [unsold, setUnsold] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)
  const tickRef = useRef(null)

  const load = async (background = false) => {
    if (!background) setLoading(true)
    try {
      const [h, u] = await Promise.all([
        getPartnerHoldingsByBatch(partnerId),
        getPartnerUnsold(partnerId),
      ])
      setHoldings(h)
      setUnsold(u)
    } catch (e) {
      console.warn('PartnerUnsold load failed:', e.message)
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const onFocus = () => load(true)
    const onVisible = () => { if (document.visibilityState === 'visible') load(true) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const poll = setInterval(() => load(true), 60000)
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(poll)
      clearInterval(tickRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId])

  // Live partition: a lot with a batch whose clock has hit zero is expired.
  const fresh = holdings.filter((h) => !h.batch || batchMsLeft(h.batch.expiry_at, now) > 0)
  const expired = holdings.filter((h) => h.batch && batchMsLeft(h.batch.expiry_at, now) <= 0)

  const record = async (lot) => {
    if (!lot.batch) return
    setErr(null)
    setBusyId(lot.batch.id)
    try {
      await recordPartnerUnsoldExpired({
        partnerId,
        batchId: lot.batch.id,
        units: lot.units,
        variant: lot.variant,
      })
      await load(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-400">Loading stock…</p>
      </div>
    )
  }

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-lg font-semibold text-slate-100">Received stock &amp; shelf life</h2>
      <p className="mb-4 text-xs text-slate-500">
        Each batch carries its own freshness clock from the day it was made — it doesn&apos;t reset when it reaches you.
      </p>

      {/* Received by batch — live countdown */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">In hand by batch</h3>
      {fresh.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">No fresh stock in hand.</p>
      ) : (
        <div className="mb-4 space-y-2">
          {fresh.map((h, i) => {
            const ms = h.batch ? batchMsLeft(h.batch.expiry_at, now) : null
            return (
              <div
                key={`${h.batch?.id || 'nobatch'}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    {h.units} × {h.variant_label || VARIANTS[h.variant]?.short || h.variant}
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.batch ? `Batch #${h.batch.batch_number}` : 'No batch · no expiry'}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-xs font-semibold ${freshnessCls(ms)}`}>
                  {h.batch ? (fmtBatchLeft(ms) || 'Expired') : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Expired in hand — needs recording */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">Expired in hand</h3>
      {expired.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">Nothing expired in hand. 🎉</p>
      ) : (
        <div className="mb-4 space-y-2">
          {expired.map((h, i) => (
            <div
              key={`${h.batch.id}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">
                  {h.units} × {h.variant_label || VARIANTS[h.variant]?.short || h.variant}
                </p>
                <p className="text-xs text-rose-400">
                  Batch #{h.batch.batch_number} · <span className="font-semibold">EXPIRED</span>
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => record(h)}
                  disabled={busyId === h.batch.id}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-[#fbf3d4] hover:bg-rose-500 disabled:opacity-50"
                >
                  {busyId === h.batch.id ? '…' : 'Record as unsold'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="mb-3 text-sm font-semibold text-rose-400">{err}</p>}

      {/* Recorded unsold history */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">Unsold list</h3>
      {unsold.length === 0 ? (
        <p className="text-sm text-slate-400">No unsold units recorded.</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {unsold.map((u) => (
            <div
              key={u.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">
                  {u.units} × {u.variant_label || VARIANTS[u.variant]?.short || u.variant}
                </p>
                <p className="text-xs text-slate-500">{formatDateTimeDDMMYY(u.created_at)}</p>
                <p className="mt-0.5 text-xs font-semibold text-rose-400">
                  {u.batch ? `Batch #${u.batch.batch_number} · ` : ''}
                  {fmtBatchLeft(u.batch ? batchMsLeft(u.batch.expiry_at, now) : null) || u.reason.toUpperCase()}
                </p>
              </div>
              <span className="flex-shrink-0 rounded bg-rose-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-rose-400">
                {u.reason}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

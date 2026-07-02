import { useEffect, useRef, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { formatDateTimeDDMMYY } from '../lib/date'
import {
  getPartnerHoldingsByBatch,
  getPartnerUnsold,
  recordPartnerUnsoldExpired,
  retractFromPartner,
} from '../lib/partnerInventory'
import { batchMsLeft, fmtBatchLeft, getShelfLife } from '../lib/batches'

// ============================================================================
// PartnerUnsold — the partner's EXPIRY → UNSOLD lifecycle (Stage 7, final).
//
//   In hand by batch   the partner's batch-stamped in-hand lots with a LIVE
//                     countdown on the carried clock. Row + countdown color
//                     is now FRACTION-OF-SHELF-LIFE based (variant-aware,
//                     read from shelf_life_settings — NOT hardcoded), so
//                     Multi-Grain (3d) turns urgent by day 2 while Plain (6d)
//                     stays fresh at the same age. Non-expired rows carry a
//                     RETRACT CTA (admin/sales only) that opens the Phase-3
//                     bounded retract flow (retract_from_partner RPC).
//   Expired in hand   lots whose freshness clock has hit ZERO. admin/sales
//                     get a one-tap "Record as unsold"; no Retract CTA here
//                     (expired stock follows the unsold flow, not retract).
//   Unsold list       formally recorded wasted stock (reason 'expired'). Row
//                     keeps the ORIGINAL batch timeline, so it always reads
//                     EXPIRED. Tracking only, no charge.
//
// Partners can't read central_stock_batches directly, so the holdings + unsold
// reads and the record write all go through SECURITY DEFINER RPCs. Recording
// and retract are admin/sales-only (canManage) — partner surface is read-only.
// Retract uses the EXISTING retract_from_partner RPC unchanged — variant-scoped
// FIFO with partner_insufficient_stock as the authoritative bound.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const DAY_MS = 24 * 60 * 60 * 1000

// Variant-aware freshness by fraction of shelf life CONSUMED:
//   fraction < 1/3  → FRESH   (emerald)
//   1/3 ≤ f < 2/3   → AGING   (amber)
//   fraction ≥ 2/3  → URGENT  (rose text on light rose row)
//   expired         → EXPIRED (muted / rose, no CTA)
//   no batch clock  → neutral
// shelfDays comes from shelf_life_settings (admin-editable), so tweaking
// MG or Plain shelf life immediately rebases these colors.
function freshnessInfo(lot, shelfDays, nowMs) {
  const NEUTRAL = { rowCls: 'border-slate-800 bg-slate-950/40', textCls: 'text-slate-500', label: null, isExpired: false }
  if (!lot.batch) return NEUTRAL
  const expMs = lot.batch.expiry_at ? new Date(lot.batch.expiry_at).getTime() : null
  if (expMs == null) return NEUTRAL
  const msLeft = expMs - nowMs
  if (msLeft <= 0) {
    return {
      rowCls: 'border-rose-500/40 bg-rose-500/10',
      textCls: 'text-rose-400',
      label: 'Expired',
      isExpired: true,
    }
  }
  const createdMs = lot.batch.created_at ? new Date(lot.batch.created_at).getTime() : null
  const shelfMs = (shelfDays?.[lot.variant] || 3) * DAY_MS
  if (createdMs == null || shelfMs <= 0) {
    return { rowCls: 'border-emerald-500/25 bg-emerald-500/5', textCls: 'text-emerald-400', label: 'Fresh', isExpired: false }
  }
  const fraction = Math.max(0, Math.min(1, (nowMs - createdMs) / shelfMs))
  if (fraction < 1 / 3) {
    return { rowCls: 'border-emerald-500/25 bg-emerald-500/5', textCls: 'text-emerald-400', label: 'Fresh', isExpired: false }
  }
  if (fraction < 2 / 3) {
    return { rowCls: 'border-amber-500/30 bg-amber-500/5', textCls: 'text-amber-400', label: 'Aging', isExpired: false }
  }
  return { rowCls: 'border-rose-500/30 bg-rose-500/10', textCls: 'text-rose-400', label: 'Urgent', isExpired: false }
}

const RETRACT_REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'unsold', label: 'Unsold return' },
  { value: 'wrong_partner', label: 'Wrong partner' },
  { value: 'other', label: 'Other' },
]

export default function PartnerUnsold({ partnerId, canManage = false }) {
  const [holdings, setHoldings] = useState([])
  const [unsold, setUnsold] = useState([])
  const [shelf, setShelf] = useState({ multigrain: 3, plain: 6 })
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)

  // Per-row retract state. lotKey identifies the row that opened the form.
  const [retractOpen, setRetractOpen] = useState(null)
  const [retractForm, setRetractForm] = useState({ units: 0, reason: 'damaged', notes: '' })
  const [retractBusy, setRetractBusy] = useState(false)
  const [retractErr, setRetractErr] = useState(null)

  const tickRef = useRef(null)

  const load = async (background = false) => {
    if (!background) setLoading(true)
    try {
      const [h, u, s] = await Promise.all([
        getPartnerHoldingsByBatch(partnerId),
        getPartnerUnsold(partnerId),
        getShelfLife(),
      ])
      setHoldings(h)
      setUnsold(u)
      setShelf(s)
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

  const openRetract = (lotKey, lot) => {
    setRetractOpen(lotKey)
    setRetractForm({ units: lot.units || 1, reason: 'damaged', notes: '' })
    setRetractErr(null)
  }

  const closeRetract = () => {
    setRetractOpen(null)
    setRetractErr(null)
    setRetractBusy(false)
  }

  const submitRetract = async (lot) => {
    setRetractErr(null)
    const units = parseInt(retractForm.units, 10)
    if (Number.isNaN(units) || units <= 0) {
      setRetractErr('Enter at least 1 unit.')
      return
    }
    if (units > (lot.units || 0)) {
      setRetractErr(`Cannot exceed ${lot.units} unit${lot.units === 1 ? '' : 's'} in this lot.`)
      return
    }
    setRetractBusy(true)
    try {
      await retractFromPartner({
        partnerId,
        variant: lot.variant,
        units,
        reason: retractForm.reason || null,
        notes: retractForm.notes?.trim() || null,
      })
      closeRetract()
      await load(true)
    } catch (e) {
      // Surface the server-enforced partner_insufficient_stock message
      // in a user-legible way (the RPC bound is authoritative).
      const msg = e?.message || String(e)
      if (msg.includes('partner_insufficient_stock')) {
        const m = /has\s+(\d+),\s*needs\s+(\d+)/i.exec(msg)
        const vLabel = VARIANTS[lot.variant]?.short || lot.variant
        setRetractErr(
          m
            ? `Partner has only ${m[1]} × ${vLabel} in hand — cannot retract ${m[2]}.`
            : `Partner does not have enough ${vLabel} in hand.`,
        )
      } else if (e?.code === '42501' || msg.includes('Not authorized')) {
        setRetractErr('Not authorized to retract from this partner.')
      } else {
        setRetractErr(msg)
      }
    } finally {
      setRetractBusy(false)
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
        Row color = fraction of shelf life consumed (MG {shelf.multigrain}d · Plain {shelf.plain}d).
      </p>

      {/* Received by batch — live countdown + per-row Retract CTA (canManage) */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">In hand by batch</h3>
      {fresh.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">No fresh stock in hand.</p>
      ) : (
        <div className="mb-4 space-y-2">
          {fresh.map((h, i) => {
            const lotKey = `${h.batch?.id || 'nobatch'}-${i}`
            const ms = h.batch ? batchMsLeft(h.batch.expiry_at, now) : null
            const info = freshnessInfo(h, shelf, now)
            const showRetract = canManage && !info.isExpired && h.batch != null
            const isOpen = retractOpen === lotKey
            return (
              <div
                key={lotKey}
                className={`rounded-lg border ${info.rowCls} px-3 py-2.5`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">
                      {h.units} × {h.variant_label || VARIANTS[h.variant]?.short || h.variant}
                    </p>
                    <p className="text-xs text-slate-500">
                      {h.batch ? `Batch #${h.batch.batch_number}` : 'No batch · no expiry'}
                      {info.label ? ` · ${info.label}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className={`text-xs font-semibold ${info.textCls}`}>
                      {h.batch ? (fmtBatchLeft(ms) || 'Expired') : '—'}
                    </span>
                    {showRetract && (
                      <button
                        type="button"
                        onClick={() => (isOpen ? closeRetract() : openRetract(lotKey, h))}
                        className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-700"
                      >
                        {isOpen ? 'Close' : 'Retract'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline retract form — reuses retract_from_partner (Phase-3
                    bounded RPC). Cap here is this row's units; the server also
                    enforces the partner's variant-scoped aggregate as the
                    ultimate guard (partner_insufficient_stock). */}
                {isOpen && showRetract && (
                  <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <p className="mb-2 text-[11px] text-slate-500">
                      Retracts {VARIANTS[h.variant]?.short || h.variant} back to the source agent.
                      FIFO across the partner&apos;s {VARIANTS[h.variant]?.short || h.variant} holdings —
                      oldest lot first. Capped at {h.units} for this row; server enforces the aggregate.
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Units</span>
                        <input
                          type="number"
                          min="1"
                          max={h.units}
                          value={retractForm.units}
                          onChange={(e) => setRetractForm((f) => ({ ...f, units: e.target.value }))}
                          className="dashboard-input"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Reason</span>
                        <select
                          value={retractForm.reason}
                          onChange={(e) => setRetractForm((f) => ({ ...f, reason: e.target.value }))}
                          className="dashboard-select"
                        >
                          {RETRACT_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block sm:col-span-1">
                        <span className="mb-1 block text-[11px] text-slate-400">Notes</span>
                        <input
                          type="text"
                          value={retractForm.notes}
                          onChange={(e) => setRetractForm((f) => ({ ...f, notes: e.target.value }))}
                          className="dashboard-input"
                          placeholder="Optional"
                          maxLength={240}
                        />
                      </label>
                    </div>
                    {retractErr && (
                      <p className="mt-2 text-xs font-semibold text-rose-400">{retractErr}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => submitRetract(h)}
                        disabled={retractBusy}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-[#fbf3d4] hover:bg-amber-500 disabled:opacity-50"
                      >
                        {retractBusy ? '…' : 'Confirm retract'}
                      </button>
                      <button
                        type="button"
                        onClick={closeRetract}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Expired in hand — needs recording. NO Retract CTA here per spec. */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">Expired in hand</h3>
      {expired.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">Nothing expired in hand.</p>
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

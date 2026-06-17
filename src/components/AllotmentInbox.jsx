import { useEffect, useState } from 'react'
import { formatDateTimeDDMMYY } from '../lib/date'
import {
  listExecAllotments,
  acceptAllotment,
  rejectAllotment,
} from '../lib/allot'
import { getBatchFreshnessMap, batchMsLeft, fmtBatchLeft } from '../lib/batches'

// ============================================================================
// AllotmentInbox — an exec's view of stock an admin has allotted to them.
// Pending allotments can be Accepted (credits their inventory ledger, carrying
// the originating batch's expiry clock) or Rejected (returns the units to the
// central pool). Each allotment that carries a batch shows a live countdown so
// the exec can see freshness BEFORE accepting. Past allotments stay listed for
// reference. Allotments with no batch (NULL batch_id) show no countdown.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

const STATUS_META = {
  pending: { label: 'Pending', cls: 'text-amber-400' },
  accepted: { label: 'Accepted', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-rose-400' },
  withdrawn: { label: 'Withdrawn', cls: 'text-orange-400' },
}

function freshnessCls(ms) {
  if (ms == null) return 'text-slate-400'
  if (ms <= 0) return 'text-rose-400'
  if (ms <= 24 * 60 * 60 * 1000) return 'text-amber-400'
  return 'text-emerald-300'
}

export default function AllotmentInbox({ agentId }) {
  const [rows, setRows] = useState([])
  const [batchMap, setBatchMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)
  const [now, setNow] = useState(Date.now())

  const load = async () => {
    setLoading(true)
    try {
      const data = await listExecAllotments(agentId)
      setRows(data)
      const map = await getBatchFreshnessMap(data.map((r) => r.batch_id))
      setBatchMap(map)
    } catch (e) {
      console.warn('listExecAllotments failed:', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  // Live updates: refetch on focus/visibility and a 30s poll while visible, so
  // a new allotment from the admin appears without a manual reload.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const id = setInterval(refresh, 30000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  // Tick `now` every second so batch countdowns update live (no DB calls).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const act = async (id, kind) => {
    setErr(null)
    setBusyId(id)
    try {
      if (kind === 'accept') await acceptAllotment(id)
      else await rejectAllotment(id)
      await load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-400">Loading allotments…</p>
      </div>
    )
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const past = rows.filter((r) => r.status !== 'pending')
  const totalAccepted = rows
    .filter((r) => r.status === 'accepted')
    .reduce((sum, r) => sum + (r.units || 0), 0)
  const totalPending = pending.reduce((sum, r) => sum + (r.units || 0), 0)

  const countdown = (batchId) => {
    const batch = batchId ? batchMap[batchId] : null
    if (!batch) return null
    const ms = batchMsLeft(batch.expiry_at, now)
    return { ms, label: fmtBatchLeft(ms) }
  }

  return (
    <div className={CARD}>
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Allotments from admin</h2>

      {/* Totals header */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-600/40 bg-emerald-500/10 px-4 py-4 text-center">
          <p className="text-xs uppercase tracking-wide text-emerald-300">Total Allotted (accepted)</p>
          <p className="mt-1 font-display text-3xl font-bold text-emerald-300">{totalAccepted}</p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-4 text-center">
          <p className="text-xs uppercase tracking-wide text-amber-300">Pending Incoming</p>
          <p className="mt-1 font-display text-3xl font-bold text-amber-300">{totalPending}</p>
        </div>
      </div>

      {err && <p className="mb-3 text-sm font-semibold text-rose-400">{err}</p>}

      {pending.length === 0 ? (
        <p className="text-sm text-slate-400">No pending allotments.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((a) => {
            const cd = countdown(a.batch_id)
            return (
              <div
                key={a.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">
                    {a.units} × {a.variant_label}
                  </p>
                  {cd && (
                    <span className={`flex-shrink-0 text-sm font-semibold ${freshnessCls(cd.ms)}`}>
                      {cd.label}
                    </span>
                  )}
                </div>
                <p className="mb-2 text-xs text-slate-500">
                  {formatDateTimeDDMMYY(a.allotted_at)} · by {a.allotted_by_name}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => act(a.id, 'accept')}
                    disabled={busyId === a.id}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busyId === a.id ? '…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    onClick={() => act(a.id, 'reject')}
                    disabled={busyId === a.id}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-300">History</h3>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {past.map((a) => {
              const meta = STATUS_META[a.status] || { label: a.status, cls: 'text-slate-300' }
              const cd = a.status === 'accepted' ? countdown(a.batch_id) : null
              return (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">
                      {a.units} × {a.variant_label}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTimeDDMMYY(a.responded_at || a.allotted_at)} · by {a.allotted_by_name}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                    <span className={`text-sm font-semibold ${meta.cls}`}>{meta.label}</span>
                    {cd && (
                      <span className={`text-xs font-medium ${freshnessCls(cd.ms)}`}>{cd.label}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

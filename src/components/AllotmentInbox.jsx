import { useEffect, useState } from 'react'
import { formatDateTimeDDMMYY } from '../lib/date'
import {
  listExecAllotments,
  acceptAllotment,
  rejectAllotment,
} from '../lib/allot'

// ============================================================================
// AllotmentInbox — an exec's view of stock an admin has allotted to them.
// Pending allotments can be Accepted (credits their inventory ledger) or
// Rejected (returns the units to the central pool). Past allotments stay
// listed for reference.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

const STATUS_META = {
  pending: { label: 'Pending', cls: 'text-amber-400' },
  accepted: { label: 'Accepted', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-rose-400' },
}

export default function AllotmentInbox({ agentId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await listExecAllotments(agentId)
      setRows(data)
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

  return (
    <div className={CARD}>
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Allotments from admin</h2>

      {err && <p className="mb-3 text-sm font-semibold text-rose-400">{err}</p>}

      {pending.length === 0 ? (
        <p className="text-sm text-slate-400">No pending allotments.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3"
            >
              <p className="text-sm font-medium text-slate-100">
                {a.units} × {a.variant_label}
              </p>
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
          ))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-300">History</h3>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {past.map((a) => {
              const meta = STATUS_META[a.status] || { label: a.status, cls: 'text-slate-300' }
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
                  <span className={`flex-shrink-0 text-sm font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

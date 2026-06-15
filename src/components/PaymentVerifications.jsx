import { useEffect, useRef, useState } from 'react'
import { formatDateDDMMYY } from '../lib/date'
import {
  listPaymentVerifications,
  verifyPayment,
  rejectPayment,
  getProofSignedUrl,
} from '../lib/payments'

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

/**
 * Admin/sales queue of partner payment-confirmation requests awaiting
 * verification. View the uploaded proof, then Verify (→ paid) or Reject
 * (→ back to pending with an optional reason). RLS returns all open requests
 * to admin/sales only.
 */
export default function PaymentVerifications() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [rejecting, setRejecting] = useState(null) // sale id being rejected
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const mounted = useRef(true)

  const load = async () => {
    try {
      const data = await listPaymentVerifications()
      if (mounted.current) setRows(data)
    } catch (e) {
      console.error('Load payment verifications failed:', e)
      if (mounted.current) setError(e.message || 'Could not load verifications.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false }
  }, [])

  // Live-ish: refresh on focus/visibility + a slow poll.
  useEffect(() => {
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    const id = setInterval(load, 15000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(id)
    }
  }, [])

  const viewProof = async (path) => {
    const url = await getProofSignedUrl(path, 120)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const doVerify = async (saleId) => {
    setError(null)
    setBusyId(saleId)
    try {
      await verifyPayment(saleId)
      await load()
    } catch (e) {
      console.error('Verify payment failed:', e)
      setError(e.message || 'Could not verify payment.')
    } finally {
      setBusyId(null)
    }
  }

  const doReject = async (saleId) => {
    setError(null)
    setBusyId(saleId)
    try {
      await rejectPayment(saleId, reason.trim() || null)
      setRejecting(null)
      setReason('')
      await load()
    } catch (e) {
      console.error('Reject payment failed:', e)
      setError(e.message || 'Could not reject payment.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="dashboard-panel">
        <p className="text-sm text-slate-400">Loading verifications…</p>
      </div>
    )
  }

  return (
    <div className="dashboard-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="dashboard-title text-base">Payment verifications</h3>
        <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs text-slate-300">
          {rows.length} pending
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-700 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No payments awaiting verification.</p>
      ) : (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {rows.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">{c.partner_name}</p>
                  <p className="text-xs text-slate-400">
                    {c.units} × {c.variant_label}
                    {c.requested_at && <> · {formatDateDDMMYY(c.requested_at)}</>}
                    {c.partner_phone && <> · {c.partner_phone}</>}
                  </p>
                </div>
                <p className="font-mono text-sm font-semibold text-amber-300">{inr(c.amount_owed)}</p>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {c.proof_file_path ? (
                  <button
                    type="button"
                    onClick={() => viewProof(c.proof_file_path)}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:border-slate-600"
                  >
                    View proof
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">No proof attached</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setRejecting(rejecting === c.sale_id ? null : c.sale_id); setReason('') }}
                    disabled={busyId === c.sale_id}
                    className="rounded-lg border border-rose-700 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => doVerify(c.sale_id)}
                    disabled={busyId === c.sale_id}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === c.sale_id ? 'Working…' : 'Verify'}
                  </button>
                </div>
              </div>

              {rejecting === c.sale_id && (
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="dashboard-input flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => doReject(c.sale_id)}
                    disabled={busyId === c.sale_id}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

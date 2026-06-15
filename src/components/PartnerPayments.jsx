import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'
import {
  listCreditAssignments,
  summarizePayments,
  uploadPaymentProof,
  requestMarkPaid,
  getProofSignedUrl,
  variantLabelFromSale,
} from '../lib/payments'

const STATUS_META = {
  pending: { label: 'On credit', cls: 'border-amber-700 bg-amber-500/10 text-amber-300' },
  awaiting_verification: { label: 'Awaiting verification', cls: 'border-sky-700 bg-sky-500/10 text-sky-300' },
  paid: { label: 'Paid', cls: 'border-emerald-700 bg-emerald-500/10 text-emerald-300' },
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  )
}

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

/**
 * Partner credit / payments.
 *   mode='partner' (default): the partner's OWN view — they can upload a proof
 *     and request "Mark as paid" on each pending credit assignment.
 *   mode='admin': read-only view of a partner's credit ledger (admin/sales
 *     partner-profile surface). Verification itself lives on /admin/payments.
 */
export default function PartnerPayments({ partnerId, mode = 'partner' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [files, setFiles] = useState({}) // saleId -> File
  const [error, setError] = useState(null)
  const mounted = useRef(true)

  const load = async () => {
    if (!partnerId) return
    try {
      const data = await listCreditAssignments({ partnerId })
      if (mounted.current) setRows(data)
    } catch (e) {
      console.error('Load credit assignments failed:', e)
      if (mounted.current) setError(e.message || 'Could not load payments.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId])

  // Live-ish: refresh on focus/visibility + a slow poll so a verification by
  // the salesperson shows up without a manual reload.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId])

  const totals = useMemo(() => summarizePayments(rows), [rows])

  const viewProof = async (path) => {
    const url = await getProofSignedUrl(path, 120)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const submit = async (sale) => {
    setError(null)
    setBusyId(sale.id)
    try {
      let proofPath = null
      const file = files[sale.id]
      if (file) proofPath = await uploadPaymentProof(partnerId, file)
      await requestMarkPaid(sale.id, proofPath)
      setFiles((f) => ({ ...f, [sale.id]: undefined }))
      await load()
    } catch (e) {
      console.error('Request mark-paid failed:', e)
      setError(e.message || 'Could not submit payment.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="dashboard-panel">
        <p className="text-sm text-slate-400">Loading payments…</p>
      </div>
    )
  }

  return (
    <div className="dashboard-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="dashboard-title text-base">Payments &amp; credit</h3>
      </div>

      {/* Owed summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-slate-400">Owed to company</p>
          <p className="font-mono text-lg font-semibold text-amber-300">{inr(totals.owedOutstanding)}</p>
        </div>
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2">
          <p className="text-xs text-slate-400">Awaiting verification</p>
          <p className="font-mono text-lg font-semibold text-sky-300">{inr(totals.owedAwaiting)}</p>
        </div>
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
          <p className="text-xs text-slate-400">Settled (paid)</p>
          <p className="font-mono text-lg font-semibold text-emerald-300">{inr(totals.owedPaid)}</p>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-700 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No credit assignments yet.</p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {rows.map((sale) => {
            const owed = Number(sale.amount_owed) || 0
            const isPending = sale.payment_status === 'pending'
            const canAct = mode === 'partner' && isPending
            return (
              <div key={sale.id} className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">
                      {sale.units_assigned} × {variantLabelFromSale(sale)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {sale.date_of_assignment ? formatDateDDMMYY(sale.date_of_assignment) : '—'}
                      {sale.margin_percent != null && <> · margin {Number(sale.margin_percent)}%</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold text-slate-100">{inr(owed)}</p>
                    <div className="mt-1"><StatusPill status={sale.payment_status} /></div>
                  </div>
                </div>

                {canAct && (
                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex-1 cursor-pointer rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-300 hover:border-slate-600">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => setFiles((f) => ({ ...f, [sale.id]: e.target.files?.[0] || undefined }))}
                      />
                      {files[sale.id] ? `Proof: ${files[sale.id].name}` : 'Attach payment proof (optional)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => submit(sale)}
                      disabled={busyId === sale.id}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === sale.id ? 'Submitting…' : 'Mark as paid'}
                    </button>
                  </div>
                )}

                {mode === 'admin' && sale.payment_status === 'awaiting_verification' && (
                  <p className="mt-1.5 text-xs text-sky-300">Partner submitted proof — pending verification.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { StatusPill as PaymentStatusPill }

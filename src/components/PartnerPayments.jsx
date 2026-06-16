import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ChevronDown, Upload, X } from 'lucide-react'
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
import EarningsCalculator from './EarningsCalculator'

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
  const [expandedId, setExpandedId] = useState(null) // which pending row is open
  const [error, setError] = useState(null)
  const [margins, setMargins] = useState(null) // partner-mode: own margins + payout
  const mounted = useRef(true)

  // Attach a proof file to a row (shared by picker / camera / drag-drop / paste).
  const attachFile = (saleId, file) => {
    if (!file) return
    setFiles((f) => ({ ...f, [saleId]: file }))
    setError(null)
  }
  const clearFile = (saleId) =>
    setFiles((f) => ({ ...f, [saleId]: undefined }))

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
    if (mode === 'partner' && partnerId) {
      supabase
        .from('profiles')
        .select('margin_percent, margin_percent_multigrain, margin_percent_plain, payout_days')
        .eq('id', partnerId)
        .maybeSingle()
        .then(({ data }) => { if (mounted.current && data) setMargins(data) })
    }
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, mode])

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

  // Paste-to-attach: while a row's upload zone is open, a pasted image (e.g. a
  // screenshot from the clipboard) is attached as that row's proof.
  useEffect(() => {
    if (!expandedId) return
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) =>
        i.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (file) {
        e.preventDefault()
        attachFile(expandedId, file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId])

  const totals = useMemo(() => summarizePayments(rows), [rows])

  const viewProof = async (path) => {
    const url = await getProofSignedUrl(path, 120)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const submit = async (sale) => {
    const file = files[sale.id]
    if (!file) {
      setError('Please attach a photo of your payment proof first.')
      return
    }
    setError(null)
    setBusyId(sale.id)
    try {
      const proofPath = await uploadPaymentProof(partnerId, file)
      await requestMarkPaid(sale.id, proofPath)
      setFiles((f) => ({ ...f, [sale.id]: undefined }))
      setExpandedId(null)
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
        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {rows.map((sale) => {
            const owed = Number(sale.amount_owed) || 0
            const isPending = sale.payment_status === 'pending'
            const canAct = mode === 'partner' && isPending
            const isOpen = expandedId === sale.id
            const file = files[sale.id]
            return (
              <div key={sale.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-800/40">
                {/* Tappable header row */}
                <button
                  type="button"
                  onClick={() => canAct && setExpandedId(isOpen ? null : sale.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left ${
                    canAct ? 'active:bg-slate-800/70' : 'cursor-default'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {sale.units_assigned} × {variantLabelFromSale(sale)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Received {sale.date_of_assignment ? formatDateDDMMYY(sale.date_of_assignment) : '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={sale.payment_status} />
                    {canAct && (
                      <ChevronDown
                        size={16}
                        className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    )}
                  </div>
                </button>

                {/* Expanded proof-upload zone (pending + partner only) */}
                {canAct && isOpen && (
                  <div className="border-t border-slate-800 px-3.5 pb-3.5 pt-3">
                    <p className="mb-2 text-xs text-slate-400">
                      Upload a photo of your payment proof to mark this as paid. It will go to
                      your salesperson for verification.
                    </p>

                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        attachFile(sale.id, e.dataTransfer.files?.[0])
                      }}
                      className={`rounded-xl border-2 border-dashed px-3 py-4 text-center ${
                        file ? 'border-emerald-600/60 bg-emerald-500/5' : 'border-slate-700 bg-slate-900/40'
                      }`}
                    >
                      {file ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-emerald-300">
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => clearFile(sale.id)}
                            className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                            aria-label="Remove file"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Drag &amp; drop, paste a screenshot, or use a button below
                        </p>
                      )}
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
                        <Upload size={14} />
                        Choose file
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => attachFile(sale.id, e.target.files?.[0])}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
                        <Camera size={14} />
                        Take photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => attachFile(sale.id, e.target.files?.[0])}
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => submit(sale)}
                      disabled={!file || busyId === sale.id}
                      className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === sale.id ? 'Submitting…' : 'Submit for verification'}
                    </button>
                  </div>
                )}

                {mode === 'admin' && sale.payment_status === 'awaiting_verification' && (
                  <p className="border-t border-slate-800 px-3.5 py-2 text-xs text-sky-300">
                    Partner submitted proof — pending verification.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mode === 'partner' && (() => {
        const mg = margins?.margin_percent_multigrain ?? margins?.margin_percent
        const pl = margins?.margin_percent_plain ?? margins?.margin_percent
        return (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your earnings</h4>
              <span className="text-xs text-slate-400">
                Multi-Grain {mg == null ? '—' : `${Number(mg)}%`} · Plain {pl == null ? '—' : `${Number(pl)}%`}
                {margins?.payout_days != null && <> · payout every {Number(margins.payout_days)} days</>}
              </span>
            </div>
            <EarningsCalculator partnerId={partnerId} payoutDays={margins?.payout_days} scope="partner" />
          </div>
        )
      })()}
    </div>
  )
}

export { StatusPill as PaymentStatusPill }

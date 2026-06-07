import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { formatDateDDMMYY } from '../lib/date'
import UnitWheel from '../components/UnitWheel'
import {
  WORKFLOW_VARIANT_OPTIONS,
  variantLabel,
  createRequest,
  listMyRequests,
} from '../lib/partnerWorkflow'

const STATUS_PILL = {
  pending:   { label: 'Pending',   cls: 'bg-amber-400/15 text-amber-700 border border-amber-400/30' },
  accepted:  { label: 'Accepted',  cls: 'bg-indigo-100 text-indigo-200 border border-indigo-300/30' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30' },
}

export default function PartnerRequests() {
  const { profile, isDemo } = useAuth()
  const partnerId = profile?.id

  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [variant, setVariant] = useState('multigrain')
  const [units, setUnits] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)

  const load = async () => {
    if (isDemo || !partnerId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const rows = await listMyRequests(partnerId)
      setRequests(rows)
    } catch (err) {
      console.warn('listMyRequests failed:', err.message)
      setError('Could not load your requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, isDemo])

  const unitsNum = parseInt(units, 10) || 0
  const canSubmit = !!variant && unitsNum >= 1 && !submitting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await createRequest({ partnerId, variant, units: unitsNum })
      setUnits('')
      setVariant('multigrain')
      setFormOpen(false)
      setToast('Request submitted')
      setTimeout(() => setToast(null), 2500)
      await load()
    } catch (err) {
      console.error('createRequest failed:', err)
      setToast(err.message || 'Could not submit request')
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dashboard-page pb-24 sm:pb-8">
      {toast && (
        <div className="fixed bottom-24 right-4 z-[60] rounded-lg bg-[#024628] px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] shadow-lg md:bottom-6">
          {toast}
        </div>
      )}

      <div className="relative z-10 mb-4 flex items-start justify-between gap-4">
        <div>
          <span className="dashboard-kicker">Partner</span>
          <h1 className="dashboard-title mt-2">Request Stock</h1>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#024628] px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] shadow-sm transition hover:bg-[#035c36]"
        >
          {formOpen ? <X size={16} /> : <Plus size={16} />}
          {formOpen ? 'Cancel' : 'New Request'}
        </button>
      </div>

      {isDemo && (
        <div className="mb-4 rounded-[16px] border border-amber-300/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-700">
          Demo mode — requests are read-only here.
        </div>
      )}

      {formOpen && (
        <form onSubmit={submit} className="dashboard-panel mb-5 rounded-2xl p-4">
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-slate-300">Variant</label>
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              className="dashboard-select"
            >
              {WORKFLOW_VARIANT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <UnitWheel
              label="Units"
              value={parseInt(units) || 0}
              max={100}
              onChange={(n) => setUnits(n)}
            />
          </div>
          <button
            type="submit"
            disabled={!canSubmit || isDemo}
            className="w-full rounded-xl bg-[#024628] px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">My requests</h2>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-rose-300">{error}</div>
      ) : requests.length === 0 ? (
        <div className="dashboard-subpanel rounded-[20px] px-5 py-8 text-center text-sm text-slate-400">
          No requests yet. Tap “New Request” to ask for stock.
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const pill = STATUS_PILL[r.displayStatus] || STATUS_PILL.pending
            return (
              <div key={r.id} className="dashboard-panel flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100">
                    {r.units_requested} × {variantLabel(r.variant)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Requested {formatDateDDMMYY(r.created_at)}
                    {r.displayStatus === 'delivered' && r.assignment?.confirmed_at
                      ? ` · Delivered ${formatDateDDMMYY(r.assignment.confirmed_at)}`
                      : ''}
                  </p>
                </div>
                <span className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${pill.cls}`}>
                  {pill.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

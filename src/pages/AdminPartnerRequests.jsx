import { useEffect, useState } from 'react'
import { Check, Package, Truck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { formatDateDDMMYY } from '../lib/date'
import {
  variantLabel,
  listPendingRequests,
  listSupply,
  listSalespeople,
  listAllAssignments,
  acceptRequest,
  createAssignment,
  confirmAssignment,
} from '../lib/partnerWorkflow'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return formatDateDDMMYY(dateStr)
}

export default function AdminPartnerRequests({ embedded = false }) {
  const { profile, isAdmin, isDemo } = useAuth()
  const [tab, setTab] = useState('request')
  const [pending, setPending] = useState([])
  const [supply, setSupply] = useState([])
  const [tracking, setTracking] = useState([])
  const [salespeople, setSalespeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null)

  // Admin-only salesperson picker (when accepting a request).
  const [pickerReq, setPickerReq] = useState(null)
  const [pickedSalesperson, setPickedSalesperson] = useState('')

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  const load = async () => {
    if (isDemo) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [p, s] = await Promise.all([listPendingRequests(), listSupply()])
      setPending(p)
      setSupply(s)
      if (isAdmin) {
        try { setSalespeople(await listSalespeople()) } catch { /* picker optional */ }
        try { setTracking(await listAllAssignments()) } catch { /* tracking optional */ }
      }
    } catch (err) {
      console.warn('Partner requests load failed:', err.message)
      setError('Could not load partner requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, isAdmin])

  // --- Accept -------------------------------------------------------------
  // Accepting now ALSO credits the partner immediately: it flips the request to
  // 'accepted' AND creates the partner_assignment (the same record the Supply
  // "Assign" step used to create), so the partner's Home — big Available number
  // and the per-variant Assigned/Left + day-cards — reflects the units right
  // away (per variant) without a manual reload. Because the assignment now
  // exists at accept time, the Supply tab skips straight to the Confirm step, so
  // no second assignment is ever created (no double counting). This stays within
  // partner_assignments and never writes sales, so Overview ASSIGNED is untouched.
  const doAccept = async (req, salespersonId) => {
    setBusyId(req.id)
    try {
      await acceptRequest({ requestId: req.id, salespersonId })
      await createAssignment({
        partnerId: req.partner_id,
        salespersonId,
        variant: req.variant,
        units: req.units_requested,
        sourceRequestId: req.id,
        assignedBy: profile.id,
      })
      showToast('Request accepted — units credited')
      await load()
    } catch (err) {
      console.error('acceptRequest failed:', err)
      showToast(err.message || 'Could not accept')
    } finally {
      setBusyId(null)
      setPickerReq(null)
      setPickedSalesperson('')
    }
  }

  const onAcceptClick = (req) => {
    if (isAdmin) {
      setPickerReq(req)
      setPickedSalesperson('')
    } else {
      doAccept(req, profile.id) // sales accepts as themselves
    }
  }

  // --- Assign (Supply) ----------------------------------------------------
  const doAssign = async (row) => {
    setBusyId(row.id)
    try {
      await createAssignment({
        partnerId: row.partner_id,
        salespersonId: row.accepted_by, // responsible salesperson set at accept
        variant: row.variant,
        units: row.units_requested,
        sourceRequestId: row.id,
        assignedBy: profile.id,
      })
      showToast('Assignment created')
      await load()
    } catch (err) {
      console.error('createAssignment failed:', err)
      showToast(err.message || 'Could not assign')
    } finally {
      setBusyId(null)
    }
  }

  const doConfirm = async (assignment) => {
    setBusyId(assignment.id)
    try {
      await confirmAssignment({ assignmentId: assignment.id, confirmedBy: profile.id })
      showToast('Delivery confirmed')
      await load()
    } catch (err) {
      console.error('confirmAssignment failed:', err)
      showToast(err.message || 'Could not confirm')
    } finally {
      setBusyId(null)
    }
  }

  const TabBtn = ({ id, label, count }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
        tab === id
          ? 'bg-[#024628] text-[#fbf3d4]'
          : 'bg-[#F0EBE3] text-slate-300 hover:bg-[#E8E0D4]'
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`rounded-full px-1.5 text-[11px] font-bold ${tab === id ? 'bg-[#fbf3d4] text-[#024628]' : 'bg-[#024628] text-[#fbf3d4]'}`}>
          {count}
        </span>
      )}
    </button>
  )

  return (
    <div className={embedded ? '' : 'dashboard-page pb-24 sm:pb-8'}>
      {toast && (
        <div className="fixed bottom-24 right-4 z-[60] rounded-lg bg-[#024628] px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] shadow-lg md:bottom-6">
          {toast}
        </div>
      )}

      {!embedded && (
        <div className="relative z-10 mb-4">
          <span className="dashboard-kicker">Operations</span>
          <h1 className="dashboard-title mt-2">Partner Requests</h1>
        </div>
      )}

      {isDemo && (
        <div className="mb-4 rounded-[16px] border border-amber-300/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-700">
          Demo mode — partner requests are read-only here.
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <TabBtn id="request" label="Request" count={pending.length} />
        <TabBtn id="supply" label="Supply" count={supply.filter((s) => s.assignment && s.assignment.status === 'pending').length} />
        {isAdmin && <TabBtn id="tracking" label="Tracking" count={0} />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-rose-300">{error}</div>
      ) : tab === 'tracking' ? (
        tracking.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-8 text-center text-sm text-slate-400">
            No assignments yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead>
                <tr>
                  <Th>Partner</Th><Th>Salesperson</Th><Th>Variant</Th><Th right>Units</Th>
                  <Th>Requested</Th><Th>Accepted</Th><Th>Assigned</Th><Th>Delivered</Th>
                </tr>
              </thead>
              <tbody>
                {tracking.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-semibold text-slate-100">{a.partner_name}</td>
                    <td className="px-3 py-2 text-slate-300">{a.salesperson_name}</td>
                    <td className="px-3 py-2 text-slate-300">{variantLabel(a.variant)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-indigo-200">{a.units}</td>
                    <td className="px-3 py-2 text-slate-400">{a.requested_at ? formatDateDDMMYY(a.requested_at) : '—'}</td>
                    <td className="px-3 py-2 text-slate-400" title={a.accepted_by_name ? `by ${a.accepted_by_name}` : ''}>{a.accepted_at ? formatDateDDMMYY(a.accepted_at) : '—'}</td>
                    <td className="px-3 py-2 text-slate-400" title={a.assigned_by_name ? `by ${a.assigned_by_name}` : ''}>{a.assigned_at ? formatDateDDMMYY(a.assigned_at) : '—'}</td>
                    <td className="px-3 py-2" title={a.confirmed_by_name ? `by ${a.confirmed_by_name}` : ''}>
                      {a.status === 'confirmed'
                        ? <span className="font-semibold text-emerald-200">{a.confirmed_at ? formatDateDDMMYY(a.confirmed_at) : 'Yes'}</span>
                        : <span className="text-amber-700">Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'request' ? (
        pending.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-8 text-center text-sm text-slate-400">
            No pending requests.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="dashboard-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100">{r.partner_name}</p>
                  <p className="mt-0.5 text-sm text-slate-300">
                    {r.units_requested} × {variantLabel(r.variant)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{timeAgo(r.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onAcceptClick(r)}
                  disabled={busyId === r.id || isDemo}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:opacity-50"
                >
                  <Check size={15} />
                  {busyId === r.id ? 'Accepting…' : 'Accept'}
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        supply.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-8 text-center text-sm text-slate-400">
            Nothing to supply yet.
          </div>
        ) : (
          <div className="space-y-2">
            {supply.map((row) => {
              const asg = row.assignment
              return (
                <div key={row.id} className="dashboard-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-100">{row.partner_name}</p>
                    <p className="mt-0.5 text-sm text-slate-300">
                      {row.units_requested} × {variantLabel(row.variant)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Salesperson: {row.salesperson_name} · accepted {timeAgo(row.accepted_at)}
                    </p>
                  </div>
                  {!asg ? (
                    <button
                      type="button"
                      onClick={() => doAssign(row)}
                      disabled={busyId === row.id || isDemo}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:opacity-50"
                    >
                      <Package size={15} />
                      {busyId === row.id ? 'Assigning…' : 'Assign'}
                    </button>
                  ) : asg.status === 'pending' ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-3 py-1 text-[11px] font-semibold text-amber-700">
                        Pending delivery
                      </span>
                      <button
                        type="button"
                        onClick={() => doConfirm(asg)}
                        disabled={busyId === asg.id || isDemo}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#024628] px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:opacity-50"
                      >
                        <Truck size={15} />
                        {busyId === asg.id ? 'Confirming…' : 'Confirm'}
                      </button>
                    </div>
                  ) : (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold text-emerald-200">
                      Delivered {asg.confirmed_at ? formatDateDDMMYY(asg.confirmed_at) : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Admin salesperson picker (accept) */}
      <Modal isOpen={!!pickerReq} onClose={() => setPickerReq(null)} title="Assign to salesperson">
        {pickerReq && (
          <div>
            <p className="mb-3 text-sm text-slate-300">
              Accepting <span className="font-semibold text-slate-100">{pickerReq.partner_name}</span>’s
              request for {pickerReq.units_requested} × {variantLabel(pickerReq.variant)}.
            </p>
            <label className="mb-1 block text-xs font-semibold text-slate-300">Salesperson</label>
            <select
              value={pickedSalesperson}
              onChange={(e) => setPickedSalesperson(e.target.value)}
              className="dashboard-select mb-4"
            >
              <option value="">Select salesperson</option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.phone || s.id}{s.role === 'admin' ? ' (admin)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!pickedSalesperson || busyId === pickerReq.id}
              onClick={() => doAccept(pickerReq, pickedSalesperson)}
              className="w-full rounded-xl bg-[#024628] px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] transition hover:bg-[#035c36] disabled:opacity-50"
            >
              {busyId === pickerReq.id ? 'Accepting…' : 'Accept & assign'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Th({ children, right }) {
  return (
    <th className={`border-b border-[#E8E0D4] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

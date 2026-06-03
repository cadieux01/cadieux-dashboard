import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { changePassword, changePhone } from '../lib/adminApi'
import { fetchManagedRequests, REQUEST_TYPE_LABELS } from '../lib/changeRequests'
import Modal from '../components/Modal'
import AlertBanner from '../components/AlertBanner'
import DEMO_DATA, { demoBlock } from '../lib/demoData'

// Approval queue for profile change requests.
//   • Admin  → manages ALL requests (sales + partner), with a role filter.
//   • Sales  → manages PARTNER requests only (RLS already scopes the rows;
//              the UI hides the role filter and labels the page accordingly).

function StatusBadge({ status }) {
  const s = (status || 'pending').toLowerCase()
  const map = {
    pending: 'border-amber-700 bg-amber-500/10 text-amber-400',
    approved: 'border-emerald-700 bg-emerald-500/10 text-emerald-400',
    rejected: 'border-rose-700 bg-rose-500/10 text-rose-400',
  }
  const cls = map[s] || 'border-slate-700 bg-slate-800 text-slate-400'
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${cls}`}>
      {s}
    </span>
  )
}

export default function ChangeRequests() {
  const { profile, isAdmin, isDemo } = useAuth()

  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [statusFilter, setStatusFilter] = useState('pending')
  const [roleFilter, setRoleFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Reject modal (captures a reason) and password-approve modal.
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [pwTarget, setPwTarget] = useState(null)
  const [pwValue, setPwValue] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')

  const title = isAdmin ? 'Change Requests' : 'Partner Requests'

  const load = async () => {
    if (isDemo) {
      setRequests(DEMO_DATA.changeRequests)
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const rows = await fetchManagedRequests()
      setRequests(rows)
    } catch (e) {
      console.error('Failed to load change requests:', e)
      setBanner({ type: 'error', title: 'Failed to load requests', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (isAdmin && roleFilter !== 'all' && r.requester_role !== roleFilter) return false
      if (q && !(r.requester_name || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [requests, statusFilter, roleFilter, search, isAdmin])

  const markReviewed = async (request, status, notes) => {
    const { error } = await supabase
      .from('profile_change_requests')
      .update({
        status,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        reviewer_notes: notes ?? null,
      })
      .eq('id', request.id)
    if (error) throw error
  }

  // Apply the actual profile change, then mark the request approved.
  const performApprove = async (request, newPassword) => {
    if (isDemo) return demoBlock()
    setBusyId(request.id)
    setBanner(null)
    try {
      if (request.request_type === 'name') {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: request.requested_value })
          .eq('id', request.requester_id)
        if (error) throw error
      } else if (request.request_type === 'phone') {
        await changePhone({
          userId: request.requester_id,
          oldPhone: request.current_value,
          newPhone: request.requested_value,
        })
      } else if (request.request_type === 'password') {
        await changePassword(request.requester_id, newPassword)
      }

      await markReviewed(request, 'approved', null)

      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: request.requester_id,
        category: 'user',
        description: `Approved ${request.request_type} change request for ${request.requester_name} (${request.requester_role})`,
        oldValues: { [request.request_type]: request.current_value },
        newValues:
          request.request_type === 'password'
            ? { password: 'reset' }
            : { [request.request_type]: request.requested_value },
      })

      setBanner({
        type: 'success',
        title: 'Request approved',
        message: `${REQUEST_TYPE_LABELS[request.request_type]} change for ${request.requester_name} applied.`,
      })
      await load()
    } catch (e) {
      console.error('Approve failed:', e)
      setBanner({ type: 'error', title: 'Failed to approve', message: e.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleApprove = (request) => {
    if (request.request_type === 'password') {
      // Plaintext was never stored — the approver sets a new password now.
      setPwValue('')
      setPwConfirm('')
      setPwTarget(request)
      return
    }
    performApprove(request, null)
  }

  const handlePasswordApproveSubmit = async (e) => {
    e.preventDefault()
    if (!pwValue || pwValue.length < 6) {
      setBanner({ type: 'warning', title: 'Password too short', message: 'Minimum 6 characters.' })
      return
    }
    if (pwValue !== pwConfirm) {
      setBanner({ type: 'warning', title: 'Passwords do not match', message: 'Re-enter the new password.' })
      return
    }
    const target = pwTarget
    setPwTarget(null)
    await performApprove(target, pwValue)
  }

  const handleRejectSubmit = async (e) => {
    e.preventDefault()
    if (isDemo) return demoBlock()
    const target = rejectTarget
    setBusyId(target.id)
    setBanner(null)
    try {
      await markReviewed(target, 'rejected', rejectReason.trim() || null)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: target.requester_id,
        category: 'user',
        description: `Rejected ${target.request_type} change request for ${target.requester_name} (${target.requester_role})`,
        metadata: { reason: rejectReason.trim() || null },
      })
      setBanner({ type: 'success', title: 'Request rejected', message: `Request from ${target.requester_name} was rejected.` })
      setRejectTarget(null)
      setRejectReason('')
      await load()
    } catch (err) {
      console.error('Reject failed:', err)
      setBanner({ type: 'error', title: 'Failed to reject', message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const valueCell = (r, which) => {
    if (r.request_type === 'password') return which === 'requested' ? '••••••' : '••••••'
    return (which === 'requested' ? r.requested_value : r.current_value) || '—'
  }

  const rowActions = (r) => {
    if (r.status !== 'pending') {
      return <span className="text-xs text-slate-500">{r.reviewed_at ? formatDateDDMMYY(r.reviewed_at) : '—'}</span>
    }
    const busy = busyId === r.id
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => handleApprove(r)}
          disabled={busy}
          className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {busy ? '...' : 'Approve'}
        </button>
        <button
          onClick={() => { setRejectReason(''); setRejectTarget(r) }}
          disabled={busy}
          className="rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">{title}</h1>
        <p className="text-slate-400">
          {isAdmin
            ? 'Review and approve name, phone, and password change requests.'
            : 'Review and approve change requests from your partners.'}
        </p>
      </div>

      {banner && (
        <div className="mb-6">
          <AlertBanner
            type={banner.type}
            title={banner.title}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="dashboard-select max-w-[180px]"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          {isAdmin && (
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="dashboard-select max-w-[180px]"
            >
              <option value="all">All Roles</option>
              <option value="sales">Sales</option>
              <option value="partner">Partner</option>
            </select>
          )}

          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by requester name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="dashboard-input w-full"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Requests</h3>
          <span className="text-sm text-slate-500">
            {filtered.length} request{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Requester</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Current</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Requested</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-4 text-sm font-medium text-white">{r.requester_name || '—'}</td>
                  <td className="px-4 py-4 text-sm capitalize text-slate-300">{r.requester_role}</td>
                  <td className="px-4 py-4 text-sm text-slate-300">{REQUEST_TYPE_LABELS[r.request_type] || r.request_type}</td>
                  <td className="px-4 py-4 text-sm text-slate-400">{valueCell(r, 'current')}</td>
                  <td className="px-4 py-4 text-sm text-slate-300">{valueCell(r, 'requested')}</td>
                  <td className="px-4 py-4"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-4 text-sm text-slate-400">{formatDateDDMMYY(r.created_at)}</td>
                  <td className="px-4 py-4 text-right">{rowActions(r)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-6 py-8 text-center text-slate-500">
                    No requests found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject reason modal */}
      <Modal isOpen={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Request">
        <form onSubmit={handleRejectSubmit}>
          <p className="mb-4 text-sm text-slate-400">
            Rejecting {REQUEST_TYPE_LABELS[rejectTarget?.request_type] || ''} change for{' '}
            <span className="text-white">{rejectTarget?.requester_name}</span>.
          </p>
          <label className="mb-2 block text-sm font-semibold text-slate-300">Reason (optional)</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Why is this request being rejected?"
            className="dashboard-textarea"
          />
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyId === rejectTarget?.id}
              className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {busyId === rejectTarget?.id ? 'Rejecting...' : 'Reject Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Password-approve modal — approver sets the new password */}
      <Modal isOpen={!!pwTarget} onClose={() => setPwTarget(null)} title="Set New Password">
        <form onSubmit={handlePasswordApproveSubmit}>
          <p className="mb-4 text-sm text-slate-400">
            Set a new password for <span className="text-white">{pwTarget?.requester_name}</span>.
            Share it with them securely.
          </p>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-300">New Password</label>
            <input
              type="password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              className="dashboard-input"
            />
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-300">Confirm Password</label>
            <input
              type="password"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              placeholder="Re-enter new password"
              minLength={6}
              className="dashboard-input"
            />
          </div>
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setPwTarget(null)}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
            >
              Approve &amp; Set Password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { displayLogin, displayName, isAdminAccount } from '../lib/phone'
import { formatDateDDMMYY } from '../lib/date'
import {
  submitChangeRequest,
  fetchMyRequests,
  isNameTaken,
  PASSWORD_PLACEHOLDER,
  REQUEST_TYPE_LABELS,
} from '../lib/changeRequests'
import { demoBlock } from '../lib/demoData'
import {
  variantLabel,
  listSalespersonAssignments,
  confirmAssignment,
} from '../lib/partnerWorkflow'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import AgentUnits from '../components/AgentUnits'
import AllotmentInbox from '../components/AllotmentInbox'
import useRefreshable from '../lib/useRefreshable'
import { isPinSet, setPin, changePin, removePin, PIN_LENGTH } from '../lib/pinSecurity'

// Self-service profile page for ALL roles. Name / phone / password can't
// be edited directly — each change is filed as a request for an admin (or,
// for partners, a sales exec) to approve. Role and status are read-only.

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6'

function profilePhone(profile) {
  if (!profile) return ''
  return profile.phone || profile.phone_number || displayLogin(profile.email) || ''
}

function StatusBadge({ status }) {
  const s = (status || 'pending').toLowerCase()
  const map = {
    pending: 'border-amber-700 bg-amber-500/10 text-amber-400',
    approved: 'border-emerald-700 bg-emerald-500/10 text-emerald-400',
    rejected: 'border-rose-700 bg-rose-500/10 text-rose-400',
    active: 'border-emerald-700 bg-emerald-500/10 text-emerald-400',
    inactive: 'border-amber-700 bg-amber-500/10 text-amber-400',
  }
  const cls = map[s] || 'border-slate-700 bg-slate-800 text-slate-400'
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${cls}`}>
      {s}
    </span>
  )
}

export default function Profile() {
  const { profile, isDemo } = useAuth()

  const [requests, setRequests] = useState([])
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [toast, setToast] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Which inline editor is open: 'name' | 'phone' | 'password' | 'email' | null.
  const [editing, setEditing] = useState(null)
  const [nameValue, setNameValue] = useState('')
  const [phoneValue, setPhoneValue] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailValue, setEmailValue] = useState('')

  const loadRequests = async () => {
    if (!profile?.id) return
    if (isDemo) {
      setRequests([])
      setLoadingRequests(false)
      return
    }
    try {
      setLoadingRequests(true)
      const rows = await fetchMyRequests(profile.id)
      setRequests(rows)
    } catch (e) {
      console.error('Failed to load change requests:', e)
      setError(e.message)
    } finally {
      setLoadingRequests(false)
    }
  }

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => loadRequests())

  useEffect(() => {
    loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  const closeEditor = () => {
    setEditing(null)
    setNameValue('')
    setPhoneValue('')
    setNewPassword('')
    setConfirmPassword('')
    setEmailValue('')
    setError(null)
  }

  const submit = async (requestType, currentValue, requestedValue) => {
    if (isDemo) return demoBlock()
    setError(null)
    setSubmitting(true)
    try {
      await submitChangeRequest({
        profile,
        requestType,
        currentValue,
        requestedValue,
      })
      closeEditor()
      await loadRequests()
      showToast('Change request submitted. Waiting for approval.')
    } catch (e) {
      console.error('Failed to submit change request:', e)
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNameSubmit = async (e) => {
    e.preventDefault()
    const next = nameValue.trim()
    if (!next) {
      setError('Please enter a new name.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      if (await isNameTaken(next, profile?.id)) {
        setError('That name is already taken. Please choose a different name.')
        setSubmitting(false)
        return
      }
    } catch {
      setError('Could not verify the name right now. Please try again.')
      setSubmitting(false)
      return
    }
    submit('name', profile?.full_name || '', next)
  }

  const handlePhoneSubmit = (e) => {
    e.preventDefault()
    const next = phoneValue.trim()
    if (!next) {
      setError('Please enter a new phone number.')
      return
    }
    submit('phone', profilePhone(profile), next)
  }

  const handleEmailSubmit = (e) => {
    e.preventDefault()
    const next = emailValue.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setError('Please enter a valid email address.')
      return
    }
    submit('email', profile?.email || null, next)
  }

  const handlePasswordSubmit = (e) => {
    e.preventDefault()
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    // Never store the plaintext password in the request row — only a
    // placeholder. The approver sets the real password at approval time.
    submit('password', null, PASSWORD_PLACEHOLDER)
  }

  if (!profile) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Green success toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 rounded-xl border border-emerald-600 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300 shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">My Profile</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Request changes to your name, phone, or password. Changes take effect after approval.
          </p>
        </div>
        <RefreshButton onRefresh={refresh} loading={refreshing} />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-700 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Current details */}
      <div className={`${CARD} mb-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Current Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Name */}
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Name</label>
            {editing === 'name' ? (
              <form onSubmit={handleNameSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder="New name"
                  className="dashboard-input flex-1"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {submitting ? '...' : 'Submit Request'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="text-base text-slate-100">{isAdminAccount(profile) ? 'Admin' : (displayName(profile) || '—')}</p>
                <button
                  onClick={() => { closeEditor(); setEditing('name'); setNameValue(profile.full_name || '') }}
                  className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/30"
                >
                  Change Name
                </button>
              </div>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Phone Number</label>
            {editing === 'phone' ? (
              <form onSubmit={handlePhoneSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="tel"
                  value={phoneValue}
                  onChange={(e) => setPhoneValue(e.target.value)}
                  placeholder="New 10-digit phone"
                  className="dashboard-input flex-1"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {submitting ? '...' : 'Submit Request'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="text-base text-slate-100">{profilePhone(profile) || '—'}</p>
                <button
                  onClick={() => { closeEditor(); setEditing('phone'); setPhoneValue(profilePhone(profile)) }}
                  className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/30"
                >
                  Change Phone Number
                </button>
              </div>
            )}
          </div>

          {/* Login Email — admin only (sales/partner log in by phone) */}
          {profile.role === 'admin' && (
            <div className="sm:col-span-2">
              <label className="text-xs sm:text-sm font-medium text-slate-400">Login Email</label>
              {editing === 'email' ? (
                <form onSubmit={handleEmailSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    placeholder="new-email@example.com"
                    className="dashboard-input flex-1"
                    autoFocus
                    autoComplete="email"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {submitting ? '...' : 'Submit Request'}
                    </button>
                    <button
                      type="button"
                      onClick={closeEditor}
                      className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="break-all text-base text-slate-100">{profile.email || '—'}</p>
                  <button
                    onClick={() => { closeEditor(); setEditing('email'); setEmailValue(profile.email || '') }}
                    className="flex-shrink-0 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/30"
                  >
                    Change Email
                  </button>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">
                The new email applies once an approver confirms the request.
              </p>
            </div>
          )}

          {/* Role (read-only) */}
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Role</label>
            <p className="mt-1 text-base capitalize text-slate-100">{profile.role || '—'}</p>
          </div>

          {/* Status (read-only) */}
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Status</label>
            <div className="mt-1.5">
              <StatusBadge status={profile.status || 'active'} />
            </div>
          </div>
        </div>
      </div>

      {/* Password */}
      <div className={`${CARD} mb-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Password</h2>
            <p className="text-sm text-slate-400">
              Request a password change. For security, your new password is
              applied only after an approver confirms the request.
            </p>
          </div>
          {editing !== 'password' && (
            <button
              onClick={() => { closeEditor(); setEditing('password') }}
              className="flex-shrink-0 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/30"
            >
              Change Password
            </button>
          )}
        </div>

        {editing === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="mt-4 max-w-sm">
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-slate-300">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                minLength={6}
                className="dashboard-input"
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-slate-300">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                minLength={6}
                className="dashboard-input"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting ? '...' : 'Submit Request'}
              </button>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Allotments — stock an admin has handed this exec to accept/reject */}
      {profile.role === 'sales' && !isDemo && (
        <AllotmentInbox agentId={profile.id} />
      )}

      {/* Units — agent's live inventory ledger (manageable: deliver / return) */}
      {profile.role === 'sales' && !isDemo && (
        <AgentUnits agentId={profile.id} canManage />
      )}

      {/* My Assignments — sales users see what they owe partners */}
      {profile.role === 'sales' && !isDemo && (
        <SalesAssignmentsSection profileId={profile.id} viewerId={profile.id} />
      )}

      {/* Dashboard PIN — admin-only */}
      {profile.role === 'admin' && (
        <DashboardPinSection onToast={showToast} />
      )}

      {/* Pending / past requests */}
      <div className={CARD}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">My Requests</h2>
        {loadingRequests ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-slate-400">You haven&rsquo;t submitted any change requests.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.request_type === 'password'
                      ? 'Password change requested'
                      : `${r.current_value || '—'} → ${r.requested_value || '—'}`}
                  </p>
                  {r.status === 'rejected' && r.reviewer_notes && (
                    <p className="mt-1 text-xs text-rose-400">Reason: {r.reviewer_notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{formatDateDDMMYY(r.created_at)}</span>
                  <StatusBadge status={r.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

// ============================================================================
// SalesAssignmentsSection — a sales user's own list of partner assignments
// (request→assign→deliver workflow). Shows total units still owed and lets the
// salesperson confirm delivery (Pending → Delivered).
// ============================================================================
function SalesAssignmentsSection({ profileId, viewerId }) {
  const [rows, setRows] = useState([])
  const [pendingUnits, setPendingUnits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const { assignments, pendingUnits: pu } = await listSalespersonAssignments(profileId)
      setRows(assignments)
      setPendingUnits(pu)
    } catch (e) {
      console.warn('listSalespersonAssignments failed:', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const confirm = async (a) => {
    setBusyId(a.id)
    try {
      await confirmAssignment({ assignmentId: a.id, confirmedBy: viewerId })
      await load()
    } catch (e) {
      console.error('confirmAssignment failed:', e)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">My Assignments</h2>
        <span className="rounded-full border border-amber-700 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
          {pendingUnits} units pending
        </span>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No assignments yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">{a.partner_name}</p>
                <p className="text-xs text-slate-500">
                  {a.units} × {variantLabel(a.variant)} · {a.source === 'request' ? 'From request' : 'Proactive'}
                  {a.status === 'confirmed' && a.confirmed_at ? ` · Delivered ${formatDateDDMMYY(a.confirmed_at)}` : ''}
                </p>
              </div>
              {a.status === 'confirmed' ? (
                <span className="rounded-full border border-emerald-700 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">Delivered</span>
              ) : (
                <button
                  type="button"
                  onClick={() => confirm(a)}
                  disabled={busyId === a.id}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busyId === a.id ? '…' : 'Confirm delivery'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// DashboardPinSection — admin-only card for setting / changing / removing the
// account-level dashboard PIN. The PIN gates sensitive actions across the
// dashboard for admin and sales users via usePinGate(). It is stored ONLY as a
// bcrypt hash in the DB and verified server-side (verify-admin-pin Edge
// Function) — so it follows the account onto every device.
// ============================================================================
function DashboardPinSection({ onToast }) {
  // 'idle' | 'setting' | 'changing' | 'removing'
  const [mode, setMode] = useState('idle')
  const [hasPin, setHasPin] = useState(null) // null = still loading
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  // Ask the server whether a PIN exists for this account.
  useEffect(() => {
    let cancelled = false
    isPinSet()
      .then((set) => { if (!cancelled) setHasPin(!!set) })
      .catch(() => { if (!cancelled) setHasPin(false) })
    return () => { cancelled = true }
  }, [])

  const reset = () => {
    setMode('idle')
    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setErr(null)
    setBusy(false)
  }

  const digitsOnly = (v) => (v || '').replace(/\D/g, '').slice(0, PIN_LENGTH)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (mode === 'setting') {
      if (newPin.length !== PIN_LENGTH) {
        setErr(`PIN must be ${PIN_LENGTH} digits.`)
        return
      }
      if (newPin !== confirmPin) {
        setErr('PINs do not match.')
        return
      }
      setBusy(true)
      try {
        await setPin(newPin)
        setHasPin(true)
        reset()
        onToast?.('Dashboard PIN saved.')
      } catch (e) {
        setErr(e.message)
        setBusy(false)
      }
      return
    }
    if (mode === 'changing') {
      if (newPin.length !== PIN_LENGTH) {
        setErr(`New PIN must be ${PIN_LENGTH} digits.`)
        return
      }
      if (newPin !== confirmPin) {
        setErr('PINs do not match.')
        return
      }
      setBusy(true)
      try {
        // Verifies the current PIN AND sets the new one server-side in one call.
        await changePin(currentPin, newPin)
        reset()
        onToast?.('Dashboard PIN updated.')
      } catch (e) {
        setErr(e.message)
        setBusy(false)
      }
      return
    }
    if (mode === 'removing') {
      setBusy(true)
      try {
        await removePin(currentPin)
        setHasPin(false)
        reset()
        onToast?.('Dashboard PIN removed.')
      } catch (e) {
        setErr(e.message)
        setBusy(false)
      }
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <span aria-hidden>🔐</span>
            <span>Dashboard Security PIN</span>
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            A 6-digit PIN every admin and sales user must enter before making
            changes in the dashboard. Share it with your team out-of-band.
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-sm">
        <span className="text-slate-400">Status: </span>
        {hasPin === null ? (
          <span className="font-semibold text-slate-400">Checking…</span>
        ) : hasPin ? (
          <span className="font-semibold text-emerald-300">PIN is set ✓</span>
        ) : (
          <span className="font-semibold text-amber-300">No PIN set</span>
        )}
      </div>

      {mode === 'idle' && hasPin !== null && (
        <div className="flex flex-wrap gap-2">
          {hasPin ? (
            <>
              <button
                type="button"
                onClick={() => { reset(); setMode('changing') }}
                className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/30"
              >
                Change PIN
              </button>
              <button
                type="button"
                onClick={() => { reset(); setMode('removing') }}
                className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/20"
              >
                Remove PIN
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => { reset(); setMode('setting') }}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-[#fbf3d4] hover:bg-emerald-500"
            >
              Set PIN
            </button>
          )}
        </div>
      )}

      {mode !== 'idle' && (
        <form onSubmit={handleSubmit} className="mt-2 max-w-sm space-y-3">
          {(mode === 'changing' || mode === 'removing') && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-300">Current PIN</label>
              <input
                type="password"
                value={currentPin}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => setCurrentPin(digitsOnly(e.target.value))}
                placeholder={`Enter your ${PIN_LENGTH}-digit PIN`}
                className="dashboard-input tracking-[0.4em]"
                autoFocus
              />
            </div>
          )}

          {(mode === 'setting' || mode === 'changing') && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-300">New PIN</label>
                <input
                  type="password"
                  value={newPin}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => setNewPin(digitsOnly(e.target.value))}
                  placeholder={`${PIN_LENGTH} digits`}
                  className="dashboard-input tracking-[0.4em]"
                  autoFocus={mode === 'setting'}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-300">Confirm New PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
                  placeholder={`Repeat ${PIN_LENGTH} digits`}
                  className="dashboard-input tracking-[0.4em]"
                />
              </div>
            </>
          )}

          {err && (
            <p className="text-sm font-semibold text-rose-400">{err}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? '...' : mode === 'removing' ? 'Remove PIN' : 'Save PIN'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { displayLogin } from '../lib/phone'
import { formatDateDDMMYY } from '../lib/date'
import {
  submitChangeRequest,
  fetchMyRequests,
  PASSWORD_PLACEHOLDER,
  REQUEST_TYPE_LABELS,
} from '../lib/changeRequests'
import { demoBlock } from '../lib/demoData'

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

  // Which inline editor is open: 'name' | 'phone' | 'password' | null.
  const [editing, setEditing] = useState(null)
  const [nameValue, setNameValue] = useState('')
  const [phoneValue, setPhoneValue] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

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

  const handleNameSubmit = (e) => {
    e.preventDefault()
    const next = nameValue.trim()
    if (!next) {
      setError('Please enter a new name.')
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
    <div className="p-8">
      {/* Green success toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 rounded-xl border border-emerald-600 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300 shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">My Profile</h1>
        <p className="text-slate-400">
          Request changes to your name, phone, or password. Changes take effect
          after approval.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-700 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Current details */}
      <div className={`${CARD} mb-6`}>
        <h2 className="text-lg font-semibold text-white mb-4">Current Details</h2>
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
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
                <p className="text-base text-white">{profile.full_name || '—'}</p>
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
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
                <p className="text-base text-white">{profilePhone(profile) || '—'}</p>
                <button
                  onClick={() => { closeEditor(); setEditing('phone'); setPhoneValue(profilePhone(profile)) }}
                  className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/30"
                >
                  Change Phone Number
                </button>
              </div>
            )}
          </div>

          {/* Role (read-only) */}
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Role</label>
            <p className="mt-1 text-base capitalize text-white">{profile.role || '—'}</p>
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
            <h2 className="text-lg font-semibold text-white">Password</h2>
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
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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

      {/* Pending / past requests */}
      <div className={CARD}>
        <h2 className="text-lg font-semibold text-white mb-4">My Requests</h2>
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
                  <p className="text-sm font-medium text-white">
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
    </div>
  )
}

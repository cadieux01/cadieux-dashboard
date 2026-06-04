import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import FormField from './FormField'
import AlertBanner from './AlertBanner'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { changePassword, changePhone } from '../lib/adminApi'
import { displayLogin, isValidPhone, normalizePhone } from '../lib/phone'
import { demoBlock } from '../lib/demoData'
import { Pencil, KeyRound, Send } from 'lucide-react'

// Real phone for a profile: prefer the dedicated column, then the legacy
// free-form field, then the digits in the synthetic `<phone>@cadieux.<role>`
// login email.
const phoneOf = (u) => (u ? u.phone || u.phone_number || displayLogin(u.email) || '' : '')

function StatusPill({ status }) {
  const s = status || 'active'
  if (s === 'active') {
    return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">🟢 Active</span>
  }
  if (s === 'inactive') {
    return <span className="inline-flex items-center gap-1 rounded-full border border-amber-700 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400">🟠 Deactivated</span>
  }
  return <span className="inline-flex rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-400">Deleted</span>
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800 py-2.5 last:border-0">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-100">{children}</span>
    </div>
  )
}

/**
 * View / edit / reset-password modal for a single sales-agent or partner.
 *
 * Profile name + notes are written straight to `profiles`. Phone changes and
 * password resets are service-role ops, so they go through the manage-partner
 * Edge Function (changePhone / changePassword). Every mutation is audit-logged.
 *
 * Props:
 *   user               the profile row to view/edit
 *   initialMode        'view' | 'edit'
 *   roleLabel          'Sales Agent' | 'Partner' (display text)
 *   role               'sales' | 'partner'
 *   isDemo             block writes in demo mode
 *   onClose()
 *   onShareLogin(user)             reshare phone + URL (no password)
 *   onShareNewPassword({name,phone,password,role})  share a freshly-reset password
 *   onDeactivate(user) / onReactivate(user)
 *   refreshList()      re-fetch the parent list after a successful save
 *   setBanner(banner)  show a top-of-page success banner
 */
export default function UserDetailModal({
  user,
  initialMode = 'view',
  roleLabel,
  role,
  isDemo,
  onClose,
  onShareLogin,
  onShareNewPassword,
  onDeactivate,
  onReactivate,
  refreshList,
  setBanner,
}) {
  const [current, setCurrent] = useState(user)
  const [mode, setMode] = useState(initialMode)

  const [form, setForm] = useState({
    full_name: user.full_name || '',
    phone: phoneOf(user),
    notes: user.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)

  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)

  const status = current.status || 'active'
  const phone = phoneOf(current)

  const startEdit = () => {
    setEditError(null)
    setForm({
      full_name: current.full_name || '',
      phone: phoneOf(current),
      notes: current.notes || '',
    })
    setMode('edit')
  }

  const handleSave = async () => {
    if (isDemo) return demoBlock()
    setEditError(null)

    const name = form.full_name.trim()
    if (name.length < 2) {
      setEditError('Name must be at least 2 characters.')
      return
    }
    const newPhone = form.phone.trim()
    const oldPhone = phoneOf(current)
    const phoneChanged = normalizePhone(newPhone) !== normalizePhone(oldPhone)
    if (phoneChanged && !isValidPhone(newPhone)) {
      setEditError('Enter a valid 10-digit mobile number (starting 6-9).')
      return
    }

    const nextNotes = form.notes.trim()
    const profileChanged =
      name !== (current.full_name || '') || nextNotes !== (current.notes || '')

    setSaving(true)
    try {
      if (profileChanged) {
        const { error: upErr } = await supabase
          .from('profiles')
          .update({ full_name: name, notes: nextNotes || null })
          .eq('id', current.id)
        if (upErr) throw upErr
      }
      if (phoneChanged) {
        await changePhone({ userId: current.id, oldPhone, newPhone })
      }

      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: current.id,
        description: `Updated ${roleLabel} details: ${name} (${phoneChanged ? normalizePhone(newPhone) : oldPhone})`,
        oldValues: {
          full_name: current.full_name || null,
          phone: oldPhone,
          notes: current.notes || null,
        },
        newValues: {
          full_name: name,
          phone: phoneChanged ? normalizePhone(newPhone) : oldPhone,
          notes: nextNotes || null,
        },
      })

      const updated = {
        ...current,
        full_name: name,
        notes: nextNotes || null,
        phone: phoneChanged ? normalizePhone(newPhone) : current.phone,
      }
      setCurrent(updated)
      setMode('view')
      setBanner({
        type: 'success',
        title: `${roleLabel} updated`,
        message: `${name}'s details were saved.`,
      })
      await refreshList()
    } catch (err) {
      console.error('Error saving user details:', err)
      setEditError(err.message || 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (isDemo) return demoBlock()
    setResetError(null)
    if (!newPassword || newPassword.length < 6) {
      setResetError('Password must be at least 6 characters.')
      return
    }
    setResetting(true)
    try {
      await changePassword(current.id, newPassword)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: current.id,
        description: `Reset password for ${roleLabel}: ${current.full_name || phone} (${phone})`,
      })
      const pw = newPassword
      setNewPassword('')
      setMode('view')
      setBanner({
        type: 'success',
        title: 'Password reset successfully',
        message: `A new password was set for ${current.full_name || phone}.`,
      })
      onShareNewPassword({
        name: current.full_name || '',
        phone,
        password: pw,
        role,
      })
    } catch (err) {
      console.error('Error resetting password:', err)
      setResetError(err.message || 'Failed to reset password.')
    } finally {
      setResetting(false)
    }
  }

  const titleByMode = {
    view: `${roleLabel} Details`,
    edit: `Edit ${roleLabel}`,
    reset: 'Reset Password',
  }

  return (
    <Modal isOpen onClose={onClose} title={titleByMode[mode]}>
      {mode === 'view' && (
        <div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 px-4">
            <DetailRow label="Name">{current.full_name || 'N/A'}</DetailRow>
            <DetailRow label="Phone">{phone || 'N/A'}</DetailRow>
            <DetailRow label="Status"><StatusPill status={status} /></DetailRow>
            <DetailRow label="Notes">{current.notes || '—'}</DetailRow>
            <DetailRow label="Created">
              {current.created_at ? formatDateDDMMYY(current.created_at) : 'N/A'}
            </DetailRow>
            <DetailRow label="Login">{phone ? `${phone} (phone + password)` : 'N/A'}</DetailRow>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500"
            >
              <Pencil size={16} /> Edit Details
            </button>
            <button
              type="button"
              onClick={() => { setResetError(null); setNewPassword(''); setMode('reset') }}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-indigo-500"
            >
              <KeyRound size={16} /> Reset Password
            </button>
            <button
              type="button"
              onClick={() => onShareLogin(current)}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-600"
            >
              <Send size={16} /> Share Login
            </button>
            {status === 'inactive' ? (
              <button
                type="button"
                onClick={() => onReactivate(current)}
                className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30"
              >
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDeactivate(current)}
                className="rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30"
              >
                Deactivate
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div>
          {editError && (
            <div className="mb-4">
              <AlertBanner
                type="error"
                title="Could not save changes"
                message={editError}
                onDismiss={() => setEditError(null)}
              />
            </div>
          )}

          <FormField
            label="Full Name"
            value={form.full_name}
            onChange={(value) => setForm((p) => ({ ...p, full_name: value }))}
            placeholder={`${roleLabel} name`}
            required
          />
          <FormField
            label="Phone Number"
            type="tel"
            value={form.phone}
            onChange={(value) => setForm((p) => ({ ...p, phone: value }))}
            placeholder="9876543210"
            required
          />
          <FormField
            label="Notes"
            type="textarea"
            value={form.notes}
            onChange={(value) => setForm((p) => ({ ...p, notes: value }))}
            placeholder="Internal notes"
          />

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => { setMode('view'); setEditError(null) }}
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-slate-100 transition-colors hover:bg-slate-700"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {mode === 'reset' && (
        <div>
          {resetError && (
            <div className="mb-4">
              <AlertBanner
                type="error"
                title="Could not reset password"
                message={resetError}
                onDismiss={() => setResetError(null)}
              />
            </div>
          )}

          <p className="mb-4 text-sm text-slate-400">
            Set a new password for <span className="font-medium text-slate-100">{current.full_name || phone}</span>. They can log in with it immediately.
          </p>

          <FormField
            label="New Password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Minimum 6 characters"
            minLength={6}
            required
          />

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => { setMode('view'); setResetError(null); setNewPassword('') }}
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-slate-100 transition-colors hover:bg-slate-700"
              disabled={resetting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-[#fbf3d4] transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={resetting}
            >
              {resetting ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import FormField from './FormField'
import AlertBanner from './AlertBanner'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { adminSetPassword, changePhone } from '../lib/adminApi'
import { setPartnerMargins } from '../lib/payments'
import { displayLogin, isValidPhone, normalizePhone } from '../lib/phone'
import { demoBlock, PARTNER_TYPES, PARTNER_TYPE_LABELS } from '../lib/demoData'
import { useAuth } from '../context/AuthContext'
import usePinGate from '../lib/usePinGate'
import { Pencil, KeyRound, Send, Sparkles, Copy, Check } from 'lucide-react'

// Generate a strong, readable password. Uses crypto.getRandomValues (never
// Math.random), 14 chars from an ambiguity-free alphabet (no 0/O/o/1/l/I),
// and guarantees at least one lowercase, one uppercase, one digit, and one
// punctuation char so the result meets any downstream complexity rule.
const PW_LOWER  = 'abcdefghijkmnpqrstuvwxyz'
const PW_UPPER  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const PW_DIGITS = '23456789'
const PW_PUNCT  = '-_@#!$%&'
const PW_ALL    = PW_LOWER + PW_UPPER + PW_DIGITS + PW_PUNCT
const PW_LEN    = 14

function pickChar(alphabet) {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return alphabet[buf[0] % alphabet.length]
}

function shuffleString(s) {
  const arr = s.split('')
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0] % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.join('')
}

function generateStrongPassword() {
  const required = [
    pickChar(PW_LOWER),
    pickChar(PW_UPPER),
    pickChar(PW_DIGITS),
    pickChar(PW_PUNCT),
  ]
  const rest = []
  for (let i = required.length; i < PW_LEN; i++) rest.push(pickChar(PW_ALL))
  return shuffleString(required.concat(rest).join(''))
}

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
 * Profile name + partner type are written straight to `profiles`. Phone changes
 * and password resets are service-role ops, so they go through the manage-partner
 * Edge Function (changePhone / changePassword). Every mutation is audit-logged.
 * Deactivate / Reactivate / Remove live at the bottom of edit mode (not the list).
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
  onDelete,
  refreshList,
  setBanner,
}) {
  const { isAdmin } = useAuth()
  const { gate, PinGateElement } = usePinGate()

  const [current, setCurrent] = useState(user)
  const [mode, setMode] = useState(initialMode)

  // Partner margin % is admin-editable only and meaningful for partners only.
  const canEditMargin = isAdmin && role === 'partner'

  const str = (v) => (v == null ? '' : String(v))
  const [form, setForm] = useState({
    full_name: user.full_name || '',
    phone: phoneOf(user),
    partner_type: user.partner_type || '',
    margin_mg: str(user.margin_percent_multigrain ?? user.margin_percent),
    margin_plain: str(user.margin_percent_plain ?? user.margin_percent),
    payout_days: str(user.payout_days),
  })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)
  // When set, the admin used GENERATE — surface the plaintext so it can be
  // copied/shared before the modal closes. Manually editing either field
  // clears this (the shown value would no longer match).
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const onNewPasswordChange = (value) => {
    setNewPassword(value)
    if (generatedPassword && value !== generatedPassword) setGeneratedPassword('')
  }
  const onConfirmPasswordChange = (value) => {
    setConfirmPassword(value)
    if (generatedPassword && value !== generatedPassword) setGeneratedPassword('')
  }
  const handleGenerate = () => {
    const pw = generateStrongPassword()
    setNewPassword(pw)
    setConfirmPassword(pw)
    setGeneratedPassword(pw)
    setCopied(false)
    setResetError(null)
  }
  const handleCopyGenerated = async () => {
    if (!generatedPassword) return
    try {
      await navigator.clipboard.writeText(generatedPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (e.g. insecure context) — leave visible for manual copy.
    }
  }

  const status = current.status || 'active'
  const phone = phoneOf(current)

  const startEdit = () => {
    setEditError(null)
    setForm({
      full_name: current.full_name || '',
      phone: phoneOf(current),
      partner_type: current.partner_type || '',
      margin_mg: str(current.margin_percent_multigrain ?? current.margin_percent),
      margin_plain: str(current.margin_percent_plain ?? current.margin_percent),
      payout_days: str(current.payout_days),
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

    // Partner type is meaningful for partners only.
    const nextType = role === 'partner' ? (form.partner_type || null) : (current.partner_type ?? null)
    const profileChanged =
      name !== (current.full_name || '') ||
      (role === 'partner' && nextType !== (current.partner_type ?? null))

    // Margins + payout: admin-only, partner-only. Blank clears each.
    let nextMg = current.margin_percent_multigrain ?? null
    let nextPlain = current.margin_percent_plain ?? null
    let nextPayout = current.payout_days ?? null
    let marginChanged = false
    if (canEditMargin) {
      const parsePct = (raw, label) => {
        const s = String(raw).trim()
        if (s === '') return null
        const n = Number(s)
        if (Number.isNaN(n) || n < 0 || n > 100) throw new Error(`${label} must be a number between 0 and 100.`)
        return n
      }
      try {
        nextMg = parsePct(form.margin_mg, 'Multi-Grain margin')
        nextPlain = parsePct(form.margin_plain, 'Plain margin')
        const ds = String(form.payout_days).trim()
        if (ds === '') nextPayout = null
        else {
          const dn = Number(ds)
          if (Number.isNaN(dn) || dn < 1 || !Number.isInteger(dn)) throw new Error('Payout days must be a whole number of at least 1.')
          nextPayout = dn
        }
      } catch (e) {
        setEditError(e.message)
        return
      }
      marginChanged =
        (current.margin_percent_multigrain ?? null) !== nextMg ||
        (current.margin_percent_plain ?? null) !== nextPlain ||
        (current.payout_days ?? null) !== nextPayout
    }

    setSaving(true)
    try {
      if (profileChanged) {
        const patch = { full_name: name }
        if (role === 'partner') patch.partner_type = nextType
        const { error: upErr } = await supabase
          .from('profiles')
          .update(patch)
          .eq('id', current.id)
        if (upErr) throw upErr
      }
      if (phoneChanged) {
        await changePhone({ userId: current.id, oldPhone, newPhone })
      }
      if (marginChanged) {
        await setPartnerMargins(current.id, { multigrain: nextMg, plain: nextPlain, payoutDays: nextPayout })
      }

      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: current.id,
        description: `Updated ${roleLabel} details: ${name} (${phoneChanged ? normalizePhone(newPhone) : oldPhone})`,
        oldValues: {
          full_name: current.full_name || null,
          phone: oldPhone,
          partner_type: current.partner_type ?? null,
        },
        newValues: {
          full_name: name,
          phone: phoneChanged ? normalizePhone(newPhone) : oldPhone,
          partner_type: role === 'partner' ? nextType : (current.partner_type ?? null),
        },
      })

      const updated = {
        ...current,
        full_name: name,
        partner_type: role === 'partner' ? nextType : current.partner_type,
        phone: phoneChanged ? normalizePhone(newPhone) : current.phone,
        margin_percent: canEditMargin ? nextMg : current.margin_percent,
        margin_percent_multigrain: canEditMargin ? nextMg : current.margin_percent_multigrain,
        margin_percent_plain: canEditMargin ? nextPlain : current.margin_percent_plain,
        payout_days: canEditMargin ? nextPayout : current.payout_days,
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

  // Validate the form, then PIN-gate the actual password set. Admin-only:
  // the modal hides this control for non-admins and the Edge Function also
  // rejects any non-admin caller.
  const handleReset = () => {
    if (isDemo) return demoBlock()
    if (!isAdmin) {
      setResetError('Only an admin can change a password.')
      return
    }
    setResetError(null)
    if (!newPassword || newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match. Please re-enter them.')
      return
    }
    gate(doReset, `change ${current.full_name || phone}'s password`)
  }

  const doReset = async () => {
    setResetError(null)
    setResetting(true)
    try {
      await adminSetPassword(current.id, newPassword)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: current.id,
        description: `Admin changed password for ${roleLabel}: ${current.full_name || phone} (${phone})`,
      })
      const pw = newPassword
      setNewPassword('')
      setConfirmPassword('')
      setGeneratedPassword('')
      setCopied(false)
      setMode('view')
      setBanner({
        type: 'success',
        title: 'Password changed successfully',
        message: `A new password was set for ${current.full_name || phone}. They can log in with it now.`,
      })
      onShareNewPassword?.({
        name: current.full_name || '',
        phone,
        password: pw,
        role,
      })
    } catch (err) {
      console.error('Error changing password:', err)
      setResetError(err.message || 'Failed to change password.')
    } finally {
      setResetting(false)
    }
  }

  const titleByMode = {
    view: `${roleLabel} Details`,
    edit: `Edit ${roleLabel}`,
    reset: 'Change Password',
  }

  return (
    <Modal isOpen onClose={onClose} title={titleByMode[mode]}>
      {mode === 'view' && (
        <div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 px-4">
            <DetailRow label="Name">{current.full_name || 'N/A'}</DetailRow>
            <DetailRow label="Phone">{phone || 'N/A'}</DetailRow>
            <DetailRow label="Status"><StatusPill status={status} /></DetailRow>
            {role === 'partner' && (
              <DetailRow label="Margin">
                {(() => {
                  const mg = current.margin_percent_multigrain ?? current.margin_percent
                  const pl = current.margin_percent_plain ?? current.margin_percent
                  if (mg == null && pl == null) return '—'
                  return `Multi-Grain ${mg == null ? '—' : Number(mg) + '%'} · Plain ${pl == null ? '—' : Number(pl) + '%'}`
                })()}
              </DetailRow>
            )}
            {role === 'partner' && (
              <DetailRow label="Payout cycle">
                {current.payout_days == null ? '—' : `${Number(current.payout_days)} days`}
              </DetailRow>
            )}
            {role === 'partner' && (
              <DetailRow label="Type">
                {current.partner_type ? (PARTNER_TYPE_LABELS[current.partner_type] || current.partner_type) : '—'}
              </DetailRow>
            )}
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
            {isAdmin && (
              <button
                type="button"
                onClick={() => { setResetError(null); setNewPassword(''); setConfirmPassword(''); setGeneratedPassword(''); setCopied(false); setMode('reset') }}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-indigo-500"
              >
                <KeyRound size={16} /> Change Password
              </button>
            )}
            <button
              type="button"
              onClick={() => onShareLogin(current)}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-600"
            >
              <Send size={16} /> Share Login
            </button>
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
          {canEditMargin && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Multi-Grain margin (%)"
                  type="number"
                  value={form.margin_mg}
                  onChange={(value) => setForm((p) => ({ ...p, margin_mg: value }))}
                  placeholder="0–100 (blank clears)"
                />
                <FormField
                  label="Plain margin (%)"
                  type="number"
                  value={form.margin_plain}
                  onChange={(value) => setForm((p) => ({ ...p, margin_plain: value }))}
                  placeholder="0–100 (blank clears)"
                />
              </div>
              <FormField
                label="Payout cycle (days)"
                type="number"
                value={form.payout_days}
                onChange={(value) => setForm((p) => ({ ...p, payout_days: value }))}
                placeholder="e.g. 10 (blank clears)"
              />
            </>
          )}
          {role === 'partner' && (
            <FormField
              label="Partner Type"
              type="select"
              value={form.partner_type}
              onChange={(value) => setForm((p) => ({ ...p, partner_type: value }))}
              options={PARTNER_TYPES}
            />
          )}

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

          {/* Account controls — kept out of the list; live at the bottom of Edit. */}
          <div className="mt-6 border-t border-slate-800 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Account</p>
            <div className="flex flex-wrap gap-3">
              {status === 'active' ? (
                <button
                  type="button"
                  onClick={() => onDeactivate(current)}
                  disabled={saving}
                  className="rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onReactivate(current)}
                  disabled={saving}
                  className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
              {status !== 'deleted' && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(current)}
                  disabled={saving}
                  className="rounded-lg bg-rose-500/20 px-4 py-2 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Deactivate blocks login but keeps data. Remove hides the account; both are recoverable with Reactivate.
            </p>
          </div>
        </div>
      )}

      {mode === 'reset' && isAdmin && (
        <div>
          {resetError && (
            <div className="mb-4">
              <AlertBanner
                type="error"
                title="Could not change password"
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
            onChange={onNewPasswordChange}
            placeholder="Minimum 8 characters"
            minLength={8}
            required
          />
          <FormField
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={onConfirmPasswordChange}
            placeholder="Re-enter the new password"
            minLength={8}
            required
          />

          <div className="mt-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={resetting}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
            >
              <Sparkles size={16} /> Generate strong password
            </button>
          </div>

          {generatedPassword && (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Generated — copy now, it won't be shown again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded bg-slate-900/60 px-2 py-1.5 font-mono text-sm text-emerald-100 break-all">
                  {generatedPassword}
                </code>
                <button
                  type="button"
                  onClick={handleCopyGenerated}
                  className="flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/30"
                >
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => { setMode('view'); setResetError(null); setNewPassword(''); setConfirmPassword(''); setGeneratedPassword(''); setCopied(false) }}
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
              {resetting ? 'Saving...' : 'Change Password'}
            </button>
          </div>
        </div>
      )}

      {PinGateElement}
    </Modal>
  )
}

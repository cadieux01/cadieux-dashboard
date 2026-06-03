import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { createUser } from '../lib/adminApi'
import { isValidPhone, normalizePhone } from '../lib/phone'
import ShareCredentials from '../components/ShareCredentials'

// Onboarding flow: admins can create both partners and sales execs;
// sales can create partners only. Both roles log in with a phone +
// password (the Edge Function builds a synthetic `<phone>@cadieux.<role>`
// auth email server-side — see ../lib/adminApi.js).
export default function Onboarding() {
  const { role, isDemo } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)
  const [shareData, setShareData] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [formData, setFormData] = useState({
    phone: '',
    password: '',
    full_name: '',
    notes: '',
    role: 'partner',
  })

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  // Demo showcase: a fully static mockup of the onboarding flow. No inputs
  // are editable and every button is disabled — it never creates a user.
  if (isDemo) {
    const inputClass =
      'w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 cursor-not-allowed'
    const steps = [
      {
        title: 'Admin enters partner details',
        desc: 'Phone number, a temporary password, full name and role.',
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        ),
      },
      {
        title: 'Account is created instantly',
        desc: 'A login is provisioned server-side — no email signup needed.',
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        ),
      },
      {
        title: 'Credentials are shared via WhatsApp/SMS',
        desc: 'The phone number and password are sent directly to the user.',
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
        ),
      },
      {
        title: 'Partner logs in with phone + password',
        desc: 'They sign in on the dashboard using the shared credentials.',
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        ),
      },
    ]

    return (
      <div className="dashboard-page">
        <div className="mb-3">
          <h1 className="dashboard-title">User Onboarding</h1>
          <p className="dashboard-subtitle">
            Create new partner or agent accounts (phone + password login)
          </p>
        </div>

        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200">
          🎬 Onboarding Preview — This is how new partners and agents are onboarded
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Static, pre-filled form */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Onboard New User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">User Role</label>
                <select value="partner" disabled className={inputClass}>
                  <option value="partner">Partner</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Phone Number</label>
                <input type="text" value="9876543210" disabled readOnly className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
                <input type="text" value="demo123" disabled readOnly className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
                <input type="text" value="Rahul Kumar" disabled readOnly className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea value="Example partner — preview only." disabled readOnly rows={2} className={inputClass} />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled
                  title="Disabled in demo mode"
                  className="flex-1 px-4 py-2 bg-slate-800 text-slate-400 rounded-lg cursor-not-allowed opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled
                  title="Disabled in demo mode"
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg cursor-not-allowed opacity-60"
                >
                  Create Partner
                </button>
              </div>
            </div>
          </div>

          {/* Visual walkthrough */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">How onboarding works</h2>
            <ol className="space-y-5">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {step.icon}
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">
                      Step {i + 1}: {step.title}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-400">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    )
  }

  // Access check
  if (role !== 'admin' && role !== 'sales') {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-8 max-w-md text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400">Only admin or sales can access this page.</p>
        </div>
      </div>
    )
  }

  const resetForm = () => {
    setFormErrors({})
    setFormData({
      phone: '',
      password: '',
      full_name: '',
      notes: '',
      role: 'partner',
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    // Sales execs can only create partners.
    const targetRole = role === 'admin' ? formData.role : 'partner'
    const roleLabel = targetRole === 'sales' ? 'Agent' : 'Partner'

    const errors = {}
    if (!isValidPhone(formData.phone)) {
      errors.phone = 'Enter a valid 10-digit Indian mobile (starting with 6-9).'
    }
    if (!formData.password || formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters.'
    }
    if (formData.full_name.trim().length < 2) {
      errors.full_name = 'Full name is required.'
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})

    setLoading(true)
    try {
      const phone = normalizePhone(formData.phone)
      const result = await createUser({
        phone,
        password: formData.password,
        full_name: formData.full_name,
        role: targetRole,
        notes: formData.notes,
      })

      // Local audit row (server-side audit already written by the Edge
      // Function; this one keeps the dashboard's own activity feed
      // populated).
      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new ${roleLabel}: ${formData.full_name.trim()} (${result.phone})`,
        newValues: {
          phone: result.phone,
          role: targetRole,
          full_name: formData.full_name.trim(),
        },
      })

      // Open the credential-share card while the plaintext password is still
      // in memory — it cannot be retrieved after this point.
      setShareData({
        name: formData.full_name.trim(),
        phone: result.phone,
        password: formData.password,
        role: targetRole,
      })
      setSuccess(`${roleLabel} user created successfully! Phone: ${result.phone}`)
      resetForm()
      setIsModalOpen(false)
    } catch (err) {
      setError(err.message || `Failed to create ${roleLabel.toLowerCase()}`)
      setIsErrorModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="dashboard-title">
              {role === 'admin' ? 'User Onboarding' : 'Partner Onboarding'}
            </h1>
            <p className="dashboard-subtitle">
              {role === 'admin'
                ? 'Create new partner or agent accounts (phone + password login)'
                : 'Create new partner accounts (phone + password login)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {role === 'admin' ? 'Onboard User' : 'Onboard Partner'}
            </button>
          </div>
        </div>
      </div>

      {/* Onboarding Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setError('')
          setSuccess('')
          resetForm()
        }}
        title={role === 'admin' ? 'Onboard New User' : 'Onboard New Partner'}
      >
        <form onSubmit={handleSubmit}>
          {/* Role selector (admin only) */}
          {role === 'admin' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                User Role
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500 transition-colors"
                required
              >
                <option value="partner">Partner</option>
                <option value="sales">Agent</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                {formData.role === 'sales'
                  ? 'Agents can onboard partners and manage sales'
                  : 'Partners can manage their assigned units and customers'}
              </p>
            </div>
          )}

          <FormField
            label="Phone Number"
            type="tel"
            value={formData.phone}
            onChange={(value) => updateField('phone', value)}
            placeholder="9876543210"
            error={formErrors.phone}
            required
          />

          <FormField
            label="Password"
            type="password"
            value={formData.password}
            onChange={(value) => updateField('password', value)}
            placeholder="Minimum 6 characters"
            minLength={6}
            error={formErrors.password}
            required
          />

          <FormField
            label="Full Name"
            value={formData.full_name}
            onChange={(value) => updateField('full_name', value)}
            placeholder={formData.role === 'sales' ? "Agent's full name" : "Partner's full name"}
            error={formErrors.full_name}
            required
          />

          <FormField
            label="Notes"
            type="textarea"
            value={formData.notes}
            onChange={(value) => updateField('notes', value)}
            placeholder="Internal notes (admin only)"
          />

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false)
                setError('')
                setSuccess('')
                resetForm()
              }}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Creating...' : (formData.role === 'sales' ? 'Create Agent' : 'Create Partner')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Share-credentials card (shown right after a successful create) */}
      {shareData && (
        <ShareCredentials
          name={shareData.name}
          phone={shareData.phone}
          password={shareData.password}
          role={shareData.role}
          onClose={() => {
            setShareData(null)
            setSuccess('')
          }}
        />
      )}

      {/* Error Popup */}
      <Modal
        isOpen={isErrorModalOpen}
        onClose={() => {
          setIsErrorModalOpen(false)
          setError('')
        }}
        title="Error Creating User"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Failed to Create User</h3>
          <p className="text-slate-400 mb-4">
            {error}
          </p>
          <button
            onClick={() => {
              setIsErrorModalOpen(false)
              setError('')
            }}
            className="w-full px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors font-medium"
          >
            OK
          </button>
        </div>
      </Modal>
    </div>
  )
}

import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { createUser } from '../lib/adminApi'
import { isValidPhone, normalizePhone } from '../lib/phone'

// Onboarding flow: admins can create both partners and sales execs;
// sales can create partners only. Both roles log in with a phone +
// password (the Edge Function builds a synthetic `<phone>@cadieux.<role>`
// auth email server-side — see ../lib/adminApi.js).
export default function Onboarding() {
  const { role } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)
  const [successData, setSuccessData] = useState(null)
  const [formData, setFormData] = useState({
    phone: '',
    password: '',
    full_name: '',
    notes: '',
    role: 'partner',
  })

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
    const roleLabel = targetRole === 'sales' ? 'Sales Executive' : 'Partner'

    if (!isValidPhone(formData.phone)) {
      setError('Enter a valid 10-digit Indian mobile (starting with 6-9).')
      setIsErrorModalOpen(true)
      return
    }
    if (!formData.password || formData.password.length < 6) {
      setError('Password must be at least 6 characters.')
      setIsErrorModalOpen(true)
      return
    }
    if (!formData.full_name.trim()) {
      setError('Full name is required.')
      setIsErrorModalOpen(true)
      return
    }

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

      setSuccessData({
        phone: result.phone,
        userId: result.userId,
        role: targetRole,
      })
      setSuccess(`${roleLabel} user created successfully! Phone: ${result.phone}`)
      resetForm()
      setIsModalOpen(false)
      setIsSuccessModalOpen(true)
    } catch (err) {
      setError(err.message || `Failed to create ${roleLabel.toLowerCase()}`)
      setIsErrorModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              {role === 'admin' ? 'User Onboarding' : 'Partner Onboarding'}
            </h1>
            <p className="text-slate-400">
              {role === 'admin'
                ? 'Create new partner or sales executive accounts (phone + password login)'
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
                <option value="sales">Sales Executive</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                {formData.role === 'sales'
                  ? 'Sales executives can onboard partners and manage sales'
                  : 'Partners can manage their assigned units and customers'}
              </p>
            </div>
          )}

          <FormField
            label="Phone Number"
            type="tel"
            value={formData.phone}
            onChange={(value) => setFormData({ ...formData, phone: value })}
            placeholder="9876543210"
            required
          />

          <FormField
            label="Password"
            type="password"
            value={formData.password}
            onChange={(value) => setFormData({ ...formData, password: value })}
            placeholder="Minimum 6 characters"
            required
          />

          <FormField
            label="Full Name"
            value={formData.full_name}
            onChange={(value) => setFormData({ ...formData, full_name: value })}
            placeholder={formData.role === 'sales' ? "Sales executive's full name" : "Partner's full name"}
            required
          />

          <FormField
            label="Notes"
            type="textarea"
            value={formData.notes}
            onChange={(value) => setFormData({ ...formData, notes: value })}
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
              {loading ? 'Creating...' : (formData.role === 'sales' ? 'Create Sales Executive' : 'Create Partner')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Success Popup */}
      <Modal
        isOpen={isSuccessModalOpen}
        onClose={() => {
          setIsSuccessModalOpen(false)
          setSuccess('')
          setSuccessData(null)
        }}
        title={
          successData?.role === 'sales'
            ? 'Sales Executive Created Successfully!'
            : 'Partner Created Successfully!'
        }
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {successData?.role === 'sales'
              ? 'Sales Executive Onboarded Successfully'
              : 'Partner Onboarded Successfully'}
          </h3>
          <p className="text-slate-400 mb-4">
            The account has been created and is ready to use.
          </p>
          {successData && (
            <div className="bg-slate-800/50 rounded-lg p-4 mb-4 text-left">
              <p className="text-sm text-slate-300">
                <span className="font-medium">Login phone:</span> {successData.phone}
              </p>
              {successData.userId && (
                <p className="text-sm text-slate-300 mt-1">
                  <span className="font-medium">User ID:</span> {successData.userId}
                </p>
              )}
            </div>
          )}
          <button
            onClick={() => {
              setIsSuccessModalOpen(false)
              setSuccess('')
              setSuccessData(null)
            }}
            className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium"
          >
            OK
          </button>
        </div>
      </Modal>

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

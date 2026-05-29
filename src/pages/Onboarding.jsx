import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { supabase } from '../lib/supabase'
import { logAuditEvent } from '../lib/audit'

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
    email: '',
    password: '',
    full_name: '',
    date_of_birth: '',
    phone_number: '',
    notes: '',
    role: 'partner', // Default to partner
  })

  // Check access
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      // Validate required fields
      if (!formData.email.trim()) {
        throw new Error('Email is required')
      }
      if (!formData.password || formData.password.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }

      // Create partner user
      // NOTE: In production, this should call a backend API endpoint
      // For now, we'll use a workaround with Supabase Admin API
      const result = await createPartnerUserViaBackend(formData)

      // Audit log: user onboarded
      const roleLabel = result.role === 'sales' ? 'Sales Executive' : 'Partner'
      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new ${roleLabel}: ${formData.full_name || formData.email}`,
        newValues: {
          email: result.email,
          role: result.role,
          full_name: formData.full_name || null,
          phone_number: formData.phone_number || null,
        },
      })

      // Show success popup
      setSuccessData({
        email: result.email,
        userId: result.userId,
        role: result.role,
      })
      setSuccess(`${roleLabel} user created successfully! Email: ${result.email}`)
      setFormData({
        email: '',
        password: '',
        full_name: '',
        date_of_birth: '',
        phone_number: '',
        notes: '',
        role: 'partner',
      })
      setIsModalOpen(false)
      setIsSuccessModalOpen(true)
    } catch (err) {
      // Show error popup
      setError(err.message || 'Failed to create partner user')
      setIsErrorModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const createPartnerUserViaBackend = async (data) => {
    // Store current session to restore it after signUp
    const { data: currentSession } = await supabase.auth.getSession()
    const originalAccessToken = currentSession?.session?.access_token
    const originalRefreshToken = currentSession?.session?.refresh_token
    const originalUserId = currentSession?.session?.user?.id

    try {
      // First, create auth user (this will auto-confirm if email confirmation is disabled)
      // NOTE: Email confirmation must be disabled in Supabase Auth settings for this to work
      // Pass role in metadata so handle_new_user trigger can use it
      const userRole = data.role || 'partner'
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email.trim().toLowerCase(), // Normalize email
        password: data.password,
        options: {
          emailRedirectTo: undefined, // Don't redirect after signup
          data: {
            full_name: data.full_name || '',
            role: userRole, // Pass role to trigger
          },
        },
      })

      if (authError) {
        // Check if user already exists (Supabase may return "invalid" for existing emails)
        const errorMsg = authError.message.toLowerCase()
        if (errorMsg.includes('already registered') ||
          errorMsg.includes('already exists') ||
          (errorMsg.includes('invalid') && errorMsg.includes('email'))) {
          // Check if user actually exists
          const { data: existingUser } = await supabase
            .from('profiles')
            .select('id, email, role')
            .eq('email', data.email.trim().toLowerCase())
            .single()

          if (existingUser) {
            throw new Error(`A user with email "${data.email}" already exists (Role: ${existingUser.role}). Please use a different email.`)
          } else {
            throw new Error(`Email "${data.email}" is already registered in the system. Please use a different email address.`)
          }
        }
        throw authError
      }

      if (!authData.user) {
        throw new Error('Failed to create user')
      }

      // Wait a moment for the trigger to create profile
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Check if profile was auto-created by the trigger
      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', authData.user.id)
        .maybeSingle()

      if (existingProfileError) {
        throw new Error(`Failed to check profile: ${existingProfileError.message}`)
      }

      if (existingProfile) {
        // Update only non-role fields to avoid trigger blocking role changes
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            full_name: data.full_name || null,
            date_of_birth: data.date_of_birth || null,
            phone_number: data.phone_number || null,
            notes: data.notes || null,
          })
          .eq('id', authData.user.id)

        if (profileError) {
          throw new Error(`Failed to update profile: ${profileError.message}`)
        }
      } else {
        // Profile not created by trigger, insert it with role
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            email: data.email,
            role: userRole,
            full_name: data.full_name || null,
            date_of_birth: data.date_of_birth || null,
            phone_number: data.phone_number || null,
            notes: data.notes || null,
          })
          .select()
          .single()

        if (insertError) {
          throw new Error(`Failed to create profile: ${insertError.message}`)
        }
      }

      // Restore original session to prevent logging out the current admin/sales user
      // Check if session changed after signUp
      const { data: newSession } = await supabase.auth.getSession()
      const newUserId = newSession?.session?.user?.id

      // If session changed (new user was signed in), restore original session
      if (originalAccessToken && originalRefreshToken && originalUserId && newUserId !== originalUserId) {
        try {
          // Set flag to prevent auth state change handler from fetching profile during restoration
          // We'll access the ref through a global flag stored in window temporarily
          window.__isRestoringSession = true

          // Restore original session directly (don't sign out first - it causes race conditions)
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: originalAccessToken,
            refresh_token: originalRefreshToken,
          })

          if (sessionError) {
            window.__isRestoringSession = false
            throw sessionError
          }

          // Wait for auth state to fully update and verify restoration
          let restored = false
          for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 100))
            const { data: checkSession } = await supabase.auth.getSession()
            if (checkSession?.session?.user?.id === originalUserId) {
              restored = true
              // Wait a bit more to ensure all auth state changes have propagated
              await new Promise(resolve => setTimeout(resolve, 300))
              break
            }
          }

          if (!restored) {
            console.warn('Session restoration may not have completed properly')
            window.__isRestoringSession = false
          } else {
            // Wait a bit more for auth state to fully propagate, then manually trigger profile fetch
            await new Promise(resolve => setTimeout(resolve, 200))

            // Manually fetch profile for restored user to ensure it's loaded before clearing flag
            try {
              const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', originalUserId)
                .single()

              // Wait a bit more to ensure profile state updates in AuthContext
              await new Promise(resolve => setTimeout(resolve, 100))
            } catch (err) {
              console.warn('Error manually fetching profile after restoration:', err)
            }

            // Now clear the flag - profile should be loaded
            window.__isRestoringSession = false
          }
        } catch (sessionError) {
          window.__isRestoringSession = false
          console.warn('Could not restore session, user may need to refresh:', sessionError)
          // Don't throw - allow the partner creation to succeed even if session restore fails
        }
      }

      return {
        success: true,
        userId: authData.user.id,
        email: data.email,
        role: userRole,
      }
    } catch (error) {
      // Clear restoration flag on error
      if (typeof window !== 'undefined') {
        window.__isRestoringSession = false
      }
      // Restore original session even on error
      if (originalAccessToken && originalRefreshToken && originalUserId) {
        const { data: currentSessionAfterError } = await supabase.auth.getSession()
        const currentUserIdAfterError = currentSessionAfterError?.session?.user?.id

        // Only restore if session changed
        if (currentUserIdAfterError !== originalUserId) {
          try {
            await supabase.auth.setSession({
              access_token: originalAccessToken,
              refresh_token: originalRefreshToken,
            })
          } catch (sessionError) {
            console.error('Error restoring session after error:', sessionError)
          }
        }
      }
      console.error('Error creating partner user:', error)
      throw error
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
                ? 'Create new partner or sales executive accounts'
                : 'Create new partner accounts'}
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
          setFormData({
            email: '',
            password: '',
            full_name: '',
            date_of_birth: '',
            phone_number: '',
            notes: '',
            role: 'partner',
          })
        }}
        title={role === 'admin' ? 'Onboard New User' : 'Onboard New Partner'}
      >
        <form onSubmit={handleSubmit}>
          {/* Role Selector - Only visible for admin */}
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
            label="Email"
            type="email"
            value={formData.email}
            onChange={(value) => setFormData({ ...formData, email: value })}
            placeholder={formData.role === 'sales' ? 'sales@example.com' : 'partner@example.com'}
            required
          />

          <FormField
            label="Password"
            type="password"
            value={formData.password}
            onChange={(value) => setFormData({ ...formData, password: value })}
            placeholder="Minimum 6 characters"
            required
            minLength={6}
          />

          <FormField
            label="Full Name"
            value={formData.full_name}
            onChange={(value) => setFormData({ ...formData, full_name: value })}
            placeholder={formData.role === 'sales' ? "Sales executive's full name" : "Partner's full name"}
          />

          <FormField
            label="Date of Birth"
            type="date"
            value={formData.date_of_birth}
            onChange={(value) => setFormData({ ...formData, date_of_birth: value })}
          />

          <FormField
            label="Phone Number"
            type="tel"
            value={formData.phone_number}
            onChange={(value) => setFormData({ ...formData, phone_number: value })}
            placeholder="+1234567890"
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
                setFormData({
                  email: '',
                  password: '',
                  full_name: '',
                  date_of_birth: '',
                  phone_number: '',
                  notes: '',
                  role: 'partner',
                })
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
            The partner account has been created and is ready to use.
          </p>
          {successData && (
            <div className="bg-slate-800/50 rounded-lg p-4 mb-4 text-left">
              <p className="text-sm text-slate-300">
                <span className="font-medium">Email:</span> {successData.email}
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
        title="Error Creating Partner"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Failed to Create Partner</h3>
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

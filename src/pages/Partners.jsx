import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import AlertBanner from '../components/AlertBanner'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'

export default function Partners() {
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddPartnerModalOpen, setIsAddPartnerModalOpen] = useState(false)
  const [creatingPartner, setCreatingPartner] = useState(false)
  const [banner, setBanner] = useState(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingPartnerId, setEditingPartnerId] = useState(null)
  const [editingPartnerOriginal, setEditingPartnerOriginal] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingPartner, setDeletingPartner] = useState(false)
  const [addFormData, setAddFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    date_of_birth: '',
    phone_number: '',
    notes: '',
  })
  const [editFormData, setEditFormData] = useState({
    full_name: '',
    phone_number: '',
    notes: '',
  })

  useEffect(() => {
    fetchPartners()
  }, [])

  const fetchPartners = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at, role')
        .eq('role', 'partner')
        .order('created_at', { ascending: false })

      if (error) throw error
      setPartners(data || [])
    } catch (error) {
      console.error('Error fetching partners:', error)
      setBanner({
        type: 'error',
        title: 'Failed to load partners',
        message: error.message,
      })
    } finally {
      setLoading(false)
    }
  }

  const filteredPartners = useMemo(() => {
    if (!searchQuery.trim()) return partners
    const query = searchQuery.toLowerCase()
    return partners.filter((partner) => {
      const matchesName = partner.full_name?.toLowerCase().includes(query)
      const matchesEmail = partner.email?.toLowerCase().includes(query)
      const matchesPhone = partner.phone_number?.toLowerCase().includes(query)
      return matchesName || matchesEmail || matchesPhone
    })
  }, [partners, searchQuery])

  const partnersWithPhone = partners.filter(p => p.phone_number).length
  const partnersCreatedLast30Days = partners.filter((partner) => {
    if (!partner.created_at) return false
    const createdDate = new Date(partner.created_at)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return createdDate >= thirtyDaysAgo
  }).length

  const renderPartnerCard = (partner) => (
    <div key={partner.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3">
        <p className="font-semibold text-white">{partner.full_name || 'N/A'}</p>
        <p className="text-xs text-slate-500">{partner.email || 'N/A'}</p>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Phone</p>
          <p className="text-sm text-slate-300">{partner.phone_number || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Created</p>
          <p className="text-sm text-slate-300">
            {partner.created_at ? formatDateDDMMYY(partner.created_at) : 'N/A'}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-slate-500">Credentials</p>
          <div className="mt-1 inline-flex rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
            Password hidden
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleOpenEditModal(partner)}
          className="flex-1 rounded px-3 py-2 text-xs text-indigo-400 transition-colors bg-indigo-500/20 hover:bg-indigo-500/30"
        >
          Edit
        </button>
      </div>
    </div>
  )

  const handleCloseAddPartnerModal = () => {
    setIsAddPartnerModalOpen(false)
    setAddFormData({
      email: '',
      password: '',
      full_name: '',
      date_of_birth: '',
      phone_number: '',
      notes: '',
    })
  }

  const createPartnerUserViaBackend = async (data) => {
    const { data: currentSession } = await supabase.auth.getSession()
    const originalAccessToken = currentSession?.session?.access_token
    const originalRefreshToken = currentSession?.session?.refresh_token
    const originalUserId = currentSession?.session?.user?.id

    try {
      const normalizedEmail = data.email.trim().toLowerCase()
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: data.password,
        options: {
          emailRedirectTo: undefined,
          data: {
            full_name: data.full_name || '',
            role: 'partner',
          },
        },
      })

      if (authError) {
        const errorMsg = authError.message.toLowerCase()
        if (errorMsg.includes('already registered') ||
          errorMsg.includes('already exists') ||
          (errorMsg.includes('invalid') && errorMsg.includes('email'))) {
          const { data: existingUser } = await supabase
            .from('profiles')
            .select('id, email, role')
            .eq('email', normalizedEmail)
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

      await new Promise(resolve => setTimeout(resolve, 1000))

      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', authData.user.id)
        .maybeSingle()

      if (existingProfileError) {
        throw new Error(`Failed to check profile: ${existingProfileError.message}`)
      }

      if (existingProfile) {
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
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            email: normalizedEmail,
            role: 'partner',
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

      const { data: newSession } = await supabase.auth.getSession()
      const newUserId = newSession?.session?.user?.id

      if (originalAccessToken && originalRefreshToken && originalUserId && newUserId !== originalUserId) {
        try {
          window.__isRestoringSession = true

          const { error: sessionError } = await supabase.auth.setSession({
            access_token: originalAccessToken,
            refresh_token: originalRefreshToken,
          })

          if (sessionError) {
            window.__isRestoringSession = false
            throw sessionError
          }

          let restored = false
          for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 100))
            const { data: checkSession } = await supabase.auth.getSession()
            if (checkSession?.session?.user?.id === originalUserId) {
              restored = true
              await new Promise(resolve => setTimeout(resolve, 300))
              break
            }
          }

          if (!restored) {
            window.__isRestoringSession = false
          } else {
            await new Promise(resolve => setTimeout(resolve, 200))
            try {
              await supabase
                .from('profiles')
                .select('*')
                .eq('id', originalUserId)
                .single()
              await new Promise(resolve => setTimeout(resolve, 100))
            } catch (_e) {
              // ignore, session restoration is best-effort
            }
            window.__isRestoringSession = false
          }
        } catch (_sessionError) {
          window.__isRestoringSession = false
        }
      }

      return {
        success: true,
        userId: authData.user.id,
        email: normalizedEmail,
        role: 'partner',
      }
    } catch (error) {
      if (typeof window !== 'undefined') {
        window.__isRestoringSession = false
      }
      if (originalAccessToken && originalRefreshToken && originalUserId) {
        const { data: currentSessionAfterError } = await supabase.auth.getSession()
        const currentUserIdAfterError = currentSessionAfterError?.session?.user?.id

        if (currentUserIdAfterError !== originalUserId) {
          try {
            await supabase.auth.setSession({
              access_token: originalAccessToken,
              refresh_token: originalRefreshToken,
            })
          } catch (_restoreError) {
            // ignore session restore failure in error path
          }
        }
      }
      throw error
    }
  }

  const handleCreatePartner = async (e) => {
    e.preventDefault()
    setBanner(null)

    if (!addFormData.email.trim()) {
      setBanner({
        type: 'warning',
        title: 'Email required',
        message: 'Please enter a partner email.',
      })
      return
    }

    if (!addFormData.password || addFormData.password.length < 6) {
      setBanner({
        type: 'warning',
        title: 'Password too short',
        message: 'Password must be at least 6 characters.',
      })
      return
    }

    setCreatingPartner(true)
    try {
      const result = await createPartnerUserViaBackend(addFormData)

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new Partner: ${addFormData.full_name || result.email}`,
        newValues: {
          email: result.email,
          role: 'partner',
          full_name: addFormData.full_name || null,
          phone_number: addFormData.phone_number || null,
        },
      })

      const partnerLabel = addFormData.full_name?.trim() || result.email
      setBanner({
        type: 'success',
        title: 'Partner created successfully',
        message: `Created "${partnerLabel}" with credential email ${result.email}. The partner can sign in using the password you set, and you can use "Send Reset Link" anytime.`,
      })

      handleCloseAddPartnerModal()
      await fetchPartners()
    } catch (error) {
      console.error('Error creating partner:', error)
      setBanner({
        type: 'error',
        title: 'Failed to create partner',
        message: error.message || 'An unexpected error occurred while creating the partner.',
      })
    } finally {
      setCreatingPartner(false)
    }
  }

  const handleOpenEditModal = (partner) => {
    setEditingPartnerId(partner.id)
    setEditingPartnerOriginal(partner)
    setEditFormData({
      full_name: partner.full_name || '',
      phone_number: partner.phone_number || '',
      notes: partner.notes || '',
    })
    setIsEditModalOpen(true)
  }

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false)
    setEditingPartnerId(null)
    setEditingPartnerOriginal(null)
    setEditFormData({
      full_name: '',
      phone_number: '',
      notes: '',
    })
  }

  const handleSavePartner = async () => {
    if (!editingPartnerId) return
    if (!editFormData.full_name.trim()) {
      setBanner({
        type: 'warning',
        title: 'Name required',
        message: 'Partner name cannot be empty.',
      })
      return
    }

    setSavingEdit(true)
    try {
      const updatePayload = {
        full_name: editFormData.full_name.trim(),
        phone_number: editFormData.phone_number.trim() || null,
        notes: editFormData.notes.trim() || null,
      }

      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', editingPartnerId)
        .eq('role', 'partner')

      if (error) throw error

      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: editingPartnerId,
        description: `Updated partner profile: ${updatePayload.full_name}`,
        oldValues: {
          full_name: editingPartnerOriginal?.full_name || null,
          phone_number: editingPartnerOriginal?.phone_number || null,
          notes: editingPartnerOriginal?.notes || null,
        },
        newValues: updatePayload,
      })

      setBanner({
        type: 'success',
        title: 'Partner updated',
        message: `${updatePayload.full_name} details were updated successfully.`,
      })
      handleCloseEditModal()
      await fetchPartners()
    } catch (error) {
      console.error('Error updating partner:', error)
      setBanner({
        type: 'error',
        title: 'Failed to update partner',
        message: error.message,
      })
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDeletePartner = async () => {
    if (!editingPartnerId || !editingPartnerOriginal) return

    const confirmed = confirm(
      `Delete partner "${editingPartnerOriginal.full_name || editingPartnerOriginal.email}"?\n\nThis removes their profile from the app and they will lose dashboard access.`
    )
    if (!confirmed) return

    setDeletingPartner(true)
    try {
      const { error: profileDeleteError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', editingPartnerId)
        .eq('role', 'partner')

      if (profileDeleteError) throw profileDeleteError

      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: editingPartnerId,
        description: `Deleted partner profile: ${editingPartnerOriginal.full_name || editingPartnerOriginal.email}`,
        oldValues: {
          email: editingPartnerOriginal.email || null,
          full_name: editingPartnerOriginal.full_name || null,
          phone_number: editingPartnerOriginal.phone_number || null,
          notes: editingPartnerOriginal.notes || null,
          role: 'partner',
        },
      })

      setBanner({
        type: 'success',
        title: 'Partner deleted',
        message: `${editingPartnerOriginal.full_name || editingPartnerOriginal.email} was removed from the app and can no longer access the dashboard.`,
      })
      handleCloseEditModal()
      await fetchPartners()
    } catch (error) {
      console.error('Error deleting partner:', error)
      setBanner({
        type: 'error',
        title: 'Failed to delete partner',
        message: error.message || 'An unexpected error occurred while deleting the partner.',
      })
    } finally {
      setDeletingPartner(false)
    }
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Partners</h1>
            <p className="text-slate-400">Centralized partner user management and credential operations</p>
          </div>
          <button
            onClick={() => setIsAddPartnerModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-medium rounded-lg shadow-lg transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Partner
          </button>
        </div>
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

      <div className="mb-6">
        <AlertBanner
          type="info"
          title="Credential security"
          message="Passwords are never visible in the admin UI. Partner credentials are managed securely and are not displayed in plaintext."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <KPICard title="Total Partners" value={partners.length} color="indigo" />
        <KPICard title="With Phone Number" value={partnersWithPhone} color="emerald" />
        <KPICard title="Added (Last 30 Days)" value={partnersCreatedLast30Days} color="amber" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by partner name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {(searchQuery) && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Clear search
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Partner Accounts</h3>
          <span className="text-sm text-slate-500">
            {filteredPartners.length} partner{filteredPartners.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="sm:hidden p-4 space-y-3">
          {filteredPartners.length === 0 ? (
            <p className="text-sm text-slate-400">No partner accounts found.</p>
          ) : (
            filteredPartners.map(renderPartnerCard)
          )}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Partner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Credential Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Credentials</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredPartners.map((partner) => (
                <tr key={partner.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-white">{partner.full_name || 'N/A'}</p>
                      <p className="text-xs text-slate-500">{partner.id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{partner.email || 'N/A'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{partner.phone_number || 'N/A'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">
                      {partner.created_at ? formatDateDDMMYY(partner.created_at) : 'N/A'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="inline-flex px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300">
                      Password hidden
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEditModal(partner)}
                        className="px-3 py-1 text-xs bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPartners.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-slate-500">
                    No partner accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={isAddPartnerModalOpen}
        onClose={handleCloseAddPartnerModal}
        title="Add Partner"
      >
        <form onSubmit={handleCreatePartner}>
          <FormField
            label="Email"
            type="email"
            value={addFormData.email}
            onChange={(value) => setAddFormData({ ...addFormData, email: value })}
            placeholder="partner@example.com"
            required
          />

          <FormField
            label="Password"
            type="password"
            value={addFormData.password}
            onChange={(value) => setAddFormData({ ...addFormData, password: value })}
            placeholder="Minimum 6 characters"
            minLength={6}
            required
          />

          <FormField
            label="Full Name"
            value={addFormData.full_name}
            onChange={(value) => setAddFormData({ ...addFormData, full_name: value })}
            placeholder="Partner full name"
          />

          <FormField
            label="Date of Birth"
            type="date"
            value={addFormData.date_of_birth}
            onChange={(value) => setAddFormData({ ...addFormData, date_of_birth: value })}
          />

          <FormField
            label="Phone Number"
            type="tel"
            value={addFormData.phone_number}
            onChange={(value) => setAddFormData({ ...addFormData, phone_number: value })}
            placeholder="+1234567890"
          />

          <FormField
            label="Notes"
            type="textarea"
            value={addFormData.notes}
            onChange={(value) => setAddFormData({ ...addFormData, notes: value })}
            placeholder="Internal notes"
          />

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseAddPartnerModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              disabled={creatingPartner}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={creatingPartner}
            >
              {creatingPartner ? 'Creating...' : 'Create Partner'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isEditModalOpen}
        onClose={handleCloseEditModal}
        title="Edit Partner"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSavePartner()
          }}
        >
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">Credential Email (read-only)</label>
            <div className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400">
              {editingPartnerOriginal?.email || 'N/A'}
            </div>
          </div>

          <FormField
            label="Partner Name"
            value={editFormData.full_name}
            onChange={(value) => setEditFormData({ ...editFormData, full_name: value })}
            placeholder="Enter partner name"
            required
          />

          <FormField
            label="Phone Number"
            value={editFormData.phone_number}
            onChange={(value) => setEditFormData({ ...editFormData, phone_number: value })}
            placeholder="+1234567890"
          />

          <FormField
            label="Notes"
            type="textarea"
            value={editFormData.notes}
            onChange={(value) => setEditFormData({ ...editFormData, notes: value })}
            placeholder="Internal notes"
          />

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={handleDeletePartner}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={savingEdit || deletingPartner}
            >
              {deletingPartner ? 'Deleting...' : 'Delete Partner'}
            </button>
            <button
              type="button"
              onClick={handleCloseEditModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              disabled={savingEdit || deletingPartner}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={savingEdit || deletingPartner}
            >
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

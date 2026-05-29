import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import AlertBanner from '../components/AlertBanner'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'

export default function SalesExec() {
  const [execs, setExecs] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddExecModalOpen, setIsAddExecModalOpen] = useState(false)
  const [creatingExec, setCreatingExec] = useState(false)
  const [banner, setBanner] = useState(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingExecId, setEditingExecId] = useState(null)
  const [editingExecOriginal, setEditingExecOriginal] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingExec, setDeletingExec] = useState(false)
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
    fetchExecs()
  }, [])

  const fetchExecs = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at, role')
        .eq('role', 'sales')
        .order('created_at', { ascending: false })

      if (error) throw error
      setExecs(data || [])
    } catch (error) {
      console.error('Error fetching sales execs:', error)
      setBanner({
        type: 'error',
        title: 'Failed to load sales execs',
        message: error.message,
      })
    } finally {
      setLoading(false)
    }
  }

  const filteredExecs = useMemo(() => {
    if (!searchQuery.trim()) return execs
    const query = searchQuery.toLowerCase()
    return execs.filter((exec) => {
      const matchesName = exec.full_name?.toLowerCase().includes(query)
      const matchesEmail = exec.email?.toLowerCase().includes(query)
      const matchesPhone = exec.phone_number?.toLowerCase().includes(query)
      return matchesName || matchesEmail || matchesPhone
    })
  }, [execs, searchQuery])

  const execsWithPhone = execs.filter((exec) => exec.phone_number).length
  const execsCreatedLast30Days = execs.filter((exec) => {
    if (!exec.created_at) return false
    const createdDate = new Date(exec.created_at)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return createdDate >= thirtyDaysAgo
  }).length

  const renderExecCard = (exec) => (
    <div key={exec.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3">
        <p className="font-semibold text-white">{exec.full_name || 'N/A'}</p>
        <p className="text-xs text-slate-500">{exec.email || 'N/A'}</p>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Phone</p>
          <p className="text-sm text-slate-300">{exec.phone_number || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Created</p>
          <p className="text-sm text-slate-300">
            {exec.created_at ? formatDateDDMMYY(exec.created_at) : 'N/A'}
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
          onClick={() => handleOpenEditModal(exec)}
          className="flex-1 rounded bg-indigo-500/20 px-3 py-2 text-xs text-indigo-400 transition-colors hover:bg-indigo-500/30"
        >
          Edit
        </button>
      </div>
    </div>
  )

  const handleCloseAddExecModal = () => {
    setIsAddExecModalOpen(false)
    setAddFormData({
      email: '',
      password: '',
      full_name: '',
      date_of_birth: '',
      phone_number: '',
      notes: '',
    })
  }

  const createExecUserViaBackend = async (data) => {
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
            role: 'sales',
          },
        },
      })

      if (authError) {
        const errorMsg = authError.message.toLowerCase()
        if (
          errorMsg.includes('already registered') ||
          errorMsg.includes('already exists') ||
          (errorMsg.includes('invalid') && errorMsg.includes('email'))
        ) {
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

      await new Promise((resolve) => setTimeout(resolve, 1000))

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
            role: 'sales',
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
            await new Promise((resolve) => setTimeout(resolve, 100))
            const { data: checkSession } = await supabase.auth.getSession()
            if (checkSession?.session?.user?.id === originalUserId) {
              restored = true
              await new Promise((resolve) => setTimeout(resolve, 300))
              break
            }
          }

          if (!restored) {
            window.__isRestoringSession = false
          } else {
            await new Promise((resolve) => setTimeout(resolve, 200))
            try {
              await supabase
                .from('profiles')
                .select('*')
                .eq('id', originalUserId)
                .single()
              await new Promise((resolve) => setTimeout(resolve, 100))
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
        role: 'sales',
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

  const handleCreateExec = async (e) => {
    e.preventDefault()
    setBanner(null)

    if (!addFormData.email.trim()) {
      setBanner({
        type: 'warning',
        title: 'Email required',
        message: 'Please enter a sales exec email.',
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

    setCreatingExec(true)
    try {
      const result = await createExecUserViaBackend(addFormData)

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new Sales Executive: ${addFormData.full_name || result.email}`,
        newValues: {
          email: result.email,
          role: 'sales',
          full_name: addFormData.full_name || null,
          phone_number: addFormData.phone_number || null,
        },
      })

      const execLabel = addFormData.full_name?.trim() || result.email
      setBanner({
        type: 'success',
        title: 'Sales exec created',
        message: `Created "${execLabel}" with credential email ${result.email}.`,
      })

      handleCloseAddExecModal()
      await fetchExecs()
    } catch (error) {
      console.error('Error creating sales exec:', error)
      setBanner({
        type: 'error',
        title: 'Failed to create sales exec',
        message: error.message || 'An unexpected error occurred while creating the sales exec.',
      })
    } finally {
      setCreatingExec(false)
    }
  }

  const handleOpenEditModal = (exec) => {
    setEditingExecId(exec.id)
    setEditingExecOriginal(exec)
    setEditFormData({
      full_name: exec.full_name || '',
      phone_number: exec.phone_number || '',
      notes: exec.notes || '',
    })
    setIsEditModalOpen(true)
  }

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false)
    setEditingExecId(null)
    setEditingExecOriginal(null)
    setEditFormData({
      full_name: '',
      phone_number: '',
      notes: '',
    })
  }

  const handleSaveExec = async () => {
    if (!editingExecId) return
    if (!editFormData.full_name.trim()) {
      setBanner({
        type: 'warning',
        title: 'Name required',
        message: 'Sales exec name cannot be empty.',
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
        .eq('id', editingExecId)
        .eq('role', 'sales')

      if (error) throw error

      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: editingExecId,
        description: `Updated sales executive profile: ${updatePayload.full_name}`,
        oldValues: {
          full_name: editingExecOriginal?.full_name || null,
          phone_number: editingExecOriginal?.phone_number || null,
          notes: editingExecOriginal?.notes || null,
        },
        newValues: updatePayload,
      })

      setBanner({
        type: 'success',
        title: 'Sales exec updated',
        message: `${updatePayload.full_name} details were updated successfully.`,
      })
      handleCloseEditModal()
      await fetchExecs()
    } catch (error) {
      console.error('Error updating sales exec:', error)
      setBanner({
        type: 'error',
        title: 'Failed to update sales exec',
        message: error.message,
      })
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDeleteExec = async () => {
    if (!editingExecId || !editingExecOriginal) return

    const confirmed = confirm(
      `Delete sales exec "${editingExecOriginal.full_name || editingExecOriginal.email}"?\n\nThis removes their profile from the app and they will lose dashboard access.`
    )
    if (!confirmed) return

    setDeletingExec(true)
    try {
      const { error: profileDeleteError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', editingExecId)
        .eq('role', 'sales')

      if (profileDeleteError) throw profileDeleteError

      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: editingExecId,
        description: `Deleted sales executive profile: ${editingExecOriginal.full_name || editingExecOriginal.email}`,
        oldValues: {
          email: editingExecOriginal.email || null,
          full_name: editingExecOriginal.full_name || null,
          phone_number: editingExecOriginal.phone_number || null,
          notes: editingExecOriginal.notes || null,
          role: 'sales',
        },
      })

      setBanner({
        type: 'success',
        title: 'Sales exec deleted',
        message: `${editingExecOriginal.full_name || editingExecOriginal.email} was removed from the app.`,
      })
      handleCloseEditModal()
      await fetchExecs()
    } catch (error) {
      console.error('Error deleting sales exec:', error)
      setBanner({
        type: 'error',
        title: 'Failed to delete sales exec',
        message: error.message || 'An unexpected error occurred while deleting the sales exec.',
      })
    } finally {
      setDeletingExec(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-white">Sales Exec</h1>
            <p className="text-slate-400">Manage sales exec accounts.</p>
          </div>
          <button
            onClick={() => setIsAddExecModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 font-medium text-white shadow-lg transition-all hover:from-emerald-500 hover:to-emerald-400"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Exec
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
          message="Passwords are hidden in the admin UI."
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KPICard title="Total Execs" value={execs.length} color="indigo" />
        <KPICard title="With Phone" value={execsWithPhone} color="emerald" />
        <KPICard title="Added (30 Days)" value={execsCreatedLast30Days} color="amber" />
      </div>

      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[220px] flex-1">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 text-sm text-slate-400 transition-colors hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Sales Exec Accounts</h3>
          <span className="text-sm text-slate-500">
            {filteredExecs.length} exec{filteredExecs.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-3 p-4 sm:hidden">
          {filteredExecs.length === 0 ? (
            <p className="text-sm text-slate-400">No sales execs found.</p>
          ) : (
            filteredExecs.map(renderExecCard)
          )}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Exec</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Credential Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Credentials</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredExecs.map((exec) => (
                <tr key={exec.id} className="transition-colors hover:bg-slate-800/30">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-white">{exec.full_name || 'N/A'}</p>
                      <p className="text-xs text-slate-500">{exec.id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{exec.email || 'N/A'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{exec.phone_number || 'N/A'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">
                      {exec.created_at ? formatDateDDMMYY(exec.created_at) : 'N/A'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="inline-flex rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                      Password hidden
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEditModal(exec)}
                        className="rounded bg-indigo-500/20 px-3 py-1 text-xs text-indigo-400 transition-colors hover:bg-indigo-500/30"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExecs.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-slate-500">
                    No sales exec accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={isAddExecModalOpen}
        onClose={handleCloseAddExecModal}
        title="Add Sales Exec"
      >
        <form onSubmit={handleCreateExec}>
          <FormField
            label="Email"
            type="email"
            value={addFormData.email}
            onChange={(value) => setAddFormData({ ...addFormData, email: value })}
            placeholder="sales@example.com"
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
            placeholder="Sales exec name"
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

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleCloseAddExecModal}
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-white transition-colors hover:bg-slate-700"
              disabled={creatingExec}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={creatingExec}
            >
              {creatingExec ? 'Creating...' : 'Create Exec'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isEditModalOpen}
        onClose={handleCloseEditModal}
        title="Edit Sales Exec"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveExec()
          }}
        >
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-300">Credential Email (read-only)</label>
            <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-400">
              {editingExecOriginal?.email || 'N/A'}
            </div>
          </div>

          <FormField
            label="Sales Exec Name"
            value={editFormData.full_name}
            onChange={(value) => setEditFormData({ ...editFormData, full_name: value })}
            placeholder="Enter sales exec name"
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

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleDeleteExec}
              className="rounded-lg bg-rose-600 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={savingEdit || deletingExec}
            >
              {deletingExec ? 'Deleting...' : 'Delete Exec'}
            </button>
            <button
              type="button"
              onClick={handleCloseEditModal}
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-white transition-colors hover:bg-slate-700"
              disabled={savingEdit || deletingExec}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={savingEdit || deletingExec}
            >
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

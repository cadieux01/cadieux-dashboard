import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import AlertBanner from '../components/AlertBanner'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { createUser, deactivateUser, deleteUser, reactivateUser } from '../lib/adminApi'
import { displayLogin, isValidPhone, normalizePhone } from '../lib/phone'
import ShareCredentials from '../components/ShareCredentials'

export default function SalesExec() {
  const [execs, setExecs] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddExecModalOpen, setIsAddExecModalOpen] = useState(false)
  const [creatingExec, setCreatingExec] = useState(false)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [shareData, setShareData] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [highlightId, setHighlightId] = useState(null)
  const rowRefs = useRef({})
  const [addFormData, setAddFormData] = useState({
    phone: '',
    password: '',
    full_name: '',
    notes: '',
  })

  useEffect(() => {
    fetchExecs()
  }, [])

  const fetchExecs = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, phone_number, notes, status, created_at, role')
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

  // Real phone to show: prefer the dedicated phone column, fall back to the
  // synthetic login email (`<phone>@cadieux.sales`).
  const execPhone = (exec) => exec.phone || exec.phone_number || displayLogin(exec.email) || 'N/A'

  const filteredExecs = useMemo(() => {
    if (!searchQuery.trim()) return execs
    const query = searchQuery.toLowerCase()
    return execs.filter((exec) => {
      const matchesName = exec.full_name?.toLowerCase().includes(query)
      const matchesPhone = execPhone(exec).toLowerCase().includes(query)
      const matchesNotes = exec.notes?.toLowerCase().includes(query)
      return matchesName || matchesPhone || matchesNotes
    })
  }, [execs, searchQuery])

  const activeExecs = execs.filter((exec) => (exec.status || 'active') === 'active').length
  const inactiveExecs = execs.filter((exec) => exec.status === 'inactive').length

  const handleCloseAddExecModal = () => {
    setIsAddExecModalOpen(false)
    setFormErrors({})
    setAddFormData({
      phone: '',
      password: '',
      full_name: '',
      notes: '',
    })
  }

  const updateField = (field, value) => {
    setAddFormData((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const validateForm = () => {
    const errors = {}
    if (!isValidPhone(addFormData.phone)) {
      errors.phone = 'Enter a valid 10-digit mobile number (starting 6-9).'
    }
    if (!addFormData.password || addFormData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters.'
    }
    if (addFormData.full_name.trim().length < 2) {
      errors.full_name = 'Please enter the sales exec full name.'
    }
    return errors
  }

  const handleCreateExec = async (e) => {
    e.preventDefault()
    setBanner(null)

    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})

    setCreatingExec(true)
    try {
      const result = await createUser({
        phone: addFormData.phone,
        password: addFormData.password,
        full_name: addFormData.full_name,
        role: 'sales',
        notes: addFormData.notes,
      })

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new Sales Executive: ${addFormData.full_name.trim()} (${result.phone})`,
        newValues: {
          phone: result.phone,
          role: 'sales',
          full_name: addFormData.full_name.trim(),
        },
      })

      setBanner({
        type: 'success',
        title: 'Sales exec created',
        message: `Created "${addFormData.full_name.trim()}" with login ${result.phone}.`,
      })

      // Surface the credential-share card while the plaintext password is
      // still in memory — it cannot be retrieved after this point.
      setShareData({
        name: addFormData.full_name.trim(),
        phone: result.phone,
        password: addFormData.password,
        role: 'sales',
      })

      handleCloseAddExecModal()
      await fetchExecs()

      // Scroll the freshly-created exec into view and briefly highlight it.
      setHighlightId(result.userId)
      setTimeout(() => {
        rowRefs.current[result.userId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }, 100)
      setTimeout(() => setHighlightId(null), 2500)
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

  const handleDeactivate = async (exec) => {
    const phone = exec.phone || exec.phone_number || normalizePhone(displayLogin(exec.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot deactivate', message: 'No valid phone on file for this exec.' })
      return
    }
    if (!confirm(`Deactivate "${exec.full_name || phone}"?\n\nThey lose dashboard access but all their data is kept.`)) return

    setBusyId(exec.id)
    setBanner(null)
    try {
      await deactivateUser(phone)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: exec.id,
        description: `Deactivated sales executive: ${exec.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Sales exec deactivated', message: `${exec.full_name || phone} can no longer log in. Data kept.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error deactivating sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to deactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleReactivate = async (exec) => {
    const phone = exec.phone || exec.phone_number || normalizePhone(displayLogin(exec.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot reactivate', message: 'No valid phone on file for this exec.' })
      return
    }
    setBusyId(exec.id)
    setBanner(null)
    try {
      await reactivateUser(phone)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: exec.id,
        description: `Reactivated sales executive: ${exec.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Sales exec reactivated', message: `${exec.full_name || phone} can log in again.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error reactivating sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to reactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (exec) => {
    const phone = exec.phone || exec.phone_number || normalizePhone(displayLogin(exec.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot delete', message: 'No valid phone on file for this exec.' })
      return
    }
    if (!confirm(`Delete login for "${exec.full_name || phone}"?\n\nThis removes their login but KEEPS all their data and history.`)) return

    setBusyId(exec.id)
    setBanner(null)
    try {
      await deleteUser(phone)
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: exec.id,
        description: `Deleted login for sales executive: ${exec.full_name || phone} (${phone})`,
        oldValues: {
          phone,
          full_name: exec.full_name || null,
          role: 'sales',
        },
      })
      setBanner({ type: 'success', title: 'Login deleted', message: `${exec.full_name || phone}'s login was removed. Data kept.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error deleting sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to delete', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const statusBadge = (status) => {
    const s = status || 'active'
    if (s === 'active') {
      return <span className="inline-flex rounded-full border border-emerald-700 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">Active</span>
    }
    if (s === 'inactive') {
      return <span className="inline-flex rounded-full border border-amber-700 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400">Deactivated</span>
    }
    return <span className="inline-flex rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-400">Deleted</span>
  }

  // Reshare from the list: the plaintext password is gone, so we can only
  // reshare the phone + login URL. ShareCredentials renders the "contact
  // admin to reset" note when password is null.
  const handleReshare = (exec) => {
    setShareData({
      name: exec.full_name || '',
      phone: execPhone(exec),
      password: null,
      role: 'sales',
    })
  }

  const rowActions = (exec) => {
    const status = exec.status || 'active'
    const busy = busyId === exec.id
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => handleReshare(exec)}
          title="Share login (phone + URL, no password)"
          className="rounded bg-indigo-500/20 px-2 py-1 text-xs text-indigo-400 transition-colors hover:bg-indigo-500/30"
        >
          📤
        </button>
        {status === 'inactive' ? (
          <button
            onClick={() => handleReactivate(exec)}
            disabled={busy}
            className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Reactivate'}
          </button>
        ) : status === 'active' ? (
          <button
            onClick={() => handleDeactivate(exec)}
            disabled={busy}
            className="rounded bg-amber-500/20 px-3 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Deactivate'}
          </button>
        ) : null}
        <button
          onClick={() => handleDelete(exec)}
          disabled={busy}
          className="rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
        >
          {busy ? '...' : 'Delete'}
        </button>
      </div>
    )
  }

  const renderExecCard = (exec) => (
    <div
      key={exec.id}
      ref={(el) => { rowRefs.current[exec.id] = el }}
      className={`rounded-xl border bg-slate-900 p-4 transition-colors duration-500 ${
        highlightId === exec.id ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-800'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{exec.full_name || 'N/A'}</p>
          <p className="text-xs text-slate-500">{execPhone(exec)}</p>
        </div>
        {statusBadge(exec.status)}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Created</p>
          <p className="text-sm text-slate-300">
            {exec.created_at ? formatDateDDMMYY(exec.created_at) : 'N/A'}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-slate-500">Notes</p>
          <p className="text-sm text-slate-300">{exec.notes || '—'}</p>
        </div>
      </div>
      {rowActions(exec)}
    </div>
  )

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
          title="Phone login"
          message="Sales execs log in with their phone number and password. Deleting a login keeps all their data."
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KPICard title="Total Execs" value={execs.length} color="indigo" />
        <KPICard title="Active" value={activeExecs} color="emerald" />
        <KPICard title="Deactivated" value={inactiveExecs} color="amber" />
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
                placeholder="Search by name, phone, or notes..."
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
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Notes</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredExecs.map((exec) => (
                <tr
                  key={exec.id}
                  ref={(el) => { rowRefs.current[exec.id] = el }}
                  className={`transition-colors duration-500 ${
                    highlightId === exec.id ? 'bg-emerald-500/10' : 'hover:bg-slate-800/30'
                  }`}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-white">{exec.full_name || 'N/A'}</p>
                      <p className="text-xs text-slate-500">{exec.id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{execPhone(exec)}</p>
                  </td>
                  <td className="px-6 py-4">{statusBadge(exec.status)}</td>
                  <td className="px-6 py-4">
                    <p className="max-w-xs truncate text-slate-300">{exec.notes || '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">
                      {exec.created_at ? formatDateDDMMYY(exec.created_at) : 'N/A'}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-right">{rowActions(exec)}</td>
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
            label="Phone Number"
            type="tel"
            value={addFormData.phone}
            onChange={(value) => updateField('phone', value)}
            placeholder="9876543210"
            error={formErrors.phone}
            required
          />

          <FormField
            label="Password"
            type="password"
            value={addFormData.password}
            onChange={(value) => updateField('password', value)}
            placeholder="Minimum 6 characters"
            minLength={6}
            error={formErrors.password}
            required
          />

          <FormField
            label="Full Name"
            value={addFormData.full_name}
            onChange={(value) => updateField('full_name', value)}
            placeholder="Sales exec name"
            error={formErrors.full_name}
            required
          />

          <FormField
            label="Notes"
            type="textarea"
            value={addFormData.notes}
            onChange={(value) => updateField('notes', value)}
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

      {shareData && (
        <ShareCredentials
          name={shareData.name}
          phone={shareData.phone}
          password={shareData.password}
          role={shareData.role}
          onClose={() => setShareData(null)}
        />
      )}
    </div>
  )
}

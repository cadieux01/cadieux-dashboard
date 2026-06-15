import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import AlertBanner from '../components/AlertBanner'
import DismissibleInfo from '../components/DismissibleInfo'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { createUser, deactivateUser, deleteUser, reactivateUser } from '../lib/adminApi'
import { displayLogin, isValidPhone, normalizePhone } from '../lib/phone'
import ShareCredentials from '../components/ShareCredentials'
import UserDetailModal from '../components/UserDetailModal'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { useAuth } from '../context/AuthContext'
import DEMO_DATA, { demoBlock } from '../lib/demoData'
import { Eye, Pencil, Phone, Send } from 'lucide-react'

export default function SalesExec() {
  const { isDemo } = useAuth()
  const navigate = useNavigate()
  const [execs, setExecs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
  const [isAddExecModalOpen, setIsAddExecModalOpen] = useState(false)
  const [creatingExec, setCreatingExec] = useState(false)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [shareData, setShareData] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [createError, setCreateError] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [detailUser, setDetailUser] = useState(null)
  const [detailMode, setDetailMode] = useState('view')
  const [statsForId, setStatsForId] = useState(null)
  const rowRefs = useRef({})

  const execStat = (e) => stats[e.id] || { partners: 0, assigned: 0, closed: 0 }
  const [addFormData, setAddFormData] = useState({
    phone: '',
    password: '',
    full_name: '',
    notes: '',
  })

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchExecs())

  useEffect(() => {
    fetchExecs()
  }, [])

  const fetchExecs = async () => {
    if (isDemo) {
      setExecs(DEMO_DATA.salesExecList)
      const s = {}
      for (const e of DEMO_DATA.salesExecList) {
        s[e.id] = {
          partners: e.partners || 0,
          assigned: e.assigned || 0,
          closed: e.closed || 0,
        }
      }
      setStats(s)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, phone_number, notes, status, created_at, role')
        .eq('role', 'sales')
        .order('created_at', { ascending: false })

      if (error) throw error
      setExecs(data || [])

      // Best-effort: count partners onboarded by each agent (if the column
      // exists) and roll up partner sales totals. Both lookups are safe to
      // fail — the new stat columns simply render as 0.
      const ids = (data || []).map((e) => e.id)
      if (ids.length > 0) {
        const s = {}
        for (const id of ids) s[id] = { partners: 0, assigned: 0, closed: 0 }
        try {
          const { data: partnerRows } = await supabase
            .from('profiles')
            .select('id, onboarded_by')
            .eq('role', 'partner')
            .in('onboarded_by', ids)
          const partnerToAgent = {}
          for (const p of partnerRows || []) {
            if (s[p.onboarded_by]) s[p.onboarded_by].partners += 1
            partnerToAgent[p.id] = p.onboarded_by
          }
          const partnerIds = Object.keys(partnerToAgent)
          if (partnerIds.length > 0) {
            const { data: salesRows } = await supabase
              .from('sales')
              .select('trainer_id, units_assigned, units_sold')
              .in('trainer_id', partnerIds)
            for (const r of salesRows || []) {
              const agentId = partnerToAgent[r.trainer_id]
              if (s[agentId]) {
                s[agentId].assigned += r.units_assigned || 0
                s[agentId].closed += r.units_sold || 0
              }
            }
          }
        } catch {
          // leave stats as zeros
        }
        setStats(s)
      }
    } catch (error) {
      console.error('Error fetching sales execs:', error)
      setBanner({
        type: 'error',
        title: 'Failed to load Agents',
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
    const query = searchQuery.trim().toLowerCase()
    return execs.filter((exec) => {
      if (!showRemoved && exec.status === 'deleted') return false
      if (!query) return true
      const matchesName = exec.full_name?.toLowerCase().includes(query)
      const matchesPhone = execPhone(exec).toLowerCase().includes(query)
      const matchesNotes = exec.notes?.toLowerCase().includes(query)
      return matchesName || matchesPhone || matchesNotes
    })
  }, [execs, searchQuery, showRemoved])

  const activeExecs = execs.filter((exec) => (exec.status || 'active') === 'active').length
  const inactiveExecs = execs.filter((exec) => exec.status === 'inactive').length
  const removedExecs = execs.filter((exec) => exec.status === 'deleted').length

  const handleCloseAddExecModal = () => {
    setIsAddExecModalOpen(false)
    setFormErrors({})
    setCreateError(null)
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
      errors.full_name = 'Please enter the Agent full name.'
    }
    return errors
  }

  const handleCreateExec = async (e) => {
    e.preventDefault()
    if (isDemo) return demoBlock()
    setBanner(null)
    setCreateError(null)

    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})

    const fullName = addFormData.full_name.trim()

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
        description: `Onboarded new Agent: ${fullName} (${result.phone})`,
        newValues: {
          phone: result.phone,
          role: 'sales',
          full_name: fullName,
        },
      })

      const newPassword = addFormData.password

      // Close the modal immediately, show the full-width green success
      // banner at the top, then surface the credential-share card while the
      // plaintext password is still in memory.
      handleCloseAddExecModal()

      setBanner({
        type: 'success',
        title: `✓ Agent ${fullName} created successfully`,
        message: `Login: ${result.phone}. Share the credentials below.`,
      })

      setShareData({
        name: fullName,
        phone: result.phone,
        password: newPassword,
        role: 'sales',
      })

      await fetchExecs()

      // Scroll the freshly-created agent into view and briefly highlight it.
      setHighlightId(result.userId)
      setTimeout(() => {
        rowRefs.current[result.userId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }, 100)
      setTimeout(() => setHighlightId(null), 2500)
    } catch (error) {
      console.error('Error creating sales agent:', error)
      // Keep the modal open and show the EXACT error inside it.
      setCreateError(error.message || 'An unexpected error occurred while creating the Agent.')
    } finally {
      setCreatingExec(false)
    }
  }

  const handleDeactivate = async (exec) => {
    if (isDemo) return demoBlock()
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
        description: `Deactivated Agent: ${exec.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Agent deactivated', message: `${exec.full_name || phone} can no longer log in. Data kept.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error deactivating sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to deactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleReactivate = async (exec) => {
    if (isDemo) return demoBlock()
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
        description: `Reactivated Agent: ${exec.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Agent reactivated', message: `${exec.full_name || phone} can log in again.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error reactivating sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to reactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (exec) => {
    if (isDemo) return demoBlock()
    const phone = exec.phone || exec.phone_number || normalizePhone(displayLogin(exec.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot remove', message: 'No valid phone on file for this exec.' })
      return
    }
    if (!confirm(`Remove "${exec.full_name || phone}"?\n\nThis blocks their login and hides them from active lists, but KEEPS all their data and history. You can restore them later with Reactivate.`)) return

    setBusyId(exec.id)
    setBanner(null)
    try {
      await deleteUser(phone)
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: exec.id,
        description: `Removed login for Agent: ${exec.full_name || phone} (${phone})`,
        oldValues: {
          phone,
          full_name: exec.full_name || null,
          role: 'sales',
        },
      })
      setBanner({ type: 'success', title: 'Agent removed', message: `${exec.full_name || phone}'s login is blocked and hidden. Data kept; restore with Reactivate.` })
      await fetchExecs()
    } catch (error) {
      console.error('Error removing sales exec:', error)
      setBanner({ type: 'error', title: 'Failed to remove', message: error.message })
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

  const openDetail = (exec, mode = 'view') => {
    setDetailUser(exec)
    setDetailMode(mode)
  }

  const rowActions = (exec) => {
    const status = exec.status || 'active'
    const busy = busyId === exec.id
    return (
      <div className="flex items-center justify-end gap-2">
        <a
          href={`tel:${execPhone(exec)}`}
          title="Call agent"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center rounded bg-emerald-500/10 px-2 py-1.5 text-emerald-400 transition-colors hover:bg-emerald-500/20"
        >
          <Phone size={16} />
        </a>
        <button
          onClick={() => openDetail(exec, 'view')}
          title="View details"
          className="inline-flex items-center justify-center rounded bg-slate-700/50 px-2 py-1.5 text-slate-300 transition-colors hover:bg-slate-700"
        >
          <Eye size={16} />
        </button>
        <button
          onClick={() => openDetail(exec, 'edit')}
          title="Edit details"
          className="inline-flex items-center justify-center rounded bg-emerald-500/20 px-2 py-1.5 text-emerald-400 transition-colors hover:bg-emerald-500/30"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={() => handleReshare(exec)}
          title="Share login (phone + URL, no password)"
          className="inline-flex items-center justify-center rounded bg-indigo-500/20 px-2 py-1.5 text-indigo-400 transition-colors hover:bg-indigo-500/30"
        >
          <Send size={16} />
        </button>
        {status === 'active' && (
          <button
            onClick={() => handleDeactivate(exec)}
            disabled={busy}
            className="rounded bg-amber-500/20 px-3 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Deactivate'}
          </button>
        )}
        {(status === 'inactive' || status === 'deleted') && (
          <button
            onClick={() => handleReactivate(exec)}
            disabled={busy}
            className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Reactivate'}
          </button>
        )}
        {status !== 'deleted' && (
          <button
            onClick={() => handleDelete(exec)}
            disabled={busy}
            className="rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Remove'}
          </button>
        )}
      </div>
    )
  }

  const renderExecCard = (exec) => {
    const s = execStat(exec)
    return (
      <div
        key={exec.id}
        ref={(el) => { rowRefs.current[exec.id] = el }}
        onClick={() => navigate(`/admin/agent/${exec.id}`)}
        className={`cursor-pointer rounded-xl border bg-slate-900 p-4 transition-colors duration-500 ${
          highlightId === exec.id ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-800'
        }`}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-100">{exec.full_name || 'N/A'}</p>
            <p className="text-xs text-slate-500">📞 {execPhone(exec)}</p>
          </div>
          {statusBadge(exec.status)}
        </div>
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
          <span><span className="text-slate-500">Partners:</span> <span className="font-semibold text-slate-100">{s.partners}</span></span>
          <span><span className="text-slate-500">Assigned:</span> <span className="font-semibold text-slate-100">{s.assigned}</span></span>
          <span><span className="text-slate-500">Closed:</span> <span className="font-semibold text-emerald-300">{s.closed}</span></span>
        </div>
        <div className="mb-2 text-xs text-slate-500">
          {exec.created_at ? formatDateDDMMYY(exec.created_at) : ''}
          {exec.notes ? ` · ${exec.notes}` : ''}
        </div>
        <div onClick={(e) => e.stopPropagation()}>{rowActions(exec)}</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Agents</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">Manage agent accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={refresh} loading={refreshing} />
          <button
            onClick={() => setIsAddExecModalOpen(true)}
            className="dashboard-action-btn"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Agent</span>
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

      <div className="mb-3">
        <DismissibleInfo
          storageKey="salesexec-phone-login"
          type="info"
          title="Phone login"
          message="Agents log in with their phone number and password. Deleting a login keeps all their data."
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        <KPICard title="Total Agents" value={execs.length} color="indigo" />
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
                className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
            />
            Show removed{removedExecs > 0 ? ` (${removedExecs})` : ''}
          </label>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 text-sm text-slate-400 transition-colors hover:text-slate-100"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-100">Agent Accounts</h3>
          <span className="text-sm text-slate-500">
            {filteredExecs.length} agent{filteredExecs.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-3 p-4 sm:hidden">
          {filteredExecs.length === 0 ? (
            <p className="text-sm text-slate-400">No agents found.</p>
          ) : (
            filteredExecs.map(renderExecCard)
          )}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Partners</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Assigned</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Closed</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Notes</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredExecs.map((exec) => {
                const s = execStat(exec)
                return (
                  <tr
                    key={exec.id}
                    ref={(el) => { rowRefs.current[exec.id] = el }}
                    onClick={() => navigate(`/admin/agent/${exec.id}`)}
                    className={`cursor-pointer transition-colors duration-500 ${
                      highlightId === exec.id ? 'bg-emerald-500/10' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-100">{exec.full_name || 'N/A'}</p>
                        <p className="text-xs text-slate-500">
                          {exec.created_at ? formatDateDDMMYY(exec.created_at) : ''}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-300">{execPhone(exec)}</p>
                    </td>
                    <td className="px-4 py-3">{statusBadge(exec.status)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-100">{s.partners}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-100">{s.assigned}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-300">{s.closed}</td>
                    <td className="px-4 py-3">
                      <p className="max-w-xs truncate text-slate-300">{exec.notes || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>{rowActions(exec)}</td>
                  </tr>
                )
              })}
              {filteredExecs.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-6 py-8 text-center text-slate-500">
                    No agent accounts found.
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
        title="Add Agent"
      >
        <form onSubmit={handleCreateExec}>
          {createError && (
            <div className="mb-4">
              <AlertBanner
                type="error"
                title="Failed to create Agent"
                message={createError}
                onDismiss={() => setCreateError(null)}
              />
            </div>
          )}

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
            placeholder="Agent name"
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
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-slate-100 transition-colors hover:bg-slate-700"
              disabled={creatingExec}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={creatingExec}
            >
              {creatingExec ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
        </form>
      </Modal>

      {statsForId && (() => {
        const exec = execs.find((e) => e.id === statsForId)
        if (!exec) return null
        const s = execStat(exec)
        // For demo mode, distribute partners across agents alphabetically
        // by joining partnersList in chunks. Live mode: relies on `onboarded_by`
        // (best-effort) which is fetched into stats above; the per-partner
        // list isn't queried here to keep the panel lightweight.
        const demoPartners = isDemo
          ? DEMO_DATA.partnersList.slice(
              filteredExecs.findIndex((x) => x.id === exec.id) * 2,
              filteredExecs.findIndex((x) => x.id === exec.id) * 2 + (exec.partners || 0),
            )
          : []
        return (
          <Modal isOpen={true} onClose={() => setStatsForId(null)} title={exec.full_name || 'Agent'}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-slate-500">Phone</p>
                  <p className="text-slate-200">{execPhone(exec)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-slate-500">Status</p>
                  <div className="mt-1">{statusBadge(exec.status)}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-slate-500">Joined</p>
                  <p className="text-slate-200">{exec.created_at ? formatDateDDMMYY(exec.created_at) : 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-slate-500">Partners · Assigned · Closed</p>
                  <p className="font-mono text-slate-200">
                    <span className="text-slate-100">{s.partners}</span>
                    {' · '}
                    <span className="text-slate-100">{s.assigned}</span>
                    {' · '}
                    <span className="text-emerald-300">{s.closed}</span>
                  </p>
                </div>
              </div>

              {isDemo && demoPartners.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partners under this agent</p>
                  <div className="space-y-1 text-xs">
                    {demoPartners.map((p) => (
                      <div key={p.id} className="flex justify-between rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5">
                        <span className="text-slate-200">{p.full_name}</span>
                        <span className="font-mono text-slate-400">
                          {p.assigned}a · <span className="text-emerald-300">{p.sold}s</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Tip: Full per-partner stats and monthly performance chart open in the Eye/Edit dialog.
              </p>
            </div>
          </Modal>
        )
      })()}

      {detailUser && (
        <UserDetailModal
          user={detailUser}
          initialMode={detailMode}
          roleLabel="Agent"
          role="sales"
          isDemo={isDemo}
          onClose={() => setDetailUser(null)}
          onShareLogin={(u) => handleReshare(u)}
          onShareNewPassword={(d) => setShareData(d)}
          onDeactivate={(u) => { setDetailUser(null); handleDeactivate(u) }}
          onReactivate={(u) => { setDetailUser(null); handleReactivate(u) }}
          refreshList={fetchExecs}
          setBanner={setBanner}
        />
      )}

      {shareData && (
        <ShareCredentials
          name={shareData.name}
          phone={shareData.phone}
          password={shareData.password}
          role={shareData.role}
          onClose={() => setShareData(null)}
        />
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

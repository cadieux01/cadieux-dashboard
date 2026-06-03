import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Eye, Pencil, Send } from 'lucide-react'

// A partner's "display phone" is either the dedicated `phone` column or the
// digits embedded in the synthetic `<digits>@cadieux.partner` auth email.
// Fall back to the legacy free-form `phone_number` field so older partners
// still render.
function partnerPhone(p) {
  if (!p) return ''
  return p.phone || p.phone_number || displayLogin(p.email) || ''
}

export default function Partners() {
  const { isDemo } = useAuth()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddPartnerModalOpen, setIsAddPartnerModalOpen] = useState(false)
  const [creatingPartner, setCreatingPartner] = useState(false)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [shareData, setShareData] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [createError, setCreateError] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [detailUser, setDetailUser] = useState(null)
  const [detailMode, setDetailMode] = useState('view')
  const rowRefs = useRef({})
  const [addFormData, setAddFormData] = useState({
    phone: '',
    password: '',
    full_name: '',
    notes: '',
  })

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchPartners())

  useEffect(() => {
    fetchPartners()
  }, [])

  const fetchPartners = async () => {
    if (isDemo) {
      setPartners(DEMO_DATA.partnersList)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, phone_number, notes, status, created_at, role')
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
      const matchesPhone = partnerPhone(partner).toLowerCase().includes(query)
      const matchesNotes = partner.notes?.toLowerCase().includes(query)
      return matchesName || matchesPhone || matchesNotes
    })
  }, [partners, searchQuery])

  const activePartners = partners.filter((p) => (p.status || 'active') === 'active').length
  const inactivePartners = partners.filter((p) => p.status === 'inactive').length

  const handleCloseAddPartnerModal = () => {
    setIsAddPartnerModalOpen(false)
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
      errors.full_name = 'Please enter the partner\u2019s full name.'
    }
    return errors
  }

  const handleCreatePartner = async (e) => {
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

    setCreatingPartner(true)
    try {
      const result = await createUser({
        phone: addFormData.phone,
        password: addFormData.password,
        full_name: addFormData.full_name,
        role: 'partner',
        notes: addFormData.notes,
      })

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'user',
        entityId: result.userId,
        description: `Onboarded new Partner: ${fullName} (${result.phone})`,
        newValues: {
          phone: result.phone,
          role: 'partner',
          full_name: fullName,
        },
      })

      const newPassword = addFormData.password

      // Close the modal immediately, show the full-width green success
      // banner at the top, then surface the credential-share card while the
      // plaintext password is still in memory.
      handleCloseAddPartnerModal()

      setBanner({
        type: 'success',
        title: `✓ Partner ${fullName} created successfully`,
        message: `Login: ${result.phone}. Share the credentials below.`,
      })

      setShareData({
        name: fullName,
        phone: result.phone,
        password: newPassword,
        role: 'partner',
      })

      await fetchPartners()

      // Scroll the freshly-created partner into view and briefly highlight it.
      setHighlightId(result.userId)
      setTimeout(() => {
        rowRefs.current[result.userId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }, 100)
      setTimeout(() => setHighlightId(null), 2500)
    } catch (error) {
      console.error('Error creating partner:', error)
      // Keep the modal open and show the EXACT error inside it.
      setCreateError(error.message || 'An unexpected error occurred while creating the partner.')
    } finally {
      setCreatingPartner(false)
    }
  }

  const handleDeactivate = async (partner) => {
    if (isDemo) return demoBlock()
    const phone = partner.phone || partner.phone_number || normalizePhone(displayLogin(partner.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot deactivate', message: 'No valid phone on file for this partner.' })
      return
    }
    if (!confirm(`Deactivate "${partner.full_name || phone}"?\n\nThey lose dashboard access but all their data is kept.`)) return

    setBusyId(partner.id)
    setBanner(null)
    try {
      await deactivateUser(phone)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: partner.id,
        description: `Deactivated partner: ${partner.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Partner deactivated', message: `${partner.full_name || phone} can no longer log in. Data kept.` })
      await fetchPartners()
    } catch (error) {
      console.error('Error deactivating partner:', error)
      setBanner({ type: 'error', title: 'Failed to deactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleReactivate = async (partner) => {
    if (isDemo) return demoBlock()
    const phone = partner.phone || partner.phone_number || normalizePhone(displayLogin(partner.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot reactivate', message: 'No valid phone on file for this partner.' })
      return
    }
    setBusyId(partner.id)
    setBanner(null)
    try {
      await reactivateUser(phone)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'user',
        entityId: partner.id,
        description: `Reactivated partner: ${partner.full_name || phone} (${phone})`,
      })
      setBanner({ type: 'success', title: 'Partner reactivated', message: `${partner.full_name || phone} can log in again.` })
      await fetchPartners()
    } catch (error) {
      console.error('Error reactivating partner:', error)
      setBanner({ type: 'error', title: 'Failed to reactivate', message: error.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (partner) => {
    if (isDemo) return demoBlock()
    const phone = partner.phone || partner.phone_number || normalizePhone(displayLogin(partner.email))
    if (!isValidPhone(phone)) {
      setBanner({ type: 'error', title: 'Cannot delete', message: 'No valid phone on file for this partner.' })
      return
    }
    if (!confirm(`Delete login for "${partner.full_name || phone}"?\n\nThis removes their login but KEEPS all their data and history.`)) return

    setBusyId(partner.id)
    setBanner(null)
    try {
      await deleteUser(phone)
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: partner.id,
        description: `Deleted login for partner: ${partner.full_name || phone} (${phone})`,
        oldValues: {
          phone,
          full_name: partner.full_name || null,
          role: 'partner',
        },
      })
      setBanner({ type: 'success', title: 'Login deleted', message: `${partner.full_name || phone}'s login was removed. Data kept.` })
      await fetchPartners()
    } catch (error) {
      console.error('Error deleting partner:', error)
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
  const handleReshare = (partner) => {
    setShareData({
      name: partner.full_name || '',
      phone: partnerPhone(partner),
      password: null,
      role: 'partner',
    })
  }

  const openDetail = (partner, mode = 'view') => {
    setDetailUser(partner)
    setDetailMode(mode)
  }

  const rowActions = (partner) => {
    const status = partner.status || 'active'
    const busy = busyId === partner.id
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => openDetail(partner, 'view')}
          title="View details"
          className="inline-flex items-center justify-center rounded bg-slate-700/50 px-2 py-1.5 text-slate-300 transition-colors hover:bg-slate-700"
        >
          <Eye size={16} />
        </button>
        <button
          onClick={() => openDetail(partner, 'edit')}
          title="Edit details"
          className="inline-flex items-center justify-center rounded bg-emerald-500/20 px-2 py-1.5 text-emerald-400 transition-colors hover:bg-emerald-500/30"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={() => handleReshare(partner)}
          title="Share login (phone + URL, no password)"
          className="inline-flex items-center justify-center rounded bg-indigo-500/20 px-2 py-1.5 text-indigo-400 transition-colors hover:bg-indigo-500/30"
        >
          <Send size={16} />
        </button>
        {status === 'inactive' ? (
          <button
            onClick={() => handleReactivate(partner)}
            disabled={busy}
            className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Reactivate'}
          </button>
        ) : status === 'active' ? (
          <button
            onClick={() => handleDeactivate(partner)}
            disabled={busy}
            className="rounded bg-amber-500/20 px-3 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            {busy ? '...' : 'Deactivate'}
          </button>
        ) : null}
        <button
          onClick={() => handleDelete(partner)}
          disabled={busy}
          className="rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
        >
          {busy ? '...' : 'Delete'}
        </button>
      </div>
    )
  }

  const renderPartnerCard = (partner) => (
    <div
      key={partner.id}
      ref={(el) => { rowRefs.current[partner.id] = el }}
      className={`rounded-xl border bg-slate-900 p-4 transition-colors duration-500 ${
        highlightId === partner.id ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-800'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{partner.full_name || 'N/A'}</p>
          <p className="text-xs text-slate-500">{partnerPhone(partner) || 'N/A'}</p>
        </div>
        {statusBadge(partner.status)}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Created</p>
          <p className="text-sm text-slate-300">
            {partner.created_at ? formatDateDDMMYY(partner.created_at) : 'N/A'}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-slate-500">Notes</p>
          <p className="text-sm text-slate-300">{partner.notes || '—'}</p>
        </div>
      </div>
      {rowActions(partner)}
    </div>
  )

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Partners</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">Centralized partner user management and credential operations</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={refresh} loading={refreshing} />
          <button
            onClick={() => setIsAddPartnerModalOpen(true)}
            className="dashboard-action-btn"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Partner</span>
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
          storageKey="partners-phone-login"
          type="info"
          title="Phone login"
          message="Partners log in with their phone number and password. Deleting a login keeps all their data."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        <KPICard title="Total Partners" value={partners.length} color="indigo" />
        <KPICard title="Active" value={activePartners} color="emerald" />
        <KPICard title="Deactivated" value={inactivePartners} color="amber" />
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
                placeholder="Search by partner name, phone, or notes..."
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
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Notes</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredPartners.map((partner) => (
                <tr
                  key={partner.id}
                  ref={(el) => { rowRefs.current[partner.id] = el }}
                  className={`transition-colors duration-500 ${
                    highlightId === partner.id ? 'bg-emerald-500/10' : 'hover:bg-slate-800/30'
                  }`}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-white">{partner.full_name || 'N/A'}</p>
                      <p className="text-xs text-slate-500">{partner.id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">{partnerPhone(partner) || 'N/A'}</p>
                  </td>
                  <td className="px-6 py-4">{statusBadge(partner.status)}</td>
                  <td className="px-6 py-4">
                    <p className="max-w-xs truncate text-slate-300">{partner.notes || '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-300">
                      {partner.created_at ? formatDateDDMMYY(partner.created_at) : 'N/A'}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-right">{rowActions(partner)}</td>
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
          {createError && (
            <div className="mb-4">
              <AlertBanner
                type="error"
                title="Failed to create partner"
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
            placeholder="Partner full name"
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

      {detailUser && (
        <UserDetailModal
          user={detailUser}
          initialMode={detailMode}
          roleLabel="Partner"
          role="partner"
          isDemo={isDemo}
          onClose={() => setDetailUser(null)}
          onShareLogin={(u) => handleReshare(u)}
          onShareNewPassword={(d) => setShareData(d)}
          onDeactivate={(u) => { setDetailUser(null); handleDeactivate(u) }}
          onReactivate={(u) => { setDetailUser(null); handleReactivate(u) }}
          refreshList={fetchPartners}
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

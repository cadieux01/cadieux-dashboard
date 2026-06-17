import { useEffect, useMemo, useState } from 'react'
import { Phone, Search, Users, Plus, Pencil, MessageSquare, Mail, MessageCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import Modal from '../components/Modal'
import FormField from '../components/FormField'

// Admin-only customer/leads management, surfaced as the Team → Customer sub-tab.
// Full CRUD (add/edit) plus quick contact actions — Call, SMS, WhatsApp, and
// email — using the customer's stored contact + email. Agents never see this
// (Team gates the sub-tab to admins).
const STATUS_META = {
  new: { label: 'New', cls: 'bg-indigo-500/20 text-indigo-600 border-indigo-500/30' },
  converted: { label: 'Converted', cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
  lost: { label: 'Lost', cls: 'bg-rose-500/20 text-rose-600 border-rose-500/30' },
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
]

const EMPTY_FORM = {
  buyer_name: '',
  buyer_contact: '',
  buyer_email: '',
  trainer_id: '',
  status: 'new',
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

// Strip to digits for tel/sms; build a wa.me-friendly number (India default +91
// when a bare 10-digit mobile is given).
function digitsOnly(contact) {
  return (contact || '').replace(/[^\d]/g, '')
}
function waNumber(contact) {
  let d = digitsOnly(contact)
  if (d.length === 10) d = `91${d}`
  return d
}

export default function Customers() {
  const { isDemo } = useAuth()
  const [leads, setLeads] = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const load = async () => {
    if (isDemo) {
      setLeads([])
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('leads')
        .select(`
          *,
          trainers:profiles ( id, name:full_name, contact:phone_number, email )
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      setLeads(data || [])
    } catch (e) {
      console.warn('Customers load failed:', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    if (!isDemo) {
      supabase
        .from('profiles')
        .select('id, name:full_name, contact:phone_number, status')
        .eq('role', 'partner')
        .order('full_name', { ascending: true })
        .then(({ data }) =>
          setPartners((data || []).filter((p) => (p.status || 'active') === 'active')),
        )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((l) => {
      return (
        l.buyer_name?.toLowerCase().includes(q) ||
        l.buyer_contact?.toLowerCase().includes(q) ||
        l.buyer_email?.toLowerCase().includes(q) ||
        l.trainers?.name?.toLowerCase().includes(q)
      )
    })
  }, [leads, query])

  const openAdd = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErr('')
    setModalOpen(true)
  }

  const openEdit = (lead) => {
    setEditingId(lead.id)
    setForm({
      buyer_name: lead.buyer_name || '',
      buyer_contact: lead.buyer_contact || '',
      buyer_email: lead.buyer_email || '',
      trainer_id: lead.trainer_id || '',
      status: lead.status || 'new',
    })
    setFormErr('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErr('')
  }

  const save = async () => {
    if (isDemo) return
    if (!form.buyer_name.trim()) {
      setFormErr('Please enter a customer name.')
      return
    }
    setSaving(true)
    setFormErr('')
    const payload = {
      buyer_name: form.buyer_name.trim(),
      buyer_contact: form.buyer_contact.trim() || null,
      buyer_email: form.buyer_email.trim() || null,
      trainer_id: form.trainer_id || null,
      status: form.status,
    }
    try {
      if (editingId) {
        const { error } = await supabase.from('leads').update(payload).eq('id', editingId)
        if (error) throw error
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'lead',
          entityId: editingId,
          description: createAuditDescription('UPDATE', 'lead', { buyer_name: payload.buyer_name }, null, null, payload),
          newValues: payload,
        })
      } else {
        const { data, error } = await supabase.from('leads').insert([payload]).select().single()
        if (error) throw error
        await logAuditEvent({
          actionType: 'CREATE',
          entityType: 'lead',
          entityId: data.id,
          description: createAuditDescription('CREATE', 'lead', { buyer_name: payload.buyer_name }, null, null, payload),
          newValues: payload,
        })
      }
      closeModal()
      await load()
    } catch (e) {
      setFormErr(e.message || 'Could not save the customer.')
    } finally {
      setSaving(false)
    }
  }

  const call = (contact) => {
    const num = digitsOnly(contact)
    if (num) window.location.href = `tel:${num}`
  }
  const sms = (contact) => {
    const num = digitsOnly(contact)
    if (num) window.location.href = `sms:${num}`
  }
  const whatsapp = (contact) => {
    const num = waNumber(contact)
    if (num) window.open(`https://wa.me/${num}`, '_blank', 'noopener,noreferrer')
  }
  const email = (addr) => {
    if (addr) window.location.href = `mailto:${addr}`
  }

  if (isDemo) {
    return (
      <div className="dashboard-page">
        <p className="text-sm text-slate-500">Customer data is not available in demo mode.</p>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Users size={18} className="text-[#024628]" />
        <h2 className="dashboard-title">Customers</h2>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {filtered.length}
        </span>
        <button
          onClick={openAdd}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#024628] px-3 py-1.5 text-xs font-semibold text-[#fbf3d4] transition-colors hover:bg-[#035a33]"
        >
          <Plus size={14} /> Add customer
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, contact, email, or partner..."
          className="dashboard-input w-full pl-10"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading customers…</p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[#E8E0D4] bg-white/50 p-6 text-center text-sm text-slate-500">
              No customers yet. Use “Add customer” to create one.
            </li>
          ) : (
            filtered.map((lead) => (
              <li
                key={lead.id}
                className="rounded-xl border border-[#E8E0D4] bg-white p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {lead.buyer_name || 'N/A'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {lead.buyer_contact || 'No contact'}
                    </p>
                    {lead.buyer_email && (
                      <p className="truncate text-xs text-slate-500">{lead.buyer_email}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusPill status={lead.status} />
                    <button
                      onClick={() => openEdit(lead)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E0D4] text-slate-500 transition-colors hover:bg-[#F0EBE3] hover:text-slate-700"
                      aria-label="Edit customer"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">
                    Partner: <span className="font-medium text-slate-600">{lead.trainers?.name || '—'}</span>
                  </span>
                  <span className="flex-shrink-0">
                    {lead.created_at ? formatDateDDMMYY(lead.created_at) : '—'}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {lead.buyer_contact && (
                    <>
                      <button
                        onClick={() => call(lead.buyer_contact)}
                        className="flex items-center gap-1.5 rounded-lg border border-[#024628]/30 px-2.5 py-1 text-xs font-semibold text-[#024628] transition-colors hover:bg-[#024628]/5"
                      >
                        <Phone size={13} /> Call
                      </button>
                      <button
                        onClick={() => sms(lead.buyer_contact)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        <MessageSquare size={13} /> SMS
                      </button>
                      <button
                        onClick={() => whatsapp(lead.buyer_contact)}
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10"
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </button>
                    </>
                  )}
                  {lead.buyer_email && (
                    <button
                      onClick={() => email(lead.buyer_email)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      <Mail size={13} /> Email
                    </button>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      <Modal isOpen={modalOpen} onClose={closeModal} title={editingId ? 'Edit customer' : 'Add customer'}>
        <FormField
          label="Customer name"
          value={form.buyer_name}
          onChange={(v) => setForm({ ...form, buyer_name: v })}
          placeholder="Full name"
          required
        />
        <FormField
          label="Contact number"
          type="tel"
          value={form.buyer_contact}
          onChange={(v) => setForm({ ...form, buyer_contact: v })}
          placeholder="e.g. 9876543210"
        />
        <FormField
          label="Email"
          type="email"
          value={form.buyer_email}
          onChange={(v) => setForm({ ...form, buyer_email: v })}
          placeholder="name@example.com"
        />
        <FormField
          label="Partner"
          type="select"
          value={form.trainer_id}
          onChange={(v) => setForm({ ...form, trainer_id: v })}
          options={partners.map((p) => ({ value: p.id, label: p.name || p.contact || 'Partner' }))}
        />
        <FormField
          label="Status"
          type="select"
          value={form.status}
          onChange={(v) => setForm({ ...form, status: v })}
          options={STATUS_OPTIONS}
        />
        {formErr && <p className="mb-3 text-sm font-semibold text-rose-500">{formErr}</p>}
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#024628] px-3 py-2 text-sm font-semibold text-[#fbf3d4] transition-colors hover:bg-[#035a33] disabled:opacity-50"
          >
            {saving ? '…' : editingId ? 'Save changes' : 'Add customer'}
          </button>
          <button
            onClick={closeModal}
            className="rounded-lg border border-[#E8E0D4] px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-[#F0EBE3]"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Phone, Search, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'

// Admin-only customer/leads list, surfaced as the Team → Customer sub-tab.
// Focused read-only view (search + list); the full lead-management workflow
// still lives on the Assignment page. Agents never see this (Team gates it).
const STATUS_META = {
  new: { label: 'New', cls: 'bg-indigo-500/20 text-indigo-600 border-indigo-500/30' },
  converted: { label: 'Converted', cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
  lost: { label: 'Lost', cls: 'bg-rose-500/20 text-rose-600 border-rose-500/30' },
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

export default function Customers() {
  const { isDemo } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      if (isDemo) {
        if (active) {
          setLeads([])
          setLoading(false)
        }
        return
      }
      try {
        const { data, error } = await supabase
          .from('leads')
          .select(`
            *,
            trainers:profiles ( id, name:full_name, contact:phone_number )
          `)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (active) setLeads(data || [])
      } catch (e) {
        console.warn('Customers load failed:', e.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [isDemo])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((l) => {
      return (
        l.buyer_name?.toLowerCase().includes(q) ||
        l.buyer_contact?.toLowerCase().includes(q) ||
        l.trainers?.name?.toLowerCase().includes(q)
      )
    })
  }, [leads, query])

  const call = (contact) => {
    const num = (contact || '').replace(/[^\d+]/g, '')
    if (num) window.location.href = `tel:${num}`
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
      <div className="mb-4 flex items-center gap-2">
        <Users size={18} className="text-[#024628]" />
        <h2 className="dashboard-title">Customers</h2>
        <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {filtered.length}
        </span>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, contact, or partner..."
          className="dashboard-input w-full pl-9"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading customers…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No customers found.</p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((lead) => (
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
                </div>
                <StatusPill status={lead.status} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span className="truncate">
                  Partner: <span className="font-medium text-slate-600">{lead.trainers?.name || '—'}</span>
                </span>
                <span className="flex-shrink-0">
                  {lead.created_at ? formatDateDDMMYY(lead.created_at) : '—'}
                </span>
              </div>
              {lead.buyer_contact && (
                <button
                  onClick={() => call(lead.buyer_contact)}
                  className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[#024628]/30 px-2.5 py-1 text-xs font-semibold text-[#024628] transition-colors hover:bg-[#024628]/5"
                >
                  <Phone size={13} /> Call
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import { demoCTAData, demoCTARetractions } from '../lib/demoData'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { getAssignmentStatus, timeRemaining, timeLabel, SHELF_LIFE } from '../lib/shelfLife'

// Derive day-of-N / days-left / % shelf used straight from the row's
// hours_remaining so it stays consistent with the time badge in both demo
// (relative to the demo "today") and live mode.
function dayInfo(variant, hoursRemaining) {
  const total = SHELF_LIFE[variant]?.days ?? 0
  const totalHours = total * 24
  const elapsed = totalHours - hoursRemaining
  const day = Math.min(Math.max(Math.floor(elapsed / 24) + 1, 1), total)
  const daysLeft = Math.max(0, Math.ceil(hoursRemaining / 24))
  const pctUsed = Math.min(100, Math.max(0, (elapsed / totalHours) * 100))
  const lastDay = hoursRemaining > 0 && day >= total
  return { total, day, daysLeft, pctUsed, lastDay }
}

// Largest shelf life across variants — drives the "By Day" filter options.
const MAX_SHELF_DAYS = Math.max(...Object.values(SHELF_LIFE).map((s) => s.days))

const VARIANT_PILL = {
  multigrain: 'bg-[#024628]/40 text-[#7fe0b7] border border-[#024628]/60',
  plain:      'bg-[#FBF3D4]/10 text-[#FBF3D4] border border-[#FBF3D4]/20',
}

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    kpiColor: 'emerald',
    dot: 'bg-emerald-400',
    text: 'text-emerald-200',
    badge: 'bg-emerald-400/10 border border-emerald-400/20 text-emerald-300',
    card: 'border-[#10b981]/30 bg-[#10b981]/8',
  },
  expiring_soon: {
    label: 'About to Expire',
    kpiColor: 'amber',
    dot: 'bg-amber-400',
    text: 'text-amber-200',
    badge: 'bg-amber-400/10 border border-amber-400/20 text-amber-300',
    card: 'border-[#D97706]/30 bg-[#D97706]/8',
  },
  expired: {
    label: 'Unsold / Expired',
    kpiColor: 'rose',
    dot: 'bg-rose-400',
    text: 'text-rose-200',
    badge: 'bg-rose-400/10 border border-rose-400/20 text-rose-300',
    card: 'border-[#DC2626]/30 bg-[#DC2626]/8',
  },
}

const KPI_COLORS = {
  emerald: 'border-[#10b981]/30 bg-[#10b981]/8 text-[#047857]',
  amber:   'border-[#D97706]/30 bg-[#D97706]/8 text-[#b45309]',
  rose:    'border-[#DC2626]/30 bg-[#DC2626]/8 text-[#b91c1c]',
  slate:   'border-[#E8E0D4]    bg-[#F0EBE3]    text-slate-400',
}

export default function CTA() {
  const { isDemo } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])       // shelf-life assignment rows
  const [retractions, setRetractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [partnerFilter, setPartnerFilter] = useState('all')
  const [variantFilter, setVariantFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchData())

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    if (isDemo) {
      setRows(demoCTAData())
      setRetractions(demoCTARetractions())
      setLoading(false)
      return
    }
    try {
      const today = new Date()
      // Fetch active assignments (units still unsold)
      const { data: salesData, error } = await supabase
        .from('sales')
        .select(`*, trainers:profiles(id, full_name, phone, phone_number, email)`)
        .order('date_of_assignment', { ascending: true, nullsFirst: false })
      if (error) throw error

      const liveRows = (salesData || []).flatMap((sale) => {
        const variants = []
        const mgRemaining = (sale.multigrain_assigned || 0) - (sale.multigrain_sold || 0)
        const plRemaining = (sale.plain_assigned || 0) - (sale.plain_sold || 0)
        const date = sale.date_of_assignment
        const partner = sale.trainers || {}
        const pName = partner.full_name || partner.email || `Partner ${sale.trainer_id?.slice(0, 6)}`
        const pPhone = partner.phone || partner.phone_number || ''

        if (mgRemaining > 0 && date) {
          variants.push({
            id: `${sale.id}_mg`,
            partner_id: sale.trainer_id,
            partner_name: pName,
            partner_phone: pPhone,
            variant: 'multigrain',
            variant_label: 'Multi-Grain',
            assigned_date: date,
            units_assigned: sale.multigrain_assigned || 0,
            units_sold: sale.multigrain_sold || 0,
            units_remaining: mgRemaining,
            status: getAssignmentStatus('multigrain', date, today),
            hours_remaining: timeRemaining('multigrain', date, today),
          })
        }
        if (plRemaining > 0 && date) {
          variants.push({
            id: `${sale.id}_pl`,
            partner_id: sale.trainer_id,
            partner_name: pName,
            partner_phone: pPhone,
            variant: 'plain',
            variant_label: 'Plain',
            assigned_date: date,
            units_assigned: sale.plain_assigned || 0,
            units_sold: sale.plain_sold || 0,
            units_remaining: plRemaining,
            status: getAssignmentStatus('plain', date, today),
            hours_remaining: timeRemaining('plain', date, today),
          })
        }
        return variants
      })

      setRows(liveRows)
      setRetractions([]) // live retractions not yet wired up
    } catch (err) {
      console.error('CTA fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Unique partners from rows for filter dropdown
  const partnerOptions = [...new Map(rows.map((r) => [r.partner_id, r.partner_name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = rows.filter((r) => {
    if (partnerFilter !== 'all' && r.partner_id !== partnerFilter) return false
    if (variantFilter !== 'all' && r.variant !== variantFilter) return false
    if (dayFilter !== 'all' && dayInfo(r.variant, r.hours_remaining).day !== Number(dayFilter)) return false
    return true
  })

  const byStatus = (s) => filtered.filter((r) => r.status === s)
  const active       = byStatus('active')
  const expiring     = byStatus('expiring_soon')
  const expired      = byStatus('expired')

  const kpiTiles = [
    { status: 'active',       count: active.length,    units: active.reduce((s, r) => s + r.units_remaining, 0),    cfg: STATUS_CONFIG.active },
    { status: 'expiring_soon', count: expiring.length, units: expiring.reduce((s, r) => s + r.units_remaining, 0),  cfg: STATUS_CONFIG.expiring_soon },
    { status: 'expired',      count: expired.length,   units: expired.reduce((s, r) => s + r.units_remaining, 0),   cfg: STATUS_CONFIG.expired },
    { status: 'retracted',    count: retractions.length, units: retractions.reduce((s, r) => s + r.units, 0),       cfg: { label: 'Retracted', kpiColor: 'slate', dot: 'bg-slate-400', text: 'text-slate-300' } },
  ]

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dashboard-page-header">
        <div>
          <h1 className="dashboard-title">CTA</h1>
          <p className="dashboard-subtitle hidden sm:block">Shelf life tracking — call to action on unsold stock</p>
        </div>
        <RefreshButton onRefresh={refresh} loading={refreshing} />
      </div>

      {/* KPI tiles */}
      <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {kpiTiles.map(({ status, count, units, cfg }) => (
          <div
            key={status}
            className={`rounded-[20px] border p-4 ${KPI_COLORS[cfg.kpiColor]}`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{cfg.label}</span>
            </div>
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs opacity-60">{units} units remaining</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All partners</option>
          {partnerOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={variantFilter}
          onChange={(e) => setVariantFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All variants</option>
          <option value="multigrain">Multi-Grain ({SHELF_LIFE.multigrain.days}d shelf life)</option>
          <option value="plain">Plain ({SHELF_LIFE.plain.days}d shelf life)</option>
        </select>
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All days</option>
          {Array.from({ length: MAX_SHELF_DAYS }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
        {(partnerFilter !== 'all' || variantFilter !== 'all' || dayFilter !== 'all') && (
          <button
            onClick={() => { setPartnerFilter('all'); setVariantFilter('all'); setDayFilter('all') }}
            className="text-xs text-slate-400 hover:text-slate-100 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Status sections */}
      {[
        { rows: active,   cfg: STATUS_CONFIG.active },
        { rows: expiring, cfg: STATUS_CONFIG.expiring_soon },
        { rows: expired,  cfg: STATUS_CONFIG.expired },
      ].map(({ rows: sRows, cfg }) => sRows.length > 0 && (
        <section key={cfg.label} className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
            {cfg.label} · {sRows.length} assignment{sRows.length !== 1 ? 's' : ''}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sRows.map((row) => (
              <AssignmentCard
                key={row.id}
                row={row}
                cfg={cfg}
                onNavigate={() => navigate(`/admin/partner/${row.partner_id}`)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Retracted section */}
      {retractions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Retracted (last 30 days) · {retractions.length}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {retractions.map((r) => (
              <div
                key={r.id}
                onClick={() => navigate(`/admin/partner/${r.partner_id}`)}
                className="cursor-pointer rounded-[20px] border border-[#E8E0D4] bg-[#F0EBE3] p-4 transition hover:-translate-y-0.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARIANT_PILL[r.variant]}`}>
                      {r.variant_label}
                    </span>
                    <span className="text-xs text-slate-500">{r.reason_label}</span>
                  </div>
                  <span className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</span>
                </div>
                <p className="font-semibold text-slate-100">{r.partner_name}</p>
                <p className="text-xs text-slate-400">{r.partner_phone}</p>
                <p className="mt-1 text-sm font-semibold text-slate-300">{r.units} unit{r.units !== 1 ? 's' : ''} retracted</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && retractions.length === 0 && (
        <div className="dashboard-panel rounded-[24px] px-5 py-12 text-center text-sm text-slate-400">
          No active stock to track right now.
        </div>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

function AssignmentCard({ row, cfg, onNavigate }) {
  const { total: daysTotal, day, daysLeft, pctUsed, lastDay } = dayInfo(row.variant, row.hours_remaining)
  const expired = row.status === 'expired'

  return (
    <div
      onClick={onNavigate}
      className={`cursor-pointer rounded-[20px] border p-4 backdrop-blur-xl transition hover:-translate-y-0.5 ${cfg.card}`}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.badge}`}>
          {timeLabel(row.hours_remaining)}
        </span>
      </div>

      {/* Day of N — prominent */}
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <span className={`text-2xl font-extrabold leading-none ${cfg.text}`}>Day {day}</span>
          <span className="ml-1 text-sm font-semibold text-slate-500">of {daysTotal}</span>
        </div>
        <span className="text-xs font-semibold text-slate-500">
          {expired ? 'Shelf life over' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}
        </span>
      </div>

      {/* Last-day / expired warning */}
      {(lastDay || expired) && (
        <div className={`mb-3 rounded-[12px] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] ${
          expired
            ? 'border border-[#DC2626]/40 bg-[#DC2626]/10 text-[#b91c1c]'
            : 'border border-[#D97706]/40 bg-[#D97706]/10 text-[#b45309]'
        }`}>
          {expired ? '⚠ Expired — retract or divert' : '⚠ Last day — sell today'}
        </div>
      )}

      {/* Partner */}
      <p className="font-semibold text-slate-100">{row.partner_name}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARIANT_PILL[row.variant]}`}>
          {row.variant_label}
        </span>
        <span className="text-xs text-slate-500">{daysTotal}d shelf life</span>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-[10px] bg-[#F0EBE3] px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Assigned</p>
          <p className="font-semibold text-slate-100">{row.units_assigned}</p>
        </div>
        <div className="rounded-[10px] bg-[#F0EBE3] px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Sold</p>
          <p className="font-semibold text-emerald-300">{row.units_sold}</p>
        </div>
        <div className="rounded-[10px] bg-[#F0EBE3] px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Left</p>
          <p className={`font-semibold ${cfg.text}`}>{row.units_remaining}</p>
        </div>
      </div>

      {/* Shelf life used bar */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <span>Shelf used</span>
          <span>{Math.round(pctUsed)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F0EBE3]">
          <div
            className={`h-full rounded-full transition-all ${
              row.status === 'active' ? 'bg-emerald-400' :
              row.status === 'expiring_soon' ? 'bg-amber-400' : 'bg-rose-400'
            }`}
            style={{ width: `${pctUsed}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">Assigned {formatDateDDMMYY(row.assigned_date)}</span>
        <a
          href={`tel:${row.partner_phone}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-full bg-[#F0EBE3] px-2.5 py-1 text-xs text-slate-300 transition hover:bg-[#ECE5DA]"
        >
          📞 Call
        </a>
      </div>
    </div>
  )
}

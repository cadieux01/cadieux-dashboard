import { useEffect, useMemo, useState } from 'react'
import KPICard from '../components/KPICard'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { supabase } from '../lib/supabase'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import {
  demoBlock,
  demoTrainers,
  demoRankings,
  demoVariantTotals,
  demoVariantByPartner,
  demoPartnerPerformance,
  demoDrilldownPartners,
  demoDrilldownPartnerOptions,
  demoDrilldownTotals,
  demoAssignments,
  demoSalesRecords,
  demoAttributions,
  DRILLDOWN_RANGES,
  ATTRIBUTION_REASONS,
  VARIANTS,
} from '../lib/demoData'

const UNIT_PRICE = 100
const ACCENT_GREEN = '#024628'
const ACCENT_CREAM = '#FBF3D4'

const DATE_RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '15d', label: 'Last 15 Days' },
  { value: 'month', label: 'Last Month' },
  { value: '2m', label: 'Last 2 Months' },
  { value: '3m', label: 'Last 3 Months' },
  { value: '6m', label: 'Last 6 Months' },
  { value: 'year', label: '1 Year' },
  { value: 'all', label: 'Overall' },
]

const VARIANT_OPTIONS = [
  { value: 'all', label: 'All variants' },
  { value: 'multigrain', label: VARIANTS.multigrain.short },
  { value: 'plain', label: VARIANTS.plain.short },
]

const REASON_FILTER_OPTIONS = [
  { value: 'all', label: 'All reasons' },
  ...ATTRIBUTION_REASONS,
]

const REASON_PILL = {
  damaged:         { bg: 'bg-rose-500/15 text-rose-200 border-rose-400/30' },
  expired:         { bg: 'bg-orange-500/15 text-orange-200 border-orange-400/30' },
  customer_return: { bg: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30' },
  unsold:          { bg: 'bg-slate-500/15 text-slate-200 border-slate-400/30' },
  other:           { bg: 'bg-sky-500/15 text-sky-200 border-sky-400/30' },
}

// Aggregate raw sales rows into per-variant totals + a per-partner breakdown.
// Best-effort: handles missing variant columns on legacy rows gracefully.
function aggregateVariantRows(rows, nameById) {
  const byPartner = {}
  const totals = {
    multigrain: { assigned: 0, sold: 0, revenue: 0 },
    plain: { assigned: 0, sold: 0, revenue: 0 },
  }
  for (const r of rows || []) {
    const pid = r.trainer_id
    if (!byPartner[pid]) {
      byPartner[pid] = { partner: nameById[pid] || 'Unknown', mg_assigned: 0, mg_sold: 0, plain_assigned: 0, plain_sold: 0, revenue: 0 }
    }
    const mgA = r.multigrain_assigned || 0
    const plA = r.plain_assigned || 0
    byPartner[pid].mg_assigned += mgA
    byPartner[pid].plain_assigned += plA
    totals.multigrain.assigned += mgA
    totals.plain.assigned += plA

    const isPlain = r.product_variant === VARIANTS.plain.name
    const units = r.units_sold || 0
    const price = r.unit_price ?? (isPlain ? VARIANTS.plain.price : VARIANTS.multigrain.price)
    const rev = units * price
    if (isPlain) {
      byPartner[pid].plain_sold += units
      totals.plain.sold += units
      totals.plain.revenue += rev
    } else {
      byPartner[pid].mg_sold += units
      totals.multigrain.sold += units
      totals.multigrain.revenue += rev
    }
    byPartner[pid].revenue += rev
  }
  return { totals, byPartner: Object.values(byPartner) }
}

// ===========================================================================
// PartnerPerformanceSection — scrollable list of partners, each rendered as
// two CSS bars (sold = green, retracted = red). Bar widths are proportional
// to the max across the visible set. Hovering a bar surfaces a dark tooltip
// with per-variant breakdown + revenue. No assigned bar.
// ===========================================================================
function PartnerPerformanceSection({ data, dateRange, onDateRangeChange }) {
  const [hover, setHover] = useState(null) // { id, kind: 'sold' | 'retracted' }

  const maxSold = useMemo(
    () => data.reduce((m, p) => Math.max(m, p.totalSold || 0), 0),
    [data],
  )
  const maxRetracted = useMemo(
    () => data.reduce((m, p) => Math.max(m, p.totalRetracted || 0), 0),
    [data],
  )

  return (
    <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Performance</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
            Partner Performance
          </h2>
        </div>
        <select
          value={dateRange}
          onChange={(e) => onDateRangeChange(e.target.value)}
          className="dashboard-select !w-auto"
          aria-label="Performance date range"
        >
          {DATE_RANGES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {data.length === 0 ? (
        <div className="dashboard-subpanel flex h-[200px] items-center justify-center rounded-[24px] px-5 text-center text-sm text-slate-400">
          No partner data yet
        </div>
      ) : (
        <div
          className="max-h-[400px] overflow-y-auto pr-1 scroll-smooth md:max-h-[500px]"
          style={{ scrollbarWidth: 'thin' }}
        >
          {data.map((p) => {
            const soldPct = maxSold > 0 ? (p.totalSold / maxSold) * 100 : 0
            const retPct = maxRetracted > 0 ? (p.totalRetracted / maxRetracted) * 100 : 0
            const soldHovered = hover?.id === p.id && hover.kind === 'sold'
            const retHovered = hover?.id === p.id && hover.kind === 'retracted'

            return (
              <div key={p.id} className="relative border-b border-[#1e2d3d] py-2">
                <p className="mb-1 text-[12px] font-semibold text-[#f1f5f9] sm:text-[13px]">
                  {p.name}
                </p>

                {/* SOLD bar */}
                <div
                  className="relative mb-1 h-4 w-full overflow-hidden rounded bg-[#111921] sm:h-5"
                  onMouseEnter={() => setHover({ id: p.id, kind: 'sold' })}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className="flex h-full items-center rounded px-2 text-[10px] font-semibold text-white transition-[width] duration-500 ease-out sm:text-[11px]"
                    style={{
                      width: `${Math.max(soldPct, p.totalSold > 0 ? 6 : 0)}%`,
                      backgroundColor: '#10b981',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {soldPct >= 18 && <span>{p.totalSold} units</span>}
                  </div>
                  {soldPct < 18 && p.totalSold > 0 && (
                    <span
                      className="absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-300 sm:text-[11px]"
                      style={{ left: `calc(${Math.max(soldPct, 6)}% + 6px)` }}
                    >
                      {p.totalSold} units
                    </span>
                  )}
                </div>

                {/* RETRACTED bar */}
                <div
                  className="relative h-4 w-full overflow-hidden rounded bg-[#111921] sm:h-5"
                  onMouseEnter={() => setHover({ id: p.id, kind: 'retracted' })}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className="flex h-full items-center rounded px-2 text-[10px] font-semibold text-white transition-[width] duration-500 ease-out sm:text-[11px]"
                    style={{
                      width: `${Math.max(retPct, p.totalRetracted > 0 ? 6 : 0)}%`,
                      backgroundColor: '#ef4444',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {retPct >= 18 && <span>{p.totalRetracted} retracted</span>}
                  </div>
                  {retPct < 18 && p.totalRetracted > 0 && (
                    <span
                      className="absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-300 sm:text-[11px]"
                      style={{ left: `calc(${Math.max(retPct, 6)}% + 6px)` }}
                    >
                      {p.totalRetracted} retracted
                    </span>
                  )}
                </div>

                {(soldHovered || retHovered) && (
                  <div className="pointer-events-none absolute right-2 top-[-6px] z-10 -translate-y-full rounded-lg border border-[#2d3748] bg-[#1a2332] px-3 py-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                    <p className="font-semibold text-[#f1f5f9]">
                      {p.name}{retHovered ? ' — Retracted' : ''}
                    </p>
                    {soldHovered ? (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-[#cbd5e1]">
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Total Sold</span>
                          <span>{p.totalSold} units</span>
                        </div>
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Revenue</span>
                          <span className="text-[#34d399]">₹{p.totalRevenue.toLocaleString()}</span>
                        </div>
                        <div className="mt-1.5 border-t border-[#2d3748] pt-1.5">
                          <div className="flex justify-between gap-6">
                            <span className="text-[#7c8a9a]">Multi-Grain</span>
                            <span>{p.mg_sold} <span className="text-[#7c8a9a]">(₹{p.mg_revenue.toLocaleString()})</span></span>
                          </div>
                          <div className="flex justify-between gap-6">
                            <span className="text-[#7c8a9a]">Plain</span>
                            <span>{p.plain_sold} <span className="text-[#7c8a9a]">(₹{p.plain_revenue.toLocaleString()})</span></span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-[#cbd5e1]">
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Total Retracted</span>
                          <span>{p.totalRetracted} units</span>
                        </div>
                        <div className="mt-1.5 border-t border-[#2d3748] pt-1.5">
                          <div className="flex justify-between gap-6">
                            <span className="text-[#7c8a9a]">Multi-Grain</span>
                            <span>{p.mg_retracted}</span>
                          </div>
                          <div className="flex justify-between gap-6">
                            <span className="text-[#7c8a9a]">Plain</span>
                            <span>{p.plain_retracted}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ===========================================================================
// DrilldownPanel — generic wrapper for the four clickable KPI drill-downs.
// Renders the title, a close button, and the child content.
// ===========================================================================
function DrilldownPanel({ title, subtitle, onClose, onRefresh, children }) {
  return (
    <section className="dashboard-panel mb-6 rounded-[28px] p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Details</p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && <RefreshButton onRefresh={onRefresh} />}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08]"
          >
            <span aria-hidden>✕</span>
            <span>Close</span>
          </button>
        </div>
      </div>
      {children}
    </section>
  )
}

// ===========================================================================
// PartnerCard — a single partner profile card in the Partners drill-down grid.
// ===========================================================================
function PartnerCard({ partner, onClick }) {
  const initial = (partner.name || '?').trim().charAt(0).toUpperCase()
  const active = partner.status === 'active'
  return (
    <button
      type="button"
      onClick={() => onClick && onClick(partner)}
      className="dashboard-subpanel flex flex-col gap-2 rounded-[22px] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#024628] font-display text-base font-bold text-[#FBF3D4]">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{partner.name}</p>
          <p className="truncate text-xs text-slate-500">📞 {partner.phone || 'No contact'}</p>
        </div>
      </div>
      <div className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
        <span aria-hidden>{active ? '🟢' : '🟡'}</span>
        <span>{active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-[14px] bg-white/[0.04] px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Sold</p>
          <p className="mt-0.5 font-semibold text-emerald-200">{partner.sold}</p>
        </div>
        <div className="rounded-[14px] bg-white/[0.04] px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Attr</p>
          <p className="mt-0.5 font-semibold text-amber-200">{partner.attributed}</p>
        </div>
      </div>
    </button>
  )
}

// ===========================================================================
// Main page
// ===========================================================================
export default function Sales() {
  const { isDemo } = useAuth()
  const [trainers, setTrainers] = useState([])
  const [rankings, setRankings] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('all')
  const [partnerPerformance, setPartnerPerformance] = useState([])
  const [variantData, setVariantData] = useState(null)
  const [isAddTrainerModalOpen, setIsAddTrainerModalOpen] = useState(false)
  const [editingTrainerId, setEditingTrainerId] = useState(null)
  const [editingTrainerData, setEditingTrainerData] = useState(null)
  const [trainerFormData, setTrainerFormData] = useState({
    name: '',
    contact: '',
    notes: '',
    joining_date: new Date().toISOString().split('T')[0],
  })

  // --- Drill-down state ----------------------------------------------------
  // Which KPI is expanded ('partners' | 'assigned' | 'sold' | 'attributed' | null).
  const [activeKpi, setActiveKpi] = useState(null)
  // Filters scoped to each drill-down (each remembers its own state).
  const [partnersFilter, setPartnersFilter] = useState({ search: '' })
  const [assignedFilter, setAssignedFilter] = useState({ range: 'all', variant: 'all' })
  const [soldFilter, setSoldFilter] = useState({ range: 'all', variant: 'all', partnerId: 'all' })
  const [attributedFilter, setAttributedFilter] = useState({ range: 'all', variant: 'all', partnerId: 'all', reason: 'all' })
  const [expandedAttrNote, setExpandedAttrNote] = useState(null)
  const [selectedPartner, setSelectedPartner] = useState(null) // for partner profile peek
  const [drilldownRefreshTick, setDrilldownRefreshTick] = useState(0)

  // Pagination state (one cursor per drill-down).
  const ROWS_PER_PAGE = 20
  const [assignedPage, setAssignedPage] = useState(1)
  const [soldPage, setSoldPage] = useState(1)
  const [attributedPage, setAttributedPage] = useState(1)

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchData())

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    if (isDemo) {
      setTrainers(demoTrainers())
      setRankings(demoRankings())
      setVariantData({ totals: demoVariantTotals(), byPartner: demoVariantByPartner() })
      setLoading(false)
      return
    }
    try {
      const { data: partnersData, error: trainersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at')
        .eq('role', 'partner')
        .order('full_name', { ascending: true, nullsFirst: false })

      if (trainersError) throw trainersError

      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('trainer_id, units_assigned, units_sold, retracted_units')

      if (salesError) throw salesError

      const normalizedPartners = (partnersData || []).map((partner) => ({
        id: partner.id,
        name: partner.full_name || partner.email || 'N/A',
        contact: partner.phone_number || '',
        notes: partner.notes || '',
        created_at: partner.created_at,
      }))

      const totalsByPartner = {}
      for (const sale of salesData || []) {
        const partnerId = sale.trainer_id
        if (!partnerId) continue

        if (!totalsByPartner[partnerId]) {
          totalsByPartner[partnerId] = {
            total_units_assigned: 0,
            total_units_sold: 0,
            total_units_retracted: 0,
          }
        }

        totalsByPartner[partnerId].total_units_assigned += sale.units_assigned || 0
        totalsByPartner[partnerId].total_units_sold += sale.units_sold || 0
        totalsByPartner[partnerId].total_units_retracted += sale.retracted_units || 0
      }

      const rankingBase = normalizedPartners.map((partner) => {
        const totals = totalsByPartner[partner.id] || { total_units_assigned: 0, total_units_sold: 0, total_units_retracted: 0 }

        return {
          trainer_id: partner.id,
          trainer_name: partner.name,
          trainer_contact: partner.contact,
          total_units_assigned: totals.total_units_assigned,
          total_units_sold: totals.total_units_sold,
          total_units_retracted: totals.total_units_retracted,
        }
      })

      const sortedRankings = rankingBase.sort((a, b) => b.total_units_sold - a.total_units_sold)
      let previousSold = null
      let currentRank = 0

      const rankingsData = sortedRankings.map((row, index) => {
        if (row.total_units_sold !== previousSold) {
          currentRank = index + 1
          previousSold = row.total_units_sold
        }

        return {
          ...row,
          rank: currentRank,
        }
      })

      setTrainers(normalizedPartners)
      setRankings(rankingsData || [])

      // Variant analytics — best-effort. The variant columns may not exist yet
      // (migration in variant-tracking-columns.sql); if the query fails we just
      // leave the section empty rather than break the whole page.
      const nameById = {}
      for (const p of normalizedPartners) nameById[p.id] = p.name
      try {
        const { data: variantRows, error: variantError } = await supabase
          .from('sales')
          .select('trainer_id, units_sold, unit_price, product_variant, multigrain_assigned, plain_assigned')
        if (!variantError && variantRows) {
          setVariantData(aggregateVariantRows(variantRows, nameById))
        } else {
          setVariantData(null)
        }
      } catch {
        setVariantData(null)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEditTrainer = (trainer) => {
    setEditingTrainerId(trainer.id)
    setEditingTrainerData(trainer)

    const joiningDate = trainer.created_at
      ? new Date(trainer.created_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]

    setTrainerFormData({
      name: trainer.name || '',
      contact: trainer.contact || '',
      notes: trainer.notes || '',
      joining_date: joiningDate,
    })
    setIsAddTrainerModalOpen(true)
  }

  const handleDeleteTrainer = async (id) => {
    if (isDemo) return demoBlock()
    if (!confirm('Are you sure you want to delete this partner? This action cannot be undone.')) {
      return
    }

    try {
      const trainer = trainers.find((item) => item.id === id)

      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('role', 'partner')
        .eq('id', id)

      if (error) throw error

      const oldTrainerDelVals = trainer
        ? {
            name: trainer.name,
            contact: trainer.contact,
            notes: trainer.notes,
            created_at: trainer.created_at,
          }
        : null

      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: id,
        description: createAuditDescription(
          'DELETE',
          'user',
          { name: trainer?.name },
          null,
          oldTrainerDelVals,
          null,
        ),
        oldValues: oldTrainerDelVals,
      })

      await fetchData()
    } catch (error) {
      console.error('Error deleting trainer:', error)
      alert(`Error deleting partner: ${error.message}`)
    }
  }

  const handleSaveTrainer = async () => {
    if (isDemo) return demoBlock()
    if (!trainerFormData.name.trim()) {
      alert('Please enter a partner name')
      return
    }

    try {
      const joiningTimestamp = trainerFormData.joining_date
        ? new Date(trainerFormData.joining_date).toISOString()
        : new Date().toISOString()

      if (editingTrainerId) {
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: trainerFormData.name.trim(),
            phone_number: trainerFormData.contact.trim() || null,
            notes: trainerFormData.notes.trim() || null,
            created_at: joiningTimestamp,
          })
          .eq('role', 'partner')
          .eq('id', editingTrainerId)

        if (error) throw error

        const oldTrainerUpdVals = editingTrainerData
          ? {
              full_name: editingTrainerData.name,
              phone_number: editingTrainerData.contact,
              notes: editingTrainerData.notes,
              created_at: editingTrainerData.created_at,
            }
          : null

        const newTrainerUpdVals = {
          full_name: trainerFormData.name.trim(),
          phone_number: trainerFormData.contact.trim() || null,
          notes: trainerFormData.notes.trim() || null,
          created_at: joiningTimestamp,
        }

        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'user',
          entityId: editingTrainerId,
          description: createAuditDescription(
            'UPDATE',
            'user',
            { name: trainerFormData.name.trim() },
            null,
            oldTrainerUpdVals,
            newTrainerUpdVals,
          ),
          oldValues: oldTrainerUpdVals,
          newValues: newTrainerUpdVals,
        })
      } else {
        alert('Create new partners from the Partners page.')
        return
      }

      setTrainerFormData({
        name: '',
        contact: '',
        notes: '',
        joining_date: new Date().toISOString().split('T')[0],
      })
      setEditingTrainerId(null)
      setEditingTrainerData(null)
      setIsAddTrainerModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving trainer:', error)
      alert(`Error saving partner: ${error.message}`)
    }
  }

  const handleCloseTrainerModal = () => {
    setIsAddTrainerModalOpen(false)
    setEditingTrainerId(null)
    setEditingTrainerData(null)
    setTrainerFormData({
      name: '',
      contact: '',
      notes: '',
      joining_date: new Date().toISOString().split('T')[0],
    })
  }

  const summary = useMemo(() => {
    const totalUnitsAssigned = rankings.reduce((sum, ranking) => sum + (ranking.total_units_assigned || 0), 0)
    const totalUnitsSold = rankings.reduce((sum, ranking) => sum + (ranking.total_units_sold || 0), 0)
    const totalUnitsRetracted = rankings.reduce((sum, ranking) => sum + (ranking.total_units_retracted || 0), 0)
    const activePartners = rankings.filter((ranking) => (ranking.total_units_sold || 0) > 0).length
    const sellThrough = totalUnitsAssigned > 0 ? (totalUnitsSold / totalUnitsAssigned) * 100 : 0
    const topPartner = rankings[0] || null

    return {
      totalUnitsAssigned,
      totalUnitsSold,
      totalUnitsRetracted,
      activePartners,
      sellThrough,
      topPartner,
    }
  }, [rankings])

  // Demo drill-down summary overrides KPI numbers in demo mode.
  const drilldownTotals = useMemo(() => {
    if (!isDemo) return null
    return demoDrilldownTotals({ range: 'all' })
  }, [isDemo])

  const kpiPartnersCount  = drilldownTotals?.partners ?? trainers.length
  const kpiAssigned       = drilldownTotals?.assigned ?? summary.totalUnitsAssigned
  const kpiSold           = drilldownTotals?.sold ?? summary.totalUnitsSold
  const kpiAttributed     = drilldownTotals?.attributed ?? summary.totalUnitsRetracted
  const kpiActivePartners = drilldownTotals?.activePartners ?? summary.activePartners

  const topRankings = useMemo(() => rankings.slice(0, 6), [rankings])

  useEffect(() => {
    if (isDemo) {
      setPartnerPerformance(demoPartnerPerformance(dateRange))
      return
    }
    const shaped = rankings
      .map((r, i) => ({
        id: r.trainer_id || String(i + 1),
        name: r.trainer_name,
        totalSold: r.total_units_sold || 0,
        totalRetracted: r.total_units_retracted || 0,
        totalRevenue: (r.total_units_sold || 0) * UNIT_PRICE,
        mg_sold: 0, plain_sold: 0, mg_retracted: 0, plain_retracted: 0,
        mg_revenue: 0, plain_revenue: 0,
      }))
      .sort((a, b) => b.totalSold - a.totalSold)
    setPartnerPerformance(shaped)
  }, [isDemo, dateRange, rankings])

  const variantTotals = variantData?.totals || null

  const variantSummary = useMemo(() => {
    if (!variantTotals) return null
    const mgThrough = variantTotals.multigrain.assigned > 0
      ? (variantTotals.multigrain.sold / variantTotals.multigrain.assigned) * 100
      : 0
    const plThrough = variantTotals.plain.assigned > 0
      ? (variantTotals.plain.sold / variantTotals.plain.assigned) * 100
      : 0
    const winner = variantTotals.multigrain.sold === variantTotals.plain.sold
      ? null
      : variantTotals.multigrain.sold > variantTotals.plain.sold
        ? VARIANTS.multigrain.short
        : VARIANTS.plain.short
    const totalSold = variantTotals.multigrain.sold + variantTotals.plain.sold
    return {
      mgThrough,
      plThrough,
      winner,
      mgPct: totalSold > 0 ? (variantTotals.multigrain.sold / totalSold) * 100 : 0,
      plPct: totalSold > 0 ? (variantTotals.plain.sold / totalSold) * 100 : 0,
    }
  }, [variantTotals])

  // --- Drill-down data (demo-only for now; live mode shows empty state) ----
  const drillPartners = useMemo(() => {
    if (!isDemo) return []
    const term = partnersFilter.search.trim().toLowerCase()
    const rows = demoDrilldownPartners()
    return term ? rows.filter((p) => p.name.toLowerCase().includes(term)) : rows
  }, [isDemo, partnersFilter, drilldownRefreshTick])

  const drillAssignments = useMemo(() => {
    if (!isDemo) return []
    return demoAssignments(assignedFilter)
  }, [isDemo, assignedFilter, drilldownRefreshTick])

  const drillSales = useMemo(() => {
    if (!isDemo) return []
    return demoSalesRecords(soldFilter)
  }, [isDemo, soldFilter, drilldownRefreshTick])

  const drillAttributions = useMemo(() => {
    if (!isDemo) return []
    return demoAttributions(attributedFilter)
  }, [isDemo, attributedFilter, drilldownRefreshTick])

  // Reset pagination whenever filters change.
  useEffect(() => { setAssignedPage(1) }, [assignedFilter])
  useEffect(() => { setSoldPage(1) }, [soldFilter])
  useEffect(() => { setAttributedPage(1) }, [attributedFilter])

  const partnerOptions = useMemo(() => {
    if (!isDemo) return []
    return [{ value: 'all', label: 'All partners' }, ...demoDrilldownPartnerOptions()]
  }, [isDemo])

  // Sold summary stats.
  const soldStats = useMemo(() => {
    if (drillSales.length === 0) return null
    const totalUnits = drillSales.reduce((s, r) => s + r.units, 0)
    const totalRevenue = drillSales.reduce((s, r) => s + r.revenue, 0)
    const avgDays = Math.round(drillSales.reduce((s, r) => s + r.days_to_sell, 0) / drillSales.length)
    const mgUnits = drillSales.filter((r) => r.variant === 'multigrain').reduce((s, r) => s + r.units, 0)
    const plUnits = drillSales.filter((r) => r.variant === 'plain').reduce((s, r) => s + r.units, 0)
    const mgRev = drillSales.filter((r) => r.variant === 'multigrain').reduce((s, r) => s + r.revenue, 0)
    const plRev = drillSales.filter((r) => r.variant === 'plain').reduce((s, r) => s + r.revenue, 0)
    return { totalUnits, totalRevenue, avgDays, mgUnits, plUnits, mgRev, plRev }
  }, [drillSales])

  // Attributed summary stats.
  const attributedStats = useMemo(() => {
    if (drillAttributions.length === 0) return null
    const totalUnits = drillAttributions.reduce((s, r) => s + r.units, 0)
    const lossValue = drillAttributions.reduce((s, r) => s + r.loss_value, 0)
    const byReason = {}
    for (const r of drillAttributions) {
      byReason[r.reason] = (byReason[r.reason] || 0) + r.units
    }
    const mostCommon = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]
    return {
      totalUnits,
      lossValue,
      byReason,
      mostCommon: mostCommon ? { reason: mostCommon[0], units: mostCommon[1] } : null,
    }
  }, [drillAttributions])

  // Toggle handler — clicking the same KPI again collapses the panel.
  const handleKpiClick = (key) => {
    setActiveKpi((cur) => (cur === key ? null : key))
    setDrilldownRefreshTick((t) => t + 1)
  }

  const handleDrilldownRefresh = () => {
    setDrilldownRefreshTick((t) => t + 1)
  }

  const formatPhoneNumber = (contact) => {
    if (!contact) return null
    return contact.replace(/[^\d+]/g, '')
  }

  const handleCallTrainer = (contact) => {
    const phoneNumber = formatPhoneNumber(contact)
    if (!phoneNumber) {
      alert('No contact number available for this partner')
      return
    }
    window.location.href = `tel:${phoneNumber}`
  }

  // -----------------------------------------------------------------------
  // Paginated slices
  // -----------------------------------------------------------------------
  const assignedPaged   = drillAssignments.slice((assignedPage - 1) * ROWS_PER_PAGE, assignedPage * ROWS_PER_PAGE)
  const soldPaged       = drillSales.slice((soldPage - 1) * ROWS_PER_PAGE, soldPage * ROWS_PER_PAGE)
  const attributedPaged = drillAttributions.slice((attributedPage - 1) * ROWS_PER_PAGE, attributedPage * ROWS_PER_PAGE)
  const assignedTotalPages   = Math.max(1, Math.ceil(drillAssignments.length / ROWS_PER_PAGE))
  const soldTotalPages       = Math.max(1, Math.ceil(drillSales.length / ROWS_PER_PAGE))
  const attributedTotalPages = Math.max(1, Math.ceil(drillAttributions.length / ROWS_PER_PAGE))

  // Totals row for the assignments table (sum of paged set's full result).
  const assignmentsTotal = useMemo(() => {
    const mg    = drillAssignments.reduce((s, a) => s + a.multigrain_assigned, 0)
    const plain = drillAssignments.reduce((s, a) => s + a.plain_assigned, 0)
    return { mg, plain, total: mg + plain }
  }, [drillAssignments])

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="dashboard-page !pt-2 sm:!pt-3 lg:!pt-4">
      <div className="relative z-10 mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center justify-between gap-4">
          <h1 className="dashboard-title">Overview</h1>
          <RefreshButton onRefresh={refresh} loading={refreshing} />
        </div>

        <div className="dashboard-panel flex items-center justify-between gap-4 rounded-2xl px-4 py-3 xl:max-w-md">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top contributor</p>
            <p className="mt-0.5 truncate font-display text-lg font-semibold tracking-[-0.03em] text-white">
              {summary.topPartner?.trainer_name || 'No activity yet'}
            </p>
          </div>
          <div className="flex-shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Sell-through</p>
            <p className="text-base font-semibold text-emerald-100">
              {summary.sellThrough.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* === Clickable KPI cards ============================================ */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Partners"
          value={kpiPartnersCount.toLocaleString()}
          subtitle={`${kpiActivePartners} active`}
          color="indigo"
          active={activeKpi === 'partners'}
          onClick={() => handleKpiClick('partners')}
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <KPICard
          title="Assigned"
          value={kpiAssigned.toLocaleString()}
          subtitle="Stock"
          color="amber"
          active={activeKpi === 'assigned'}
          onClick={() => handleKpiClick('assigned')}
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          }
        />
        <KPICard
          title="Sold"
          value={kpiSold.toLocaleString()}
          subtitle="Closed"
          color="emerald"
          active={activeKpi === 'sold'}
          onClick={() => handleKpiClick('sold')}
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 13l4 4L19 7" />
            </svg>
          }
        />
        <KPICard
          title="Attributed"
          value={kpiAttributed.toLocaleString()}
          subtitle="Returns / retracted"
          color="amber"
          active={activeKpi === 'attributed'}
          onClick={() => handleKpiClick('attributed')}
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h10a4 4 0 010 8h-2m-8-8l4-4m-4 4l4 4" />
            </svg>
          }
        />
      </div>

      {/* === Drill-down panels (slide-down animations via height transitions) === */}

      {activeKpi === 'partners' && (
        <DrilldownPanel
          title="Partners"
          subtitle={`${drillPartners.length} ${drillPartners.length === 1 ? 'partner' : 'partners'} shown`}
          onClose={() => setActiveKpi(null)}
          onRefresh={handleDrilldownRefresh}
        >
          {!isDemo ? (
            <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
              Partner drill-down is currently demo-only.
            </div>
          ) : (
            <>
              <div className="mb-4">
                <input
                  type="text"
                  value={partnersFilter.search}
                  onChange={(e) => setPartnersFilter({ search: e.target.value })}
                  placeholder="Search partner..."
                  className="dashboard-select !w-full sm:!w-64"
                />
              </div>
              {drillPartners.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No partners match this search.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {drillPartners.map((p) => (
                    <PartnerCard key={p.id} partner={p} onClick={setSelectedPartner} />
                  ))}
                </div>
              )}
            </>
          )}
        </DrilldownPanel>
      )}

      {activeKpi === 'assigned' && (
        <DrilldownPanel
          title="Assigned"
          subtitle={`${drillAssignments.length} assignment ${drillAssignments.length === 1 ? 'record' : 'records'}`}
          onClose={() => setActiveKpi(null)}
          onRefresh={handleDrilldownRefresh}
        >
          {!isDemo ? (
            <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
              Assignment drill-down is currently demo-only.
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select
                  value={assignedFilter.range}
                  onChange={(e) => setAssignedFilter({ ...assignedFilter, range: e.target.value })}
                  className="dashboard-select"
                  aria-label="Date range"
                >
                  {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={assignedFilter.variant}
                  onChange={(e) => setAssignedFilter({ ...assignedFilter, variant: e.target.value })}
                  className="dashboard-select"
                  aria-label="Variant"
                >
                  {VARIANT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {drillAssignments.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No assignments match these filters.
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="dashboard-table min-w-full">
                      <thead>
                        <tr>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Multi-Grain</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Plain</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignedPaged.map((a) => (
                          <tr key={a.id}>
                            <td className="px-3 py-2 font-semibold text-white">{a.partner_name}</td>
                            <td className="px-3 py-2 text-right text-emerald-200">{a.multigrain_assigned.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-amber-100">{a.plain_assigned.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-semibold text-white">{a.total.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-slate-400">{formatDateDDMMYY(a.date_assigned)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-white/[0.03]">
                          <td className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total</td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-300">{assignmentsTotal.mg.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-semibold text-amber-200">{assignmentsTotal.plain.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-semibold text-white">{assignmentsTotal.total.toLocaleString()}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile card list */}
                  <div className="space-y-2 md:hidden">
                    {assignedPaged.map((a) => (
                      <div key={a.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-white">{a.partner_name}</p>
                          <p className="text-xs text-slate-500">{formatDateDDMMYY(a.date_assigned)}</p>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">MG</p>
                            <p className="font-semibold text-emerald-200">{a.multigrain_assigned}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Plain</p>
                            <p className="font-semibold text-amber-100">{a.plain_assigned}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Total</p>
                            <p className="font-semibold text-white">{a.total}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Pagination page={assignedPage} totalPages={assignedTotalPages} onChange={setAssignedPage} />
                </>
              )}
            </>
          )}
        </DrilldownPanel>
      )}

      {activeKpi === 'sold' && (
        <DrilldownPanel
          title="Sold"
          subtitle={`${drillSales.length} sale ${drillSales.length === 1 ? 'record' : 'records'}`}
          onClose={() => setActiveKpi(null)}
          onRefresh={handleDrilldownRefresh}
        >
          {!isDemo ? (
            <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
              Sale drill-down is currently demo-only.
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select
                  value={soldFilter.range}
                  onChange={(e) => setSoldFilter({ ...soldFilter, range: e.target.value })}
                  className="dashboard-select"
                  aria-label="Date range"
                >
                  {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={soldFilter.variant}
                  onChange={(e) => setSoldFilter({ ...soldFilter, variant: e.target.value })}
                  className="dashboard-select"
                  aria-label="Variant"
                >
                  {VARIANT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={soldFilter.partnerId}
                  onChange={(e) => setSoldFilter({ ...soldFilter, partnerId: e.target.value })}
                  className="dashboard-select"
                  aria-label="Partner"
                >
                  {partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {soldStats && (
                <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <StatTile label="Units sold"   value={soldStats.totalUnits.toLocaleString()} color="emerald" />
                  <StatTile label="Revenue"      value={`₹${soldStats.totalRevenue.toLocaleString()}`} color="indigo" />
                  <StatTile label="Avg days"     value={`${soldStats.avgDays}d`} color="slate" />
                  <StatTile
                    label="Top variant"
                    value={soldStats.mgUnits >= soldStats.plUnits ? VARIANTS.multigrain.short : VARIANTS.plain.short}
                    color={soldStats.mgUnits >= soldStats.plUnits ? 'green' : 'cream'}
                  />
                </div>
              )}

              {drillSales.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No sales match these filters.
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="dashboard-table min-w-full">
                      <thead>
                        <tr>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Days to sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {soldPaged.map((r) => (
                          <tr key={r.id}>
                            <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                            <td className="px-3 py-2 font-semibold text-white">{r.partner_name}</td>
                            <td className="px-3 py-2 text-slate-300">{r.customer}</td>
                            <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-200">{r.units}</td>
                            <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{r.revenue.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-slate-400">{r.days_to_sell}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-2 md:hidden">
                    {soldPaged.map((r) => (
                      <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-white">{r.partner_name}</p>
                          <p className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">to {r.customer}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <VariantPill variant={r.variant} label={r.variant_label} />
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs font-semibold text-emerald-200">{r.units} units</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs font-mono text-indigo-200">₹{r.revenue.toLocaleString()}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-400">{r.days_to_sell}d to sell</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Pagination page={soldPage} totalPages={soldTotalPages} onChange={setSoldPage} />

                  {/* Variant breakdown summary */}
                  {soldStats && (
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <VariantBreakdownCard
                        variant="multigrain"
                        units={soldStats.mgUnits}
                        total={soldStats.totalUnits}
                        revenue={soldStats.mgRev}
                      />
                      <VariantBreakdownCard
                        variant="plain"
                        units={soldStats.plUnits}
                        total={soldStats.totalUnits}
                        revenue={soldStats.plRev}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </DrilldownPanel>
      )}

      {activeKpi === 'attributed' && (
        <DrilldownPanel
          title="Attributed"
          subtitle={`${drillAttributions.length} attribution ${drillAttributions.length === 1 ? 'record' : 'records'}`}
          onClose={() => setActiveKpi(null)}
          onRefresh={handleDrilldownRefresh}
        >
          {!isDemo ? (
            <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
              Attribution drill-down is currently demo-only.
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  value={attributedFilter.range}
                  onChange={(e) => setAttributedFilter({ ...attributedFilter, range: e.target.value })}
                  className="dashboard-select"
                  aria-label="Date range"
                >
                  {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={attributedFilter.variant}
                  onChange={(e) => setAttributedFilter({ ...attributedFilter, variant: e.target.value })}
                  className="dashboard-select"
                  aria-label="Variant"
                >
                  {VARIANT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={attributedFilter.partnerId}
                  onChange={(e) => setAttributedFilter({ ...attributedFilter, partnerId: e.target.value })}
                  className="dashboard-select"
                  aria-label="Partner"
                >
                  {partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={attributedFilter.reason}
                  onChange={(e) => setAttributedFilter({ ...attributedFilter, reason: e.target.value })}
                  className="dashboard-select"
                  aria-label="Reason"
                >
                  {REASON_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {attributedStats && (
                <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <StatTile label="Total units" value={attributedStats.totalUnits.toLocaleString()} color="amber" />
                  <StatTile label="Loss value"  value={`₹${attributedStats.lossValue.toLocaleString()}`} color="rose" />
                  <StatTile
                    label="Most common"
                    value={attributedStats.mostCommon
                      ? (ATTRIBUTION_REASONS.find((r) => r.value === attributedStats.mostCommon.reason)?.label || attributedStats.mostCommon.reason)
                      : '—'}
                    color="slate"
                  />
                  <StatTile label="Variants" value={`${Object.keys(attributedStats.byReason).length} reason${Object.keys(attributedStats.byReason).length === 1 ? '' : 's'}`} color="indigo" />
                </div>
              )}

              {/* Reason mini bars */}
              {attributedStats && (
                <div className="dashboard-subpanel mb-4 rounded-[20px] p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Breakdown by reason</p>
                  <div className="space-y-2">
                    {ATTRIBUTION_REASONS.map((r) => {
                      const units = attributedStats.byReason[r.value] || 0
                      const pct = attributedStats.totalUnits > 0 ? (units / attributedStats.totalUnits) * 100 : 0
                      const pill = REASON_PILL[r.value]
                      return (
                        <div key={r.value} className="flex items-center gap-3">
                          <span className={`inline-flex w-32 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.bg}`}>
                            {r.label}
                          </span>
                          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                              style={{ width: `${pct}%`, backgroundColor: pill.bg.includes('rose') ? '#f43f5e' : pill.bg.includes('orange') ? '#f97316' : pill.bg.includes('yellow') ? '#eab308' : pill.bg.includes('sky') ? '#0ea5e9' : '#64748b' }}
                            />
                          </div>
                          <span className="w-16 text-right text-xs text-slate-300">{units} ({pct.toFixed(0)}%)</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {drillAttributions.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No attributions match these filters.
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="dashboard-table min-w-full">
                      <thead>
                        <tr>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                          <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reason</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</th>
                          <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attributedPaged.map((r) => {
                          const expanded = expandedAttrNote === r.id
                          const showNote = r.notes
                          return (
                            <tr key={r.id}>
                              <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                              <td className="px-3 py-2 font-semibold text-white">{r.partner_name}</td>
                              <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                              <td className="px-3 py-2 text-right font-semibold text-amber-200">{r.units}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason]?.bg || REASON_PILL.other.bg}`}>
                                  {r.reason_label}
                                </span>
                              </td>
                              <td className="px-3 py-2 max-w-[200px] text-slate-400">
                                {showNote ? (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedAttrNote(expanded ? null : r.id)}
                                    className={`text-left ${expanded ? 'whitespace-normal text-slate-200' : 'block truncate'}`}
                                    title={r.notes}
                                  >
                                    {r.notes}
                                  </button>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-300">{r.attributed_by}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-2 md:hidden">
                    {attributedPaged.map((r) => (
                      <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-white">{r.partner_name}</p>
                          <p className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <VariantPill variant={r.variant} label={r.variant_label} />
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason]?.bg || REASON_PILL.other.bg}`}>
                            {r.reason_label}
                          </span>
                          <span className="text-xs font-semibold text-amber-200">{r.units} units</span>
                        </div>
                        {r.notes && <p className="mt-2 text-xs text-slate-400">{r.notes}</p>}
                        <p className="mt-1 text-[11px] text-slate-500">by {r.attributed_by}</p>
                      </div>
                    ))}
                  </div>

                  <Pagination page={attributedPage} totalPages={attributedTotalPages} onChange={setAttributedPage} />
                </>
              )}
            </>
          )}
        </DrilldownPanel>
      )}

      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.92fr)]">
        <PartnerPerformanceSection
          data={partnerPerformance}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />

        <div>
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Rank</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                Top partners
              </h2>
            </div>

            <div className="space-y-3">
              {topRankings.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No partner data available yet.
                </div>
              ) : (
                topRankings.map((trainer, index) => (
                  <div key={trainer.trainer_id} className="dashboard-subpanel flex items-center gap-4 rounded-[24px] px-4 py-3.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">{trainer.trainer_name}</p>
                      <p className="truncate text-xs text-slate-500">{trainer.trainer_contact || 'No contact added'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-100">
                        {trainer.total_units_sold.toLocaleString()} sold
                      </p>
                      <p className="text-xs text-slate-500">
                        {trainer.total_units_assigned.toLocaleString()} assigned
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {variantTotals && (
        <div className="mb-8">
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <span className="text-lg">📊</span>
                <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">Variant Performance</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: VARIANTS.multigrain.short, color: ACCENT_GREEN, totals: variantTotals.multigrain, through: variantSummary?.mgThrough || 0 },
                  { label: VARIANTS.plain.short, color: ACCENT_CREAM, totals: variantTotals.plain, through: variantSummary?.plThrough || 0 },
                ].map((v) => (
                  <div key={v.label} className="dashboard-subpanel rounded-[20px] p-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: v.color }} />
                      <p className="text-sm font-semibold text-white">{v.label}</p>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Assigned</span>
                        <span className="font-semibold text-white">{v.totals.assigned.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Sold</span>
                        <span className="font-semibold text-emerald-300">{v.totals.sold.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Sell-through</span>
                        <span className="font-semibold text-white">{v.through.toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Revenue</span>
                        <span className="font-mono font-semibold text-indigo-200">₹{v.totals.revenue.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {variantSummary?.winner && (
                <div className="mt-4 flex items-center justify-center gap-2 rounded-[16px] border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200">
                  Winner: {variantSummary.winner} 🏆
                </div>
              )}
            </section>

        </div>
      )}

      {/* Partner profile peek modal (opened from Partners drill-down) */}
      <Modal
        isOpen={!!selectedPartner}
        onClose={() => setSelectedPartner(null)}
        title={selectedPartner?.name || 'Partner'}
      >
        {selectedPartner && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#024628] font-display text-lg font-bold text-[#FBF3D4]">
                {selectedPartner.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{selectedPartner.name}</p>
                <p className="text-xs text-slate-400">📞 {selectedPartner.phone}</p>
                <span className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${selectedPartner.status === 'active' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
                  {selectedPartner.status === 'active' ? '🟢 Active' : '🟡 Inactive'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="dashboard-subpanel rounded-[16px] p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Sold</p>
                <p className="mt-1 text-lg font-semibold text-emerald-200">{selectedPartner.sold}</p>
              </div>
              <div className="dashboard-subpanel rounded-[16px] p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Attributed</p>
                <p className="mt-1 text-lg font-semibold text-amber-200">{selectedPartner.attributed}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCallTrainer(selectedPartner.phone)}
                className="flex-1 rounded-full border border-emerald-300/16 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/16"
              >
                Call
              </button>
              <button
                type="button"
                onClick={() => setSelectedPartner(null)}
                className="flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isAddTrainerModalOpen}
        onClose={handleCloseTrainerModal}
        title={editingTrainerId ? 'Edit Partner' : 'Add New Partner'}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleSaveTrainer()
          }}
        >
          <FormField
            label="Partner Name"
            value={trainerFormData.name}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, name: value })}
            placeholder="Enter partner name"
            required
          />
          <FormField
            label="Contact"
            value={trainerFormData.contact}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, contact: value })}
            placeholder="Enter contact number or email"
          />
          <FormField
            label="Joining Date"
            type="date"
            value={trainerFormData.joining_date}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, joining_date: value })}
          />
          <FormField
            label="Notes"
            type="textarea"
            value={trainerFormData.notes}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, notes: value })}
            placeholder="Add context or reminders for this partner"
          />

          <div className="mt-6 flex gap-3">
            {editingTrainerId && (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this partner? This action cannot be undone.')) {
                    await handleDeleteTrainer(editingTrainerId)
                    handleCloseTrainerModal()
                  }
                }}
                className="dashboard-button inline-flex border border-rose-300/18 bg-rose-400/12 px-4 py-2 text-rose-100"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseTrainerModal}
              className="dashboard-button dashboard-button-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="dashboard-button dashboard-button-primary flex-1"
            >
              {editingTrainerId ? 'Update' : 'Add'} Partner
            </button>
          </div>
        </form>
      </Modal>

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

// ===========================================================================
// Helper sub-components used by drill-down panels
// ===========================================================================
function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}

function StatTile({ label, value, color }) {
  const colors = {
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
    indigo: 'text-indigo-200',
    rose: 'text-rose-200',
    slate: 'text-slate-200',
    green: 'text-emerald-200',
    cream: 'text-[#FBF3D4]',
  }
  return (
    <div className="dashboard-subpanel rounded-[16px] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${colors[color] || 'text-white'}`}>{value}</p>
    </div>
  )
}

function VariantPill({ variant, label }) {
  const isPlain = variant === 'plain'
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${isPlain ? 'border-[#FBF3D4]/30 bg-[#FBF3D4]/12 text-[#FBF3D4]' : 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100'}`}
    >
      {label}
    </span>
  )
}

function VariantBreakdownCard({ variant, units, total, revenue }) {
  const isPlain = variant === 'plain'
  const label = isPlain ? VARIANTS.plain.short : VARIANTS.multigrain.short
  const pct = total > 0 ? (units / total) * 100 : 0
  const winner = pct > 50
  return (
    <div className="dashboard-subpanel rounded-[20px] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: isPlain ? ACCENT_CREAM : ACCENT_GREEN }} />
          <p className="font-semibold text-white">{label}</p>
        </div>
        {winner && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">Winner 🏆</span>}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Units sold</span>
          <span className="font-semibold text-emerald-200">{units.toLocaleString()} <span className="text-slate-500">({pct.toFixed(0)}%)</span></span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Revenue</span>
          <span className="font-mono font-semibold text-indigo-200">₹{revenue.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

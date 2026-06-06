import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import KPICard from '../components/KPICard'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { supabase } from '../lib/supabase'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import { useAuth } from '../context/AuthContext'
import {
  demoBlock,
  demoTrainers,
  demoRankings,
  demoVariantTotals,
  demoVariantByPartner,
  demoPartnerPerformance,
  demoDrilldownTotals,
  VARIANTS,
} from '../lib/demoData'
import { Pagination } from '../components/drilldown/Shared'

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

// Aggregate raw sales rows into per-variant totals + per-partner breakdown.
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
// PartnerPerformanceSection — independently-scrolling list of partners,
// each rendered as two CSS bars (sold = green, retracted = red).
// ===========================================================================
function PartnerPerformanceSection({ data, dateRange, onDateRangeChange }) {
  const [hover, setHover] = useState(null)

  const maxSold = useMemo(
    () => data.reduce((m, p) => Math.max(m, p.totalSold || 0), 0),
    [data],
  )
  const maxRetracted = useMemo(
    () => data.reduce((m, p) => Math.max(m, p.totalRetracted || 0), 0),
    [data],
  )

  return (
    <section className="dashboard-panel flex flex-col overflow-hidden rounded-[32px] p-5 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Performance</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-slate-100">
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
          className="max-h-[400px] overflow-y-auto overscroll-contain pr-1 scroll-smooth"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#024628 #F0EBE3' }}
        >
          {data.map((p) => {
            const soldPct = maxSold > 0 ? (p.totalSold / maxSold) * 100 : 0
            const retPct = maxRetracted > 0 ? (p.totalRetracted / maxRetracted) * 100 : 0
            const soldHovered = hover?.id === p.id && hover.kind === 'sold'
            const retHovered = hover?.id === p.id && hover.kind === 'retracted'

            return (
              <div key={p.id} className="relative border-b border-[#E8E0D4] py-2">
                <p className="mb-1 text-[12px] font-semibold text-[#1A2B1F] sm:text-[13px]">{p.name}</p>

                <div
                  className="relative mb-1 h-4 w-full overflow-hidden rounded bg-[#F0EBE3] sm:h-5"
                  onMouseEnter={() => setHover({ id: p.id, kind: 'sold' })}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className="flex h-full items-center rounded px-2 text-[10px] font-semibold text-[#fbf3d4] transition-[width] duration-500 ease-out sm:text-[11px]"
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

                <div
                  className="relative h-4 w-full overflow-hidden rounded bg-[#F0EBE3] sm:h-5"
                  onMouseEnter={() => setHover({ id: p.id, kind: 'retracted' })}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className="flex h-full items-center rounded px-2 text-[10px] font-semibold text-[#fbf3d4] transition-[width] duration-500 ease-out sm:text-[11px]"
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
                  <div className="pointer-events-none absolute right-2 top-[-6px] z-10 -translate-y-full rounded-lg border border-[#E8E0D4] bg-white px-3 py-2 text-xs shadow-[0_8px_24px_rgba(2,70,40,0.18)]">
                    <p className="font-semibold text-[#1A2B1F]">
                      {p.name}{retHovered ? ' — Retracted' : ''}
                    </p>
                    {soldHovered ? (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-[#5C6D62]">
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Total Sold</span>
                          <span>{p.totalSold} units</span>
                        </div>
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Revenue</span>
                          <span className="text-[#34d399]">₹{p.totalRevenue.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-[#5C6D62]">
                        <div className="flex justify-between gap-6">
                          <span className="text-[#7c8a9a]">Total Retracted</span>
                          <span>{p.totalRetracted} units</span>
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
// TopPartnersSection — independent-scrolling rank list, 20 per page,
// each row navigates to /admin/partner/:id.
// ===========================================================================
const RANK_PER_PAGE = 20
function TopPartnersSection({ rankings }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [rankings])

  const totalPages = Math.max(1, Math.ceil(rankings.length / RANK_PER_PAGE))
  const paged = rankings.slice((page - 1) * RANK_PER_PAGE, page * RANK_PER_PAGE)

  return (
    <section className="dashboard-panel flex flex-col overflow-hidden rounded-[32px] p-5 sm:p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Rank</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-slate-100">Top partners</h2>
      </div>

      {paged.length === 0 ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No partner data available yet.
        </div>
      ) : (
        <div
          className="max-h-[400px] space-y-2.5 overflow-y-auto overscroll-contain pr-1 scroll-smooth"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#024628 #F0EBE3' }}
        >
          {paged.map((trainer, index) => {
            const absIdx = (page - 1) * RANK_PER_PAGE + index
            return (
              <button
                key={trainer.trainer_id || index}
                type="button"
                onClick={() => navigate(`/admin/partner/${trainer.trainer_id || ''}`)}
                className="dashboard-subpanel flex w-full items-center gap-4 rounded-[24px] px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-[#F0EBE3]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#F0EBE3] text-sm font-semibold text-slate-100">
                  {absIdx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-100">{trainer.trainer_name}</p>
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
              </button>
            )
          })}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </section>
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

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchData(), { auto: true })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    if (isDemo) {
      setTrainers(demoTrainers())
      setRankings(demoRankings())
      setVariantData({ totals: demoVariantTotals(), byPartner: demoVariantByPartner() })
      setLoading(false)
      return
    }
    try {
      // Partners — select('*') avoids unknown-column errors.
      let partnersData = []
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'partner')
          .order('full_name', { ascending: true, nullsFirst: false })
        if (error) throw error
        partnersData = data || []
      } catch (err) {
        console.warn('Partners query failed:', err.message)
      }

      // Sales — isolated so a failure here still leaves the partner list usable.
      let salesData = []
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('trainer_id, units_assigned, units_sold, retracted_units')
        if (error) throw error
        salesData = data || []
      } catch (err) {
        console.warn('Sales query failed:', err.message)
      }

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
        return { ...row, rank: currentRank }
      })

      setTrainers(normalizedPartners)
      setRankings(rankingsData || [])

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

  const handleDeleteTrainer = async (id) => {
    if (isDemo) return demoBlock()
    if (!confirm('Are you sure you want to delete this partner? This action cannot be undone.')) return
    try {
      const trainer = trainers.find((item) => item.id === id)
      const { error } = await supabase.from('profiles').delete().eq('role', 'partner').eq('id', id)
      if (error) throw error
      const oldTrainerDelVals = trainer ? { name: trainer.name, contact: trainer.contact, notes: trainer.notes, created_at: trainer.created_at } : null
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: id,
        description: createAuditDescription('DELETE', 'user', { name: trainer?.name }, null, oldTrainerDelVals, null),
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
    if (!trainerFormData.name.trim()) { alert('Please enter a partner name'); return }
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
        const oldTrainerUpdVals = editingTrainerData ? {
          full_name: editingTrainerData.name,
          phone_number: editingTrainerData.contact,
          notes: editingTrainerData.notes,
          created_at: editingTrainerData.created_at,
        } : null
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
          description: createAuditDescription('UPDATE', 'user', { name: trainerFormData.name.trim() }, null, oldTrainerUpdVals, newTrainerUpdVals),
          oldValues: oldTrainerUpdVals,
          newValues: newTrainerUpdVals,
        })
      } else {
        alert('Create new partners from the Partners page.')
        return
      }
      setTrainerFormData({ name: '', contact: '', notes: '', joining_date: new Date().toISOString().split('T')[0] })
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
    setTrainerFormData({ name: '', contact: '', notes: '', joining_date: new Date().toISOString().split('T')[0] })
  }

  const summary = useMemo(() => {
    const totalUnitsAssigned = rankings.reduce((sum, ranking) => sum + (ranking.total_units_assigned || 0), 0)
    const totalUnitsSold = rankings.reduce((sum, ranking) => sum + (ranking.total_units_sold || 0), 0)
    const totalUnitsRetracted = rankings.reduce((sum, ranking) => sum + (ranking.total_units_retracted || 0), 0)
    const activePartners = rankings.filter((ranking) => (ranking.total_units_sold || 0) > 0).length
    const sellThrough = totalUnitsAssigned > 0 ? (totalUnitsSold / totalUnitsAssigned) * 100 : 0
    const topPartner = rankings[0] || null
    return { totalUnitsAssigned, totalUnitsSold, totalUnitsRetracted, activePartners, sellThrough, topPartner }
  }, [rankings])

  // Demo drill-down totals — used when live numbers haven't been wired yet.
  const drilldownTotals = useMemo(() => (isDemo ? demoDrilldownTotals({ range: 'all' }) : null), [isDemo])

  const kpiPartnersCount = drilldownTotals?.partners ?? trainers.length
  const kpiAssigned      = drilldownTotals?.assigned ?? summary.totalUnitsAssigned
  const kpiSold          = drilldownTotals?.sold ?? summary.totalUnitsSold
  const kpiAttributed    = drilldownTotals?.attributed ?? summary.totalUnitsRetracted
  const kpiActivePartners = drilldownTotals?.activePartners ?? summary.activePartners

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
    return { mgThrough, plThrough, winner }
  }, [variantTotals])

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
            <p className="mt-0.5 truncate font-display text-lg font-semibold tracking-[-0.03em] text-slate-100">
              {summary.topPartner?.trainer_name || 'No activity yet'}
            </p>
          </div>
          <div className="flex-shrink-0 rounded-full border border-[#E8E0D4] bg-[#F0EBE3] px-3 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Sell-through</p>
            <p className="text-base font-semibold text-[#024628]">
              {summary.sellThrough.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* Linked KPI cards — each opens a dedicated drill-down page */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Link to="/admin/overview/partners">
          <KPICard
            title="Partners"
            value={kpiPartnersCount.toLocaleString()}
            subtitle={`${kpiActivePartners} active · View →`}
            color="indigo"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
        </Link>
        <Link to="/admin/overview/assigned">
          <KPICard
            title="Assigned"
            value={kpiAssigned.toLocaleString()}
            subtitle="Stock · View →"
            color="amber"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
              </svg>
            }
          />
        </Link>
        <Link to="/admin/overview/sold">
          <KPICard
            title="Sold"
            value={kpiSold.toLocaleString()}
            subtitle="Closed · View →"
            color="emerald"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 13l4 4L19 7" />
              </svg>
            }
          />
        </Link>
        <Link to="/admin/overview/attributed">
          <KPICard
            title="Retracted"
            value={kpiAttributed.toLocaleString()}
            subtitle="Pulled back · View →"
            color="amber"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h10a4 4 0 010 8h-2m-8-8l4-4m-4 4l4 4" />
              </svg>
            }
          />
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PartnerPerformanceSection
          data={partnerPerformance}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />
        <TopPartnersSection rankings={rankings} />
      </div>

      {/* Variant comparison — each card is a Link to /admin/overview/variant/:key */}
      {variantTotals && (
        <div className="mb-8">
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <span className="text-lg" aria-hidden>📊</span>
              <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-slate-100 sm:text-2xl">Variant Performance</h2>
              <span className="ml-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tap a variant</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { key: 'multigrain', label: VARIANTS.multigrain.short, color: ACCENT_GREEN, totals: variantTotals.multigrain, through: variantSummary?.mgThrough || 0 },
                { key: 'plain',      label: VARIANTS.plain.short,      color: ACCENT_CREAM, totals: variantTotals.plain,      through: variantSummary?.plThrough || 0 },
              ].map((v) => (
                <Link
                  key={v.key}
                  to={`/admin/overview/variant/${v.key}`}
                  className="dashboard-subpanel block rounded-[20px] p-4 transition hover:-translate-y-0.5 hover:bg-[#F0EBE3]"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: v.color }} />
                    <p className="text-sm font-semibold text-slate-100">{v.label}</p>
                    <span className="ml-auto text-[11px] font-semibold text-slate-500">View →</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Assigned</span>
                      <span className="font-semibold text-slate-100">{v.totals.assigned.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Sold</span>
                      <span className="font-semibold text-emerald-300">{v.totals.sold.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Sell-through</span>
                      <span className="font-semibold text-slate-100">{v.through.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Revenue</span>
                      <span className="font-mono font-semibold text-indigo-200">₹{v.totals.revenue.toLocaleString()}</span>
                    </div>
                  </div>
                </Link>
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

      <Modal
        isOpen={isAddTrainerModalOpen}
        onClose={handleCloseTrainerModal}
        title={editingTrainerId ? 'Edit Partner' : 'Add New Partner'}
      >
        <form onSubmit={(event) => { event.preventDefault(); handleSaveTrainer() }}>
          <FormField label="Partner Name" value={trainerFormData.name}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, name: value })}
            placeholder="Enter partner name" required />
          <FormField label="Contact" value={trainerFormData.contact}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, contact: value })}
            placeholder="Enter contact number or email" />
          <FormField label="Joining Date" type="date" value={trainerFormData.joining_date}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, joining_date: value })} />
          <FormField label="Notes" type="textarea" value={trainerFormData.notes}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, notes: value })}
            placeholder="Add context or reminders for this partner" />
          <div className="mt-6 flex gap-3">
            {editingTrainerId && (
              <button type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this partner? This action cannot be undone.')) {
                    await handleDeleteTrainer(editingTrainerId)
                    handleCloseTrainerModal()
                  }
                }}
                className="dashboard-button inline-flex border border-rose-300/18 bg-rose-400/12 px-4 py-2 text-rose-100">
                Delete
              </button>
            )}
            <button type="button" onClick={handleCloseTrainerModal} className="dashboard-button dashboard-button-secondary flex-1">Cancel</button>
            <button type="submit" className="dashboard-button dashboard-button-primary flex-1">{editingTrainerId ? 'Update' : 'Add'} Partner</button>
          </div>
        </form>
      </Modal>

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

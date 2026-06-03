import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
  demoVariantTrend,
  VARIANTS,
} from '../lib/demoData'

const UNIT_PRICE = 100
// Brand-led pie/series gradient: Foundation Green → Grain Cream.
const chartPalette = ['#024628', '#035c36', '#0a7a4a', '#3f9e6e', '#8fbf9f', '#FBF3D4']
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

function ShareTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload
  if (!row) return null

  const total = payload[0]?.payload?.__total || 0
  const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0'

  return (
    <div className="rounded-lg border border-[#1e2d3d] bg-[#1a2332] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      <p className="font-semibold text-[#f1f5f9]">{row.name}</p>
      <p className="mt-2 text-sm text-[#cbd5e1]">
        {row.value.toLocaleString()} sold · {pct}%
      </p>
    </div>
  )
}

// Pie tooltip for the variant split — units + share + revenue.
function VariantShareTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const total = row.__total || 0
  const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0'
  const price = row.name === VARIANTS.plain.short ? VARIANTS.plain.price : VARIANTS.multigrain.price
  return (
    <div className="rounded-lg border border-[#1e2d3d] bg-[#1a2332] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      <p className="font-semibold text-[#f1f5f9]">{row.name}</p>
      <p className="mt-2 text-sm text-[#cbd5e1]">{row.value.toLocaleString()} sold · {pct}%</p>
      <p className="mt-0.5 text-sm text-[#34d399]">₹{(row.value * price).toLocaleString()}</p>
    </div>
  )
}

// Generic multi-series tooltip for the per-partner bar chart + trend line.
function VariantSeriesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[#1e2d3d] bg-[#1a2332] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      <p className="font-semibold text-[#f1f5f9]">{label}</p>
      <div className="mt-2 space-y-1.5 text-sm text-[#cbd5e1]">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span style={{ color: p.color }}>{p.name}</span>
            <span>{(p.value || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
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

export default function Sales() {
  const { isDemo } = useAuth()
  const [trainers, setTrainers] = useState([])
  const [rankings, setRankings] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('all')
  const [partnerPerformance, setPartnerPerformance] = useState([])
  const [variantData, setVariantData] = useState(null)
  const [variantTrend, setVariantTrend] = useState([])
  const [variantSort, setVariantSort] = useState({ field: 'revenue', dir: 'desc' })
  const [isAddTrainerModalOpen, setIsAddTrainerModalOpen] = useState(false)
  const [editingTrainerId, setEditingTrainerId] = useState(null)
  const [editingTrainerData, setEditingTrainerData] = useState(null)
  const [trainerFormData, setTrainerFormData] = useState({
    name: '',
    contact: '',
    notes: '',
    joining_date: new Date().toISOString().split('T')[0],
  })

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
        .select('trainer_id, units_assigned, units_sold')

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
          }
        }

        totalsByPartner[partnerId].total_units_assigned += sale.units_assigned || 0
        totalsByPartner[partnerId].total_units_sold += sale.units_sold || 0
      }

      const rankingBase = normalizedPartners.map((partner) => {
        const totals = totalsByPartner[partner.id] || { total_units_assigned: 0, total_units_sold: 0 }

        return {
          trainer_id: partner.id,
          trainer_name: partner.name,
          trainer_contact: partner.contact,
          total_units_assigned: totals.total_units_assigned,
          total_units_sold: totals.total_units_sold,
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

  const trainerStatsMap = useMemo(() => {
    const map = {}

    rankings.forEach((ranking) => {
      map[ranking.trainer_id] = {
        totalUnits: ranking.total_units_assigned || 0,
        totalRevenue: (ranking.total_units_sold || 0) * UNIT_PRICE,
      }
    })

    return map
  }, [rankings])

  const summary = useMemo(() => {
    const totalUnitsAssigned = rankings.reduce((sum, ranking) => sum + (ranking.total_units_assigned || 0), 0)
    const totalUnitsSold = rankings.reduce((sum, ranking) => sum + (ranking.total_units_sold || 0), 0)
    const totalRevenue = totalUnitsSold * UNIT_PRICE
    const activePartners = rankings.filter((ranking) => (ranking.total_units_sold || 0) > 0).length
    const sellThrough = totalUnitsAssigned > 0 ? (totalUnitsSold / totalUnitsAssigned) * 100 : 0
    const topPartner = rankings[0] || null

    return {
      totalUnitsAssigned,
      totalUnitsSold,
      totalRevenue,
      activePartners,
      sellThrough,
      topPartner,
    }
  }, [rankings])

  const topRankings = useMemo(() => rankings.slice(0, 6), [rankings])

  const contributionData = useMemo(() => {
    const sold = topRankings.filter((partner) => (partner.total_units_sold || 0) > 0)
    const total = sold.reduce((sum, p) => sum + (p.total_units_sold || 0), 0)
    return sold.map((partner, index) => ({
      name: partner.trainer_name,
      value: partner.total_units_sold || 0,
      fill: chartPalette[index % chartPalette.length],
      __total: total,
    }))
  }, [topRankings])

  // --- Variant analytics derived data ---------------------------------------
  // Trend follows the date-range dropdown (demo provides synthetic series).
  useEffect(() => {
    setVariantTrend(isDemo ? demoVariantTrend(dateRange) : [])
  }, [isDemo, dateRange])

  // Partner Performance chart data. Demo mode scales all-time numbers by the
  // selected date range; live mode derives a minimal shape from rankings
  // (no per-variant or retracted breakdown — tooltip just shows totals).
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
        totalRetracted: 0,
        totalRevenue: (r.total_units_sold || 0) * UNIT_PRICE,
        mg_sold: 0, plain_sold: 0, mg_retracted: 0, plain_retracted: 0,
        mg_revenue: 0, plain_revenue: 0,
      }))
      .sort((a, b) => b.totalSold - a.totalSold)
    setPartnerPerformance(shaped)
  }, [isDemo, dateRange, rankings])

  const variantTotals = variantData?.totals || null

  const variantPie = useMemo(() => {
    if (!variantTotals) return []
    const mg = variantTotals.multigrain.sold
    const pl = variantTotals.plain.sold
    const total = mg + pl
    return [
      { name: VARIANTS.multigrain.short, value: mg, fill: ACCENT_GREEN, __total: total },
      { name: VARIANTS.plain.short, value: pl, fill: ACCENT_CREAM, __total: total },
    ]
  }, [variantTotals])

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

  const variantByPartner = useMemo(() => {
    const rows = variantData?.byPartner || []
    const dir = variantSort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (variantSort.field === 'partner') return a.partner.localeCompare(b.partner) * dir
      return ((a[variantSort.field] || 0) - (b[variantSort.field] || 0)) * dir
    })
  }, [variantData, variantSort])

  const bestRevenue = useMemo(
    () => Math.max(0, ...(variantData?.byPartner || []).map((r) => r.revenue || 0)),
    [variantData],
  )

  const toggleVariantSort = (field) => {
    setVariantSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' },
    )
  }

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

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Partners"
          value={trainers.length.toLocaleString()}
          subtitle={`${summary.activePartners} active`}
          color="indigo"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <KPICard
          title="Assigned"
          value={summary.totalUnitsAssigned.toLocaleString()}
          subtitle="Stock"
          color="amber"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          }
        />
        <KPICard
          title="Sold"
          value={summary.totalUnitsSold.toLocaleString()}
          subtitle="Closed"
          color="emerald"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 13l4 4L19 7" />
            </svg>
          }
        />
        <KPICard
          title="Revenue"
          value={`₹${summary.totalRevenue.toLocaleString()}`}
          subtitle="₹100/unit"
          color="purple"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2m7-4a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.92fr)]">
        <PartnerPerformanceSection
          data={partnerPerformance}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />

        <div className="space-y-6">
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Share</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                  Sales share
                </h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Top 6
              </div>
            </div>

            {contributionData.length > 0 ? (
              <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                <div className="mx-auto h-[200px] w-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip content={<ShareTooltip />} />
                      <Pie
                        data={contributionData}
                        dataKey="value"
                        innerRadius={54}
                        outerRadius={82}
                        paddingAngle={4}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {contributionData.map((entry, index) => (
                          <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3">
                  {contributionData.map((entry, index) => (
                    <div key={entry.name} className="dashboard-subpanel flex items-center justify-between rounded-[22px] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
                        <span className="text-sm font-semibold text-slate-200">
                          {entry.name.length > 18 ? `${entry.name.slice(0, 18)}...` : entry.name}
                        </span>
                      </div>
                      <span className="text-sm text-slate-400">{entry.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                No data yet.
              </div>
            )}
          </section>

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

      {/* ===================== VARIANT ANALYTICS ===================== */}
      {variantTotals && (
        <div className="mb-8 space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            {/* 3A — Variant comparison card */}
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

            {/* 3B — Sales by Variant pie */}
            <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Share</p>
                <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">Sales by Variant</h2>
              </div>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<VariantShareTooltip />} />
                    <Pie data={variantPie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={4} stroke="none" isAnimationActive={false}>
                      {variantPie.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-center text-sm font-semibold text-slate-300">
                <span style={{ color: ACCENT_GREEN }}>●</span> {VARIANTS.multigrain.short} {variantSummary ? variantSummary.mgPct.toFixed(0) : 0}%
                <span className="mx-2 text-slate-600">|</span>
                <span className="text-[#FBF3D4]">●</span> {VARIANTS.plain.short} {variantSummary ? variantSummary.plPct.toFixed(0) : 0}%
              </p>
            </section>
          </div>

          {/* 3C — Variant performance by partner (grouped bars) */}
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">By partner</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">Variant Performance by Partner</h2>
            </div>
            <div className="-mx-1 overflow-x-auto px-1">
              <div className="h-[220px] min-w-[480px] md:h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={variantByPartner} barGap={6} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#1e2d3d" />
                    <XAxis dataKey="partner" axisLine={false} tickLine={false} stroke="#7c8a9a" fontSize={11} interval={0} tickFormatter={(value) => (value?.length > 10 ? `${value.slice(0, 10)}...` : value)} />
                    <YAxis axisLine={false} tickLine={false} stroke="#7c8a9a" fontSize={11} allowDecimals={false} />
                    <Tooltip content={<VariantSeriesTooltip />} cursor={{ fill: 'rgba(2,70,40,0.08)' }} />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: 12, fontSize: 12, color: '#7c8a9a' }} />
                    <Bar name={VARIANTS.multigrain.short} dataKey="mg_sold" radius={[6, 6, 0, 0]} fill={ACCENT_GREEN} maxBarSize={22} animationDuration={500} />
                    <Bar name={VARIANTS.plain.short} dataKey="plain_sold" radius={[6, 6, 0, 0]} fill={ACCENT_CREAM} maxBarSize={22} animationDuration={500} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* 3D — Variant sales over time (trend line) */}
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Trend</p>
                <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">Variant Sales Over Time</h2>
              </div>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="dashboard-select !w-auto"
                aria-label="Trend date range"
              >
                {DATE_RANGES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {variantTrend.length > 0 ? (
              <div className="-mx-1 overflow-x-auto px-1">
                <div className="h-[200px] min-w-[480px] md:h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={variantTrend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#1e2d3d" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} stroke="#7c8a9a" fontSize={11} />
                      <YAxis axisLine={false} tickLine={false} stroke="#7c8a9a" fontSize={11} allowDecimals={false} />
                      <Tooltip content={<VariantSeriesTooltip />} />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 12, fontSize: 12, color: '#7c8a9a' }} />
                      <Line name={VARIANTS.multigrain.short} type="monotone" dataKey="multigrain" stroke={ACCENT_GREEN} strokeWidth={2} dot={{ r: 3, fill: ACCENT_GREEN }} animationDuration={500} />
                      <Line name={VARIANTS.plain.short} type="monotone" dataKey="plain" stroke={ACCENT_CREAM} strokeWidth={2} dot={{ r: 3, fill: ACCENT_CREAM }} animationDuration={500} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="dashboard-subpanel flex h-[200px] items-center justify-center rounded-[24px] text-sm text-slate-400">
                No trend data yet
              </div>
            )}
          </section>

          {/* 3E — Detailed variant breakdown table */}
          <section className="dashboard-panel overflow-hidden rounded-[32px]">
            <div className="border-b border-white/8 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Breakdown</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">Variant Detail by Partner</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    {[
                      { key: 'partner', label: 'Partner', align: 'left' },
                      { key: 'mg_assigned', label: 'MG Assigned', align: 'right' },
                      { key: 'mg_sold', label: 'MG Sold', align: 'right' },
                      { key: 'mg_pct', label: 'MG %', align: 'right', noSort: true },
                      { key: 'plain_assigned', label: 'Plain Assigned', align: 'right' },
                      { key: 'plain_sold', label: 'Plain Sold', align: 'right' },
                      { key: 'plain_pct', label: 'Plain %', align: 'right', noSort: true },
                      { key: 'revenue', label: 'Revenue', align: 'right' },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => !col.noSort && toggleVariantSort(col.key)}
                        className={`border-b border-white/8 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.noSort ? '' : 'cursor-pointer select-none hover:text-slate-300'}`}
                      >
                        {col.label}
                        {variantSort.field === col.key && (variantSort.dir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {variantByPartner.map((row) => {
                    const mgPct = row.mg_assigned > 0 ? ((row.mg_sold / row.mg_assigned) * 100).toFixed(0) : '0'
                    const plPct = row.plain_assigned > 0 ? ((row.plain_sold / row.plain_assigned) * 100).toFixed(0) : '0'
                    const isBest = bestRevenue > 0 && row.revenue === bestRevenue
                    return (
                      <tr key={row.partner} className={isBest ? 'bg-emerald-400/8' : ''}>
                        <td className="px-3 py-2 font-semibold text-white">{row.partner}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{row.mg_assigned.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-200">{row.mg_sold.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{mgPct}%</td>
                        <td className="px-3 py-2 text-right text-slate-300">{row.plain_assigned.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-100">{row.plain_sold.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{plPct}%</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${isBest ? 'text-emerald-300' : 'text-indigo-200'}`}>₹{row.revenue.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                  {variantByPartner.length === 0 && (
                    <tr>
                      <td colSpan="8" className="px-6 py-10 text-center text-sm text-slate-500">No variant data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <section className="dashboard-panel mb-8 overflow-hidden rounded-[32px]">
        <div className="flex flex-col gap-3 border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">List</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">Partners</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-400">
            {trainers.length} partner{trainers.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="dashboard-table min-w-full">
            <thead>
              <tr>
                <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Partner</th>
                <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Joined</th>
                <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Units</th>
                <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Revenue</th>
                <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Notes</th>
                <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trainers.map((trainer) => {
                const stats = trainerStatsMap[trainer.id] || { totalUnits: 0, totalRevenue: 0 }

                return (
                  <tr key={trainer.id}>
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-semibold text-white">{trainer.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{trainer.contact || 'No contact added'}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-400">
                      {trainer.created_at ? formatDateDDMMYY(trainer.created_at) : 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold text-emerald-100">
                      {stats.totalUnits.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold text-indigo-100">
                      ₹{stats.totalRevenue.toLocaleString()}
                    </td>
                    <td className="max-w-md px-3 py-2 text-sm text-slate-400">
                      <span className="block truncate">{trainer.notes || 'No notes added'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {trainer.contact && (
                          <button
                            onClick={() => handleCallTrainer(trainer.contact)}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-300/16 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/16"
                            title={`Call ${trainer.contact}`}
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            Call
                          </button>
                        )}
                        <button
                          onClick={() => handleEditTrainer(trainer)}
                          className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08]"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {trainers.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-6 py-10 text-center text-sm text-slate-500">
                    No partners yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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

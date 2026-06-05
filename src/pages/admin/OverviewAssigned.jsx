import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  demoAssignments,
  demoDrilldownPartnerOptions,
  DRILLDOWN_RANGES,
  VARIANTS,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import { PageHeader, StatTile, Pagination, FadeIn, downloadCsv } from '../../components/drilldown/Shared'

const VARIANT_OPTIONS = [
  { value: 'all', label: 'All variants' },
  { value: 'multigrain', label: 'Multi-Grain' },
  { value: 'plain', label: 'Plain' },
]
const ROWS_PER_PAGE = 20

// Live date-range filter (mirrors demoData's withinRange but anchored to the
// real "now" instead of the fixed demo date). Range values come from
// DRILLDOWN_RANGES.
function withinRangeReal(value, range) {
  if (range === 'all' || !value) return true
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return true
  const diff = (Date.now() - d.getTime()) / 86400000
  switch (range) {
    case 'today':     return diff < 1
    case 'week':      return diff <= 7
    case 'month':     return diff <= 30
    case 'lastmonth': return diff > 30 && diff <= 60
    case '3m':        return diff <= 90
    case '6m':        return diff <= 180
    case 'year':      return diff <= 365
    default:          return true
  }
}

// Shape live `sales` rows into the same per-assignment objects demoAssignments
// returns. Total uses units_assigned so the page matches the Overview ASSIGNED
// card (which sums units_assigned); the Multi-Grain/Plain split reads the
// per-variant columns and falls back to product_variant so the two buckets
// always sum to the row total.
function shapeLiveAssignments(salesRows, nameById) {
  return (salesRows || [])
    .map((s) => {
      const assigned = s.units_assigned || 0
      let mg = s.multigrain_assigned || 0
      let plain = s.plain_assigned || 0
      if (mg + plain === 0 && assigned > 0) {
        const isPlain = s.product_variant === VARIANTS.plain.name
        if (isPlain) plain = assigned
        else mg = assigned
      }
      return {
        id: s.id,
        partner_id: s.trainer_id,
        partner_name: nameById[s.trainer_id] || 'Unknown',
        multigrain_assigned: mg,
        plain_assigned: plain,
        total: mg + plain,
        date_assigned: s.date_of_assignment || s.created_at,
      }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => new Date(b.date_assigned) - new Date(a.date_assigned))
}

export default function OverviewAssigned() {
  const { isDemo } = useAuth()
  const [filter, setFilter] = useState({ range: 'all', variant: 'all', partnerId: 'all' })
  const [page, setPage] = useState(1)
  const [tick, setTick] = useState(0)
  const [liveRows, setLiveRows] = useState([])
  const [livePartners, setLivePartners] = useState([])
  const [loading, setLoading] = useState(!isDemo)

  useEffect(() => { setPage(1) }, [filter])

  // Live fetch — same anon `supabase` client + `sales` table the Overview
  // ASSIGNED card uses, so the totals line up. Re-runs on manual refresh.
  useEffect(() => {
    if (isDemo) return
    let active = true
    setLoading(true)
    ;(async () => {
      let partnersData = []
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('role', 'partner')
        if (error) throw error
        partnersData = data || []
      } catch (err) {
        console.warn('Assigned: partners query failed:', err.message)
      }

      let salesData = []
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('id, trainer_id, units_assigned, multigrain_assigned, plain_assigned, product_variant, date_of_assignment, created_at')
        if (error) throw error
        salesData = data || []
      } catch (err) {
        console.warn('Assigned: sales query failed:', err.message)
      }

      if (!active) return
      const nameById = {}
      for (const p of partnersData) nameById[p.id] = p.full_name || p.email || 'N/A'
      setLivePartners(
        partnersData
          .map((p) => ({ value: p.id, label: p.full_name || p.email || 'N/A' }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
      setLiveRows(shapeLiveAssignments(salesData, nameById))
      setLoading(false)
    })()
    return () => { active = false }
  }, [isDemo, tick])

  const partnerOptions = useMemo(
    () => isDemo
      ? [{ value: 'all', label: 'All partners' }, ...demoDrilldownPartnerOptions()]
      : [{ value: 'all', label: 'All partners' }, ...livePartners],
    [isDemo, livePartners],
  )

  const rows = useMemo(() => {
    let out
    if (isDemo) {
      out = demoAssignments({ range: filter.range, variant: filter.variant })
    } else {
      // Apply the same range + variant filtering the demo adapter does.
      out = liveRows
        .filter((r) => withinRangeReal(r.date_assigned, filter.range))
        .map((r) => {
          let mg = r.multigrain_assigned
          let plain = r.plain_assigned
          if (filter.variant === 'multigrain') plain = 0
          if (filter.variant === 'plain') mg = 0
          return { ...r, multigrain_assigned: mg, plain_assigned: plain, total: mg + plain }
        })
        .filter((r) => r.total > 0)
    }
    if (filter.partnerId === 'all') return out
    return out.filter((r) => r.partner_id === filter.partnerId)
  }, [isDemo, liveRows, filter, tick])

  const totals = useMemo(() => {
    const mg    = rows.reduce((s, a) => s + a.multigrain_assigned, 0)
    const plain = rows.reduce((s, a) => s + a.plain_assigned, 0)
    return { mg, plain, total: mg + plain }
  }, [rows])

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))
  const paged = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)

  const exportCsv = () => {
    downloadCsv(`assignments-${Date.now()}.csv`, rows, [
      { key: 'date_assigned', label: 'Date', value: (r) => formatDateDDMMYY(r.date_assigned) },
      { key: 'partner_name', label: 'Partner' },
      { key: 'multigrain_assigned', label: 'Multi-Grain' },
      { key: 'plain_assigned', label: 'Plain' },
      { key: 'total', label: 'Total' },
    ])
  }

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview"
        backLabel="Overview"
        title="Assigned"
        subtitle={`${rows.length} assignment ${rows.length === 1 ? 'record' : 'records'}`}
        onRefresh={() => setTick((t) => t + 1)}
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-full border border-[#E8E0D4] bg-[#F0EBE3] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-[#ECE5DA] disabled:opacity-50"
          >
            Export CSV
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select value={filter.range} onChange={(e) => setFilter({ ...filter, range: e.target.value })} className="dashboard-select" aria-label="Date range">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.variant} onChange={(e) => setFilter({ ...filter, variant: e.target.value })} className="dashboard-select" aria-label="Variant">
          {VARIANT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.partnerId} onChange={(e) => setFilter({ ...filter, partnerId: e.target.value })} className="dashboard-select" aria-label="Partner">
          {partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatTile label="Total assigned" value={totals.total.toLocaleString()} color="indigo" />
        <StatTile label="Multi-Grain"    value={totals.mg.toLocaleString()} color="emerald" />
        <StatTile label="Plain"          value={totals.plain.toLocaleString()} color="cream" />
      </div>

      {loading ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          Loading assignments…
        </div>
      ) : rows.length === 0 ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No assignments match these filters.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead className="sticky top-0 bg-[#F0EBE3]">
                <tr>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Multi-Grain</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Plain</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(a.date_assigned)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-100">
                      <Link to={`/admin/partner/${a.partner_id}`} className="hover:text-emerald-200">{a.partner_name}</Link>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-200">{a.multigrain_assigned.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-amber-100">{a.plain_assigned.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-100">{a.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F0EBE3]">
                  <td colSpan={2} className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-300">{totals.mg.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-200">{totals.plain.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-100">{totals.total.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="space-y-2 md:hidden">
            {paged.map((a) => (
              <div key={a.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                <div className="flex items-center justify-between">
                  <Link to={`/admin/partner/${a.partner_id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{a.partner_name}</Link>
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
                    <p className="font-semibold text-slate-100">{a.total}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </FadeIn>
  )
}

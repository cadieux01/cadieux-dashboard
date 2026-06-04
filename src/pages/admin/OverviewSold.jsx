import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  demoSalesRecords,
  demoDrilldownPartnerOptions,
  DRILLDOWN_RANGES,
  VARIANTS,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import { PageHeader, StatTile, Pagination, FadeIn, VariantPill, downloadCsv } from '../../components/drilldown/Shared'

const VARIANT_OPTIONS = [
  { value: 'all', label: 'All variants' },
  { value: 'multigrain', label: 'Multi-Grain' },
  { value: 'plain', label: 'Plain' },
]
const ROWS_PER_PAGE = 20

const ACCENT_GREEN = '#024628'
const ACCENT_CREAM = '#FBF3D4'

export default function OverviewSold() {
  const { isDemo } = useAuth()
  const [filter, setFilter] = useState({ range: 'all', variant: 'all', partnerId: 'all' })
  const [page, setPage] = useState(1)
  const [tick, setTick] = useState(0)

  useEffect(() => { setPage(1) }, [filter])

  const partnerOptions = useMemo(
    () => isDemo ? [{ value: 'all', label: 'All partners' }, ...demoDrilldownPartnerOptions()] : [],
    [isDemo],
  )

  const rows = useMemo(() => {
    if (!isDemo) return []
    return demoSalesRecords(filter)
  }, [isDemo, filter, tick])

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const totalUnits = rows.reduce((s, r) => s + r.units, 0)
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
    const avgDays = Math.round(rows.reduce((s, r) => s + r.days_to_sell, 0) / rows.length)
    const mgUnits = rows.filter((r) => r.variant === 'multigrain').reduce((s, r) => s + r.units, 0)
    const plUnits = rows.filter((r) => r.variant === 'plain').reduce((s, r) => s + r.units, 0)
    const mgRev   = rows.filter((r) => r.variant === 'multigrain').reduce((s, r) => s + r.revenue, 0)
    const plRev   = rows.filter((r) => r.variant === 'plain').reduce((s, r) => s + r.revenue, 0)
    return { totalUnits, totalRevenue, avgDays, mgUnits, plUnits, mgRev, plRev }
  }, [rows])

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))
  const paged = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)

  const exportCsv = () => {
    downloadCsv(`sales-${Date.now()}.csv`, rows, [
      { key: 'date', label: 'Date', value: (r) => formatDateDDMMYY(r.date) },
      { key: 'partner_name', label: 'Partner' },
      { key: 'customer', label: 'Customer' },
      { key: 'variant_label', label: 'Variant' },
      { key: 'units', label: 'Units' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'days_to_sell', label: 'Days to sell' },
    ])
  }

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview"
        backLabel="Overview"
        title="Sold"
        subtitle={`${rows.length} sale ${rows.length === 1 ? 'record' : 'records'}`}
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

      {stats && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label="Units sold"  value={stats.totalUnits.toLocaleString()} color="emerald" />
            <StatTile label="Revenue"     value={`₹${stats.totalRevenue.toLocaleString()}`} color="indigo" />
            <StatTile label="Avg days"    value={`${stats.avgDays}d`} color="slate" />
            <StatTile
              label="Top variant"
              value={stats.mgUnits >= stats.plUnits ? VARIANTS.multigrain.short : VARIANTS.plain.short}
              color={stats.mgUnits >= stats.plUnits ? 'green' : 'cream'}
            />
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VariantBreakdownCard variant="multigrain" units={stats.mgUnits} total={stats.totalUnits} revenue={stats.mgRev} />
            <VariantBreakdownCard variant="plain" units={stats.plUnits} total={stats.totalUnits} revenue={stats.plRev} />
          </div>
        </>
      )}

      {!isDemo ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No data yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No sales match these filters.
        </div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead className="sticky top-0 bg-[#F0EBE3]">
                <tr>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Days</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-100">
                      <Link to={`/admin/partner/${r.partner_id}`} className="hover:text-emerald-200">{r.partner_name}</Link>
                    </td>
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

          <div className="space-y-2 md:hidden">
            {paged.map((r) => (
              <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                <div className="flex items-center justify-between">
                  <Link to={`/admin/partner/${r.partner_id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{r.partner_name}</Link>
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

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </FadeIn>
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
          <p className="font-semibold text-slate-100">{label}</p>
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

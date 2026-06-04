import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  demoAttributions,
  demoDrilldownPartnerOptions,
  DRILLDOWN_RANGES,
  ATTRIBUTION_REASONS,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import {
  PageHeader,
  StatTile,
  Pagination,
  FadeIn,
  VariantPill,
  ReasonBars,
  REASON_PILL,
  downloadCsv,
} from '../../components/drilldown/Shared'

const VARIANT_OPTIONS = [
  { value: 'all', label: 'All variants' },
  { value: 'multigrain', label: 'Multi-Grain' },
  { value: 'plain', label: 'Plain' },
]
const REASON_FILTER_OPTIONS = [{ value: 'all', label: 'All reasons' }, ...ATTRIBUTION_REASONS]
const ROWS_PER_PAGE = 20

export default function OverviewAttributed() {
  const { isDemo } = useAuth()
  const [filter, setFilter] = useState({ range: 'all', variant: 'all', partnerId: 'all', reason: 'all' })
  const [page, setPage] = useState(1)
  const [tick, setTick] = useState(0)
  const [expandedNote, setExpandedNote] = useState(null)

  useEffect(() => { setPage(1) }, [filter])

  const partnerOptions = useMemo(
    () => isDemo ? [{ value: 'all', label: 'All partners' }, ...demoDrilldownPartnerOptions()] : [],
    [isDemo],
  )

  const rows = useMemo(() => {
    if (!isDemo) return []
    return demoAttributions(filter)
  }, [isDemo, filter, tick])

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const totalUnits = rows.reduce((s, r) => s + r.units, 0)
    const lossValue = rows.reduce((s, r) => s + r.loss_value, 0)
    const byReason = {}
    for (const r of rows) byReason[r.reason] = (byReason[r.reason] || 0) + r.units
    const mostCommon = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]
    return {
      totalUnits,
      lossValue,
      byReason,
      mostCommon: mostCommon ? { reason: mostCommon[0], units: mostCommon[1] } : null,
    }
  }, [rows])

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))
  const paged = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)

  const exportCsv = () => {
    downloadCsv(`attributions-${Date.now()}.csv`, rows, [
      { key: 'date', label: 'Date', value: (r) => formatDateDDMMYY(r.date) },
      { key: 'partner_name', label: 'Partner' },
      { key: 'variant_label', label: 'Variant' },
      { key: 'units', label: 'Units' },
      { key: 'reason_label', label: 'Reason' },
      { key: 'notes', label: 'Notes' },
      { key: 'attributed_by', label: 'Attributed By' },
    ])
  }

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview"
        backLabel="Overview"
        title="Attributed"
        subtitle={`${rows.length} attribution ${rows.length === 1 ? 'record' : 'records'}`}
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select value={filter.range} onChange={(e) => setFilter({ ...filter, range: e.target.value })} className="dashboard-select" aria-label="Date range">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.variant} onChange={(e) => setFilter({ ...filter, variant: e.target.value })} className="dashboard-select" aria-label="Variant">
          {VARIANT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.partnerId} onChange={(e) => setFilter({ ...filter, partnerId: e.target.value })} className="dashboard-select" aria-label="Partner">
          {partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.reason} onChange={(e) => setFilter({ ...filter, reason: e.target.value })} className="dashboard-select" aria-label="Reason">
          {REASON_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {stats && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label="Total units"  value={stats.totalUnits.toLocaleString()} color="amber" />
            <StatTile label="Loss value"   value={`₹${stats.lossValue.toLocaleString()}`} color="rose" />
            <StatTile
              label="Most common"
              value={stats.mostCommon
                ? (ATTRIBUTION_REASONS.find((r) => r.value === stats.mostCommon.reason)?.label || stats.mostCommon.reason)
                : '—'}
              color="slate"
            />
            <StatTile label="Distinct reasons" value={`${Object.keys(stats.byReason).length}`} color="indigo" />
          </div>

          <div className="mb-4">
            <ReasonBars counts={stats.byReason} reasons={ATTRIBUTION_REASONS} total={stats.totalUnits} />
          </div>
        </>
      )}

      {!isDemo ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No data yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No attributions match these filters.
        </div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead className="sticky top-0 bg-[#F0EBE3]">
                <tr>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reason</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">By</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const expanded = expandedNote === r.id
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                      <td className="px-3 py-2 font-semibold text-slate-100">
                        <Link to={`/admin/partner/${r.partner_id}`} className="hover:text-emerald-200">{r.partner_name}</Link>
                      </td>
                      <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-200">{r.units}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>
                          {r.reason_label}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[200px] text-slate-400">
                        {r.notes ? (
                          <button
                            type="button"
                            onClick={() => setExpandedNote(expanded ? null : r.id)}
                            className={`text-left ${expanded ? 'whitespace-normal text-slate-200' : 'block truncate'}`}
                            title={r.notes}
                          >
                            {r.notes}
                          </button>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{r.attributed_by}</td>
                    </tr>
                  )
                })}
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <VariantPill variant={r.variant} label={r.variant_label} />
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>
                    {r.reason_label}
                  </span>
                  <span className="text-xs font-semibold text-amber-200">{r.units} units</span>
                </div>
                {r.notes && <p className="mt-2 text-xs text-slate-400">{r.notes}</p>}
                <p className="mt-1 text-[11px] text-slate-500">by {r.attributed_by}</p>
              </div>
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </FadeIn>
  )
}

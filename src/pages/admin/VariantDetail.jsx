import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  demoVariantDetail,
  DRILLDOWN_RANGES,
  ATTRIBUTION_REASONS,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import {
  PageHeader,
  StatTile,
  FadeIn,
  ReasonBars,
  MonthlyLineChart,
} from '../../components/drilldown/Shared'

export default function VariantDetail() {
  const { variantName } = useParams()
  const { isDemo } = useAuth()
  const [range, setRange] = useState('all')
  const [tick, setTick] = useState(0)

  const detail = useMemo(() => {
    if (!isDemo) return null
    return demoVariantDetail(variantName, { range })
  }, [isDemo, variantName, range, tick])

  if (!isDemo) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/overview" backLabel="Overview" title="Variant" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          Variant detail is currently demo-only.
        </div>
      </FadeIn>
    )
  }

  if (!detail) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/overview" backLabel="Overview" title="Variant not found" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No variant with key "{variantName}".
        </div>
      </FadeIn>
    )
  }

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview"
        backLabel="Overview"
        title={detail.name}
        subtitle={`₹${detail.price}/unit`}
        onRefresh={() => setTick((t) => t + 1)}
      />

      <div className="mb-4">
        <label className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="dashboard-select inline-block !w-auto">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Key metrics */}
      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatTile label="Assigned"      value={detail.totals.assigned.toLocaleString()} color="indigo" />
        <StatTile label="Sold"          value={detail.totals.sold.toLocaleString()} color="emerald" />
        <StatTile label="Retracted"     value={detail.totals.retracted.toLocaleString()} color="rose" />
        <StatTile label="Revenue"       value={`₹${detail.totals.revenue.toLocaleString()}`} color="indigo" />
        <StatTile label="Sell-through"  value={`${detail.totals.sellThrough.toFixed(0)}%`} color="slate" />
        <StatTile label="Days in market" value={`${detail.totals.daysInMarket}d`} color="slate" />
      </div>

      {/* Top partners */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top partners</h2>
        {detail.topPartners.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No partner data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead>
                <tr>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Assigned</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sold</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Retracted</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                  <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {detail.topPartners.map((p) => (
                  <tr key={p.partner_id}>
                    <td className="px-3 py-2 font-semibold text-slate-100">
                      <Link to={`/admin/partner/${p.partner_id}`} className="hover:text-emerald-200">{p.partner_name}</Link>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{p.assigned.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-200">{p.sold.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-amber-200">{p.retracted.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{p.revenue.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{p.sellThrough.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Monthly sales timeline */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sales timeline</h2>
        <MonthlyLineChart data={detail.monthly} />
      </section>

      {/* Attribution breakdown */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attribution breakdown</h2>
        {Object.keys(detail.reasonCounts).length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No returns recorded for this variant.</div>
        ) : (
          <ReasonBars
            counts={detail.reasonCounts}
            reasons={ATTRIBUTION_REASONS}
            total={detail.totals.retracted}
          />
        )}
      </section>

      {/* Recent sales */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent sales</h2>
        {detail.recentSales.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No sales yet.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                    <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                    <th className="border-b border-[#E8E0D4] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</th>
                    <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                    <th className="border-b border-[#E8E0D4] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentSales.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(s.date)}</td>
                      <td className="px-3 py-2 font-semibold text-slate-100">
                        <Link to={`/admin/partner/${s.partner_id}`} className="hover:text-emerald-200">{s.partner_name}</Link>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{s.customer}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{s.units}</td>
                      <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{s.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 md:hidden">
              {detail.recentSales.map((s) => (
                <div key={s.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <Link to={`/admin/partner/${s.partner_id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{s.partner_name}</Link>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(s.date)}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">to {s.customer}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs font-semibold text-emerald-200">{s.units} units</span>
                    <span className="text-xs font-mono text-indigo-200">₹{s.revenue.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </FadeIn>
  )
}

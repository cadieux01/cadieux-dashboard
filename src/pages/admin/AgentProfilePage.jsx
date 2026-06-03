import { useMemo, useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { demoAgentProfile, DRILLDOWN_RANGES, DIVERSION_REASONS } from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import {
  PageHeader,
  StatTile,
  Pagination,
  FadeIn,
  VariantPill,
  MonthlyLineChart,
} from '../../components/drilldown/Shared'

const ROWS_PER_PAGE = 10

const DIVERSION_LABEL = Object.fromEntries(DIVERSION_REASONS.map((r) => [r.value, r.label]))

const DIVERSION_PILL = {
  food_stalls: 'border-orange-400/30 bg-orange-400/10 text-orange-200',
  b2b:         'border-blue-400/30 bg-blue-400/10 text-blue-200',
  disposed:    'border-rose-400/30 bg-rose-400/10 text-rose-200',
  other:       'border-slate-500/30 bg-slate-500/10 text-slate-300',
}

const ACTIVITY_ICON = {
  sold:      { emoji: '✅', color: 'text-emerald-300' },
  assigned:  { emoji: '📦', color: 'text-indigo-300' },
  retracted: { emoji: '↩️', color: 'text-amber-300' },
}

export default function AgentProfilePage() {
  const { id } = useParams()
  const { isDemo } = useAuth()
  const [range, setRange] = useState('all')
  const [tick, setTick] = useState(0)
  const [partnerPage, setPartnerPage] = useState(1)
  const [divPage, setDivPage] = useState(1)

  useEffect(() => { setPartnerPage(1); setDivPage(1) }, [range, id])

  const profile = useMemo(() => {
    if (!isDemo) return null
    return demoAgentProfile(id, { range })
  }, [isDemo, id, range, tick])

  if (!isDemo) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team?view=agents" backLabel="Team" title="Agent profile" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          Agent profile is currently demo-only.
        </div>
      </FadeIn>
    )
  }

  if (!profile) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team?view=agents" backLabel="Team" title="Agent not found" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No agent with id "{id}".
        </div>
      </FadeIn>
    )
  }

  const active = profile.status === 'active'

  const partnerTotalPages = Math.max(1, Math.ceil(profile.partnerPerformance.length / ROWS_PER_PAGE))
  const partnerPaged = profile.partnerPerformance.slice((partnerPage - 1) * ROWS_PER_PAGE, partnerPage * ROWS_PER_PAGE)

  const divTotalPages = Math.max(1, Math.ceil(profile.diversions.length / ROWS_PER_PAGE))
  const divPaged = profile.diversions.slice((divPage - 1) * ROWS_PER_PAGE, divPage * ROWS_PER_PAGE)

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/team?view=agents"
        backLabel="Team"
        title={profile.name}
        subtitle={`📞 ${profile.phone} · joined ${profile.joined_at ? formatDateDDMMYY(profile.joined_at) : 'N/A'}`}
        onRefresh={() => setTick((t) => t + 1)}
      />

      {/* Action bar */}
      <div className="mb-4 flex flex-wrap gap-2">
        <a href={`tel:${profile.phone}`} className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20">📞 Call</a>
        <a href={`sms:${profile.phone}`} className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-400/20">💬 Message</a>
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold ${active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
          {active ? '🟢 Active' : '🟡 Inactive'}
        </span>
      </div>

      {/* Period selector */}
      <div className="mb-4">
        <label className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="dashboard-select inline-block !w-auto">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* KPI tiles */}
      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Partners"  value={profile.totals.partners.toLocaleString()} color="indigo" />
        <StatTile label="Assigned"  value={profile.totals.assigned.toLocaleString()} color="slate" />
        <StatTile label="Sold"      value={profile.totals.sold.toLocaleString()} color="emerald" />
        <StatTile label="Revenue"   value={`₹${profile.totals.revenue.toLocaleString()}`} color="indigo" />
      </div>

      {/* Today's activity */}
      {profile.todayActivity.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today's Activity</h2>
          <div className="dashboard-subpanel rounded-[22px] divide-y divide-white/[0.04]">
            {profile.todayActivity.map((ev, i) => {
              const ai = ACTIVITY_ICON[ev.action] || ACTIVITY_ICON.other
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-base">{ai.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-white">{ev.partner_name}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {ev.action === 'sold' ? 'sold' : ev.action === 'assigned' ? 'received' : 'returned'}
                      {' '}<span className={`font-semibold ${ai.color}`}>{ev.units}</span>
                      {' '}{ev.variant === 'multigrain' ? 'MG' : 'Plain'}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 flex-shrink-0">{ev.time}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Partners under this agent */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Partners · {profile.partnerPerformance.length}
        </h2>
        {profile.partnerPerformance.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No partners in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Assigned</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sold</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ret.</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sell-thru</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerPaged.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <div>
                          <Link to={`/admin/partner/${p.id}`} className="font-semibold text-white hover:text-emerald-200">{p.name}</Link>
                          <p className="text-[11px] text-slate-500">📞 {p.phone}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-white">{p.assigned}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{p.sold}</td>
                      <td className="px-3 py-2 text-right text-amber-200">{p.retracted}</td>
                      <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{p.revenue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{p.sellThrough}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {partnerPaged.map((p) => (
                <div key={p.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <a href={`/dashboard/admin/partner/${p.id}`} className="font-semibold text-white hover:text-emerald-200">{p.name}</a>
                    <span className={`text-xs font-semibold ${p.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {p.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500">Assigned: <span className="font-semibold text-white">{p.assigned}</span></span>
                    <span className="text-slate-500">Sold: <span className="font-semibold text-emerald-300">{p.sold}</span></span>
                    <span className="text-slate-500">Ret: <span className="font-semibold text-amber-300">{p.retracted}</span></span>
                    <span className="text-slate-500">Rev: <span className="font-mono font-semibold text-indigo-200">₹{p.revenue.toLocaleString()}</span></span>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={partnerPage} totalPages={partnerTotalPages} onChange={setPartnerPage} />
          </>
        )}
      </section>

      {/* Variant breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VariantBreakdownCard data={profile.variants.multigrain} />
        <VariantBreakdownCard data={profile.variants.plain} />
      </div>

      {/* Diversion / retraction tracking */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Diversion Tracking</h2>
        {profile.diversions.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No diversions in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Partner</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Diverted To</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {divPaged.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(d.date)}</td>
                      <td className="px-3 py-2 font-semibold text-white">{d.partner_name}</td>
                      <td className="px-3 py-2"><VariantPill variant={d.variant} label={d.variant === 'multigrain' ? 'MG' : 'Plain'} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-200">{d.units}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${DIVERSION_PILL[d.diverted_to] || DIVERSION_PILL.other}`}>
                          {DIVERSION_LABEL[d.diverted_to] || d.diverted_to}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[220px] truncate text-slate-400" title={d.notes}>{d.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {divPaged.map((d) => (
                <div key={d.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{d.partner_name}</p>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(d.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VariantPill variant={d.variant} label={d.variant === 'multigrain' ? 'MG' : 'Plain'} />
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${DIVERSION_PILL[d.diverted_to] || DIVERSION_PILL.other}`}>
                      {DIVERSION_LABEL[d.diverted_to] || d.diverted_to}
                    </span>
                    <span className="text-xs font-semibold text-amber-200">{d.units} units</span>
                  </div>
                  {d.notes && <p className="mt-1 text-xs text-slate-400">{d.notes}</p>}
                </div>
              ))}
            </div>
            <Pagination page={divPage} totalPages={divTotalPages} onChange={setDivPage} />
          </>
        )}
      </section>

      {/* Monthly performance chart */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Monthly performance</h2>
        <MonthlyLineChart data={profile.monthly} />
      </section>
    </FadeIn>
  )
}

function VariantBreakdownCard({ data }) {
  const isPlain = data.key === 'plain'
  return (
    <div className="dashboard-subpanel rounded-[20px] p-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: isPlain ? '#FBF3D4' : '#024628' }} />
        <p className="font-semibold text-white">{data.label}</p>
        <span className="ml-auto text-xs text-slate-500">₹{data.price}/unit</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Row label="Assigned"  value={data.assigned}  className="text-white" />
        <Row label="Sold"      value={data.sold}      className="text-emerald-200" />
        <Row label="Left"      value={Math.max(0, data.assigned - data.sold - data.retracted)} className="text-slate-200" />
        <Row label="Retracted" value={data.retracted} className="text-rose-200" />
      </div>
      <div className="mt-3 flex justify-between text-sm">
        <span className="text-slate-400">Sell-through</span>
        <span className="font-semibold text-white">{data.sellThrough.toFixed(0)}%</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">Revenue</span>
        <span className="font-mono font-semibold text-indigo-200">₹{data.revenue.toLocaleString()}</span>
      </div>
    </div>
  )
}

function Row({ label, value, className }) {
  return (
    <div className="rounded-[12px] bg-white/[0.04] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-semibold ${className}`}>{value.toLocaleString()}</p>
    </div>
  )
}

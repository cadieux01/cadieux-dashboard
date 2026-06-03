import { useMemo, useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { demoPartnerProfile, demoCTAData, DRILLDOWN_RANGES } from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import { getAssignmentStatus, timeRemaining, timeLabel, SHELF_LIFE } from '../../lib/shelfLife'
import {
  PageHeader,
  Pagination,
  FadeIn,
  VariantPill,
  REASON_PILL,
  MonthlyLineChart,
} from '../../components/drilldown/Shared'

const ROWS_PER_PAGE = 10

export default function PartnerProfile() {
  const { id } = useParams()
  const { isDemo } = useAuth()
  const [range, setRange] = useState('all')
  const [tick, setTick] = useState(0)
  const [salesPage, setSalesPage] = useState(1)
  const [attrPage, setAttrPage] = useState(1)

  useEffect(() => { setSalesPage(1); setAttrPage(1) }, [range, id])

  const profile = useMemo(() => {
    if (!isDemo) return null
    return demoPartnerProfile(id, { range })
  }, [isDemo, id, range, tick])

  if (!isDemo) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/overview/partners" backLabel="Partners" title="Partner profile" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          Partner profile is currently demo-only.
        </div>
      </FadeIn>
    )
  }

  if (!profile) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/overview/partners" backLabel="Partners" title="Partner not found" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No partner with id "{id}".
        </div>
      </FadeIn>
    )
  }

  const initial = profile.name.charAt(0).toUpperCase()
  const active = profile.status === 'active'

  const salesTotalPages = Math.max(1, Math.ceil(profile.salesHistory.length / ROWS_PER_PAGE))
  const salesPaged = profile.salesHistory.slice((salesPage - 1) * ROWS_PER_PAGE, salesPage * ROWS_PER_PAGE)

  const attrTotalPages = Math.max(1, Math.ceil(profile.attributionHistory.length / ROWS_PER_PAGE))
  const attrPaged = profile.attributionHistory.slice((attrPage - 1) * ROWS_PER_PAGE, attrPage * ROWS_PER_PAGE)

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview/partners"
        backLabel="Partners"
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

      <div className="mb-4">
        <label className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="dashboard-select inline-block !w-auto">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Variant breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VariantBreakdownCard data={profile.variants.multigrain} />
        <VariantBreakdownCard data={profile.variants.plain} />
      </div>

      {/* Current stock — shelf life status */}
      {isDemo && <CurrentStockSection partnerId={id} />}

      {/* Monthly performance chart */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Monthly performance</h2>
        <MonthlyLineChart data={profile.monthly} />
      </section>

      {/* Sales history */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sales history</h2>
        {profile.salesHistory.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No sales yet.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {salesPaged.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(s.date)}</td>
                      <td className="px-3 py-2"><VariantPill variant={s.variant} label={s.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{s.units}</td>
                      <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{s.revenue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-300">{s.customer}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{s.days_to_sell}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {salesPaged.map((s) => (
                <div key={s.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{s.customer}</p>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(s.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VariantPill variant={s.variant} label={s.variant_label} />
                    <span className="text-xs font-semibold text-emerald-200">{s.units} units</span>
                    <span className="text-xs font-mono text-indigo-200">₹{s.revenue.toLocaleString()}</span>
                    <span className="text-xs text-slate-400">{s.days_to_sell}d</span>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={salesPage} totalPages={salesTotalPages} onChange={setSalesPage} />
          </>
        )}
      </section>

      {/* Attribution history */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attribution history</h2>
        {profile.attributionHistory.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No attributions yet.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Variant</th>
                    <th className="border-b border-white/8 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reason</th>
                    <th className="border-b border-white/8 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {attrPaged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                      <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-200">{r.units}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>
                          {r.reason_label}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[280px] truncate text-slate-400" title={r.notes}>
                        {r.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {attrPaged.map((r) => (
                <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <VariantPill variant={r.variant} label={r.variant_label} />
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>
                      {r.reason_label}
                    </span>
                    <span className="text-xs font-semibold text-amber-200">{r.units} units</span>
                  </div>
                  {r.notes && <p className="mt-2 text-xs text-slate-400">{r.notes}</p>}
                </div>
              ))}
            </div>
            <Pagination page={attrPage} totalPages={attrTotalPages} onChange={setAttrPage} />
          </>
        )}
      </section>
    </FadeIn>
  )
}

const STATUS_DOT = {
  active:        'bg-emerald-400',
  expiring_soon: 'bg-amber-400',
  expired:       'bg-rose-400',
}
const STATUS_TEXT = {
  active:        'text-emerald-200',
  expiring_soon: 'text-amber-200',
  expired:       'text-rose-200',
}
const STATUS_LABEL = {
  active:        'Active',
  expiring_soon: 'Expiring Soon',
  expired:       'Expired',
}

function CurrentStockSection({ partnerId }) {
  const ctaRows = useMemo(
    () => demoCTAData().filter((r) => r.partner_id === partnerId),
    [partnerId],
  )
  if (ctaRows.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Stock</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ctaRows.map((row) => {
          const sl = SHELF_LIFE[row.variant]
          const pct = Math.min(100, Math.max(0, (row.hours_remaining / (sl.days * 24)) * 100))
          return (
            <div key={row.id} className="dashboard-subpanel rounded-[18px] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[row.status]}`} />
                  <span className={`text-xs font-semibold ${STATUS_TEXT[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
                <span className="text-xs text-slate-500">{row.variant_label} · {sl.days}d life</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                <div className="rounded-[8px] bg-white/[0.04] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Assigned</p>
                  <p className="font-semibold text-white">{row.units_assigned}</p>
                </div>
                <div className="rounded-[8px] bg-white/[0.04] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Sold</p>
                  <p className="font-semibold text-emerald-300">{row.units_sold}</p>
                </div>
                <div className="rounded-[8px] bg-white/[0.04] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Left</p>
                  <p className={`font-semibold ${STATUS_TEXT[row.status]}`}>{row.units_remaining}</p>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${STATUS_DOT[row.status]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-right text-[11px] text-slate-500">
                {timeLabel(row.hours_remaining)} · assigned {formatDateDDMMYY(row.assigned_date)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
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
        <Row label="Assigned" value={data.assigned} className="text-white" />
        <Row label="Sold"      value={data.sold} className="text-emerald-200" />
        <Row label="Left"      value={data.left} className="text-slate-200" />
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

import { useMemo, useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  demoAgentProfile,
  DRILLDOWN_RANGES,
  DIVERSION_REASONS,
  VARIANTS,
  PARTNER_TYPE_LABELS,
  PARTNER_TYPE_PILL,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import {
  PageHeader,
  StatTile,
  Pagination,
  FadeIn,
  VariantPill,
  MonthlyLineChart,
} from '../../components/drilldown/Shared'

const ROWS_PER_PAGE = 20

const DIVERSION_LABEL = Object.fromEntries(DIVERSION_REASONS.map((r) => [r.value, r.label]))

const ACTIVITY_ICON = {
  sold:      { emoji: '✅', color: 'text-emerald-300' },
  assigned:  { emoji: '📦', color: 'text-indigo-300' },
  retracted: { emoji: '↩️', color: 'text-amber-300' },
}

// --- Live-mode helpers ------------------------------------------------------

function liveInRange(dateStr, range) {
  if (range === 'all' || !dateStr) return range === 'all'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return false
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

function variantKeyFromName(name) {
  return /plain/i.test(name || '') ? 'plain' : 'multigrain'
}

function buildLiveMonthly(soldRows) {
  const months = []
  const ref = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      multigrain: 0, plain: 0,
    })
  }
  const byKey = Object.fromEntries(months.map((m) => [m.key, m]))
  for (const r of soldRows) {
    const d = new Date(r.date)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (byKey[k]) byKey[k][r.variant] += r.units
  }
  return months
}

function buildLiveAgentProfile(agentRow, partnerRows, salesRows, range) {
  const partnerById = Object.fromEntries((partnerRows || []).map((p) => [p.id, p]))
  const rows = (salesRows || []).filter((r) => liveInRange(r.purchase_date || r.date_of_assignment || r.created_at, range))

  const perPartner = {}
  for (const p of partnerRows || []) {
    perPartner[p.id] = {
      id: p.id,
      name: p.full_name || 'Partner',
      phone: p.phone || p.phone_number || '',
      status: p.status || 'active',
      partner_type: p.partner_type || 'other',
      assigned: 0, sold: 0, retracted: 0, revenue: 0,
    }
  }
  for (const r of rows) {
    const pp = perPartner[r.trainer_id]
    if (!pp) continue
    const key = variantKeyFromName(r.product_variant)
    pp.assigned += r.units_assigned || ((r.multigrain_assigned || 0) + (r.plain_assigned || 0))
    pp.sold += r.units_sold || 0
    pp.retracted += r.retracted_units || 0
    pp.revenue += (r.units_sold || 0) * (r.unit_price || VARIANTS[key].price)
  }
  const partnerPerformance = Object.values(perPartner)
    .map((p) => ({ ...p, sellThrough: p.assigned > 0 ? Math.round((p.sold / p.assigned) * 100) : 0 }))
    .sort((a, b) => b.sold - a.sold)

  const totalAssigned  = partnerPerformance.reduce((s, p) => s + p.assigned, 0)
  const totalSold      = partnerPerformance.reduce((s, p) => s + p.sold, 0)
  const totalRetracted = partnerPerformance.reduce((s, p) => s + p.retracted, 0)
  const totalRevenue   = partnerPerformance.reduce((s, p) => s + p.revenue, 0)

  const variantRow = (key) => {
    const price = VARIANTS[key].price
    const assigned = rows.reduce((s, r) => s + (key === 'multigrain' ? (r.multigrain_assigned || 0) : (r.plain_assigned || 0)), 0)
    const sold = rows.filter((r) => variantKeyFromName(r.product_variant) === key).reduce((s, r) => s + (r.units_sold || 0), 0)
    const retracted = rows.filter((r) => variantKeyFromName(r.product_variant) === key).reduce((s, r) => s + (r.retracted_units || 0), 0)
    return { key, label: VARIANTS[key].short, price, assigned, sold, retracted, revenue: sold * price, sellThrough: assigned > 0 ? (sold / assigned) * 100 : 0 }
  }

  const deliveries = rows
    .filter((r) => (r.units_assigned || 0) > 0 || (r.multigrain_assigned || 0) > 0 || (r.plain_assigned || 0) > 0)
    .map((r) => {
      const delivered = r.units_assigned || ((r.multigrain_assigned || 0) + (r.plain_assigned || 0))
      const sold = r.units_sold || 0
      return {
        id: r.id,
        date: r.date_of_assignment || r.purchase_date || r.created_at,
        partner_id: r.trainer_id,
        partner_name: partnerById[r.trainer_id]?.full_name || 'Unknown',
        mg: r.multigrain_assigned || 0,
        plain: r.plain_assigned || 0,
        delivered, sold,
        left: Math.max(0, delivered - sold),
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const retractions = rows
    .filter((r) => (r.retracted_units || 0) > 0)
    .map((r) => {
      const key = variantKeyFromName(r.product_variant)
      return {
        id: `${r.id}-ret`,
        date: r.purchase_date || r.created_at,
        partner_id: r.trainer_id,
        partner_name: partnerById[r.trainer_id]?.full_name || 'Unknown',
        variant: key,
        variant_label: VARIANTS[key].short,
        units: r.retracted_units || 0,
        reason_label: r.retraction_reason || 'Retracted',
        notes: r.retraction_notes || '',
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const typeMap = {}
  for (const p of partnerPerformance) {
    const t = p.partner_type || 'other'
    if (!typeMap[t]) typeMap[t] = { type: t, label: PARTNER_TYPE_LABELS[t] || t, partners: 0, delivered: 0, sold: 0 }
    typeMap[t].partners += 1
    typeMap[t].delivered += p.assigned
    typeMap[t].sold += p.sold
  }

  const soldRowsForMonthly = rows.filter((r) => (r.units_sold || 0) > 0).map((r) => ({
    date: r.purchase_date || r.created_at,
    variant: variantKeyFromName(r.product_variant),
    units: r.units_sold || 0,
  }))

  return {
    id: agentRow.id,
    name: agentRow.full_name || 'Agent',
    phone: agentRow.phone || agentRow.phone_number || '',
    status: agentRow.status || 'active',
    joined_at: agentRow.created_at || null,
    totals: { partners: partnerPerformance.length, assigned: totalAssigned, sold: totalSold, retracted: totalRetracted, revenue: totalRevenue, suppliedToStalls: 0 },
    partnerPerformance,
    partnerTypeBreakdown: Object.values(typeMap).sort((a, b) => b.delivered - a.delivered),
    variants: { multigrain: variantRow('multigrain'), plain: variantRow('plain') },
    monthly: buildLiveMonthly(soldRowsForMonthly),
    todayActivity: [],
    deliveries,
    retractions,
    stallSupplies: [],
    diversions: [],
  }
}

export default function AgentProfilePage() {
  const { id } = useParams()
  const { isDemo } = useAuth()
  const [range, setRange] = useState('month')
  const [tick, setTick] = useState(0)
  const [partnerPage, setPartnerPage] = useState(1)
  const [delivPage, setDelivPage] = useState(1)
  const [retrPage, setRetrPage] = useState(1)
  const [liveProfile, setLiveProfile] = useState(null)
  const [liveLoading, setLiveLoading] = useState(!isDemo)
  const [liveError, setLiveError] = useState(null)

  useEffect(() => { setPartnerPage(1); setDelivPage(1); setRetrPage(1) }, [range, id])

  useEffect(() => {
    if (isDemo) return
    let alive = true
    setLiveLoading(true)
    setLiveError(null)
    ;(async () => {
      // Each query is isolated: a missing column or failed request never takes
      // down the whole page — we log a warning and fall back to safe defaults.

      // 1. Agent row. Select * so unknown columns can't error the query.
      let agentRow = null
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
        if (error) throw error
        agentRow = data
      } catch (err) {
        console.warn('Agent row query failed:', err.message)
      }
      if (!agentRow) {
        if (alive) { setLiveProfile(null); setLiveLoading(false) }
        return
      }

      // 2. Partners under this agent. First try the onboarded_by relationship;
      //    if that column doesn't exist, fall back to showing all partners.
      let partnerRows = []
      let partnerAssignmentConfigured = true
      try {
        const { data, error } = await supabase
          .from('profiles').select('*').eq('role', 'partner').eq('onboarded_by', id)
        if (error) throw error
        partnerRows = data || []
      } catch (err) {
        console.warn('Partner-by-agent query failed, showing all partners:', err.message)
        partnerAssignmentConfigured = false
        try {
          const { data, error } = await supabase.from('profiles').select('*').eq('role', 'partner')
          if (error) throw error
          partnerRows = data || []
        } catch (err2) {
          console.warn('All-partners fallback failed:', err2.message)
          partnerRows = []
        }
      }

      // 3. Sales for those partners.
      let salesRows = []
      const partnerIds = partnerRows.map((p) => p.id)
      if (partnerIds.length > 0) {
        try {
          const { data, error } = await supabase.from('sales').select('*').in('trainer_id', partnerIds)
          if (error) throw error
          salesRows = data || []
        } catch (err) {
          console.warn('Sales query failed:', err.message)
        }
      }

      // 4. Today's activity from the audit log.
      let todayActivity = []
      try {
        const start = new Date(); start.setHours(0, 0, 0, 0)
        const { data, error } = await supabase
          .from('audit_logs').select('*')
          .eq('user_id', id)
          .gte('created_at', start.toISOString())
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) throw error
        todayActivity = (data || []).map((l) => ({
          time: l.created_at ? new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
          description: l.description || l.action_type || l.action || 'Activity',
          entity: l.entity_type || '',
        }))
      } catch (err) {
        console.warn('Audit log query failed:', err.message)
      }

      if (alive) {
        const built = buildLiveAgentProfile(agentRow, partnerRows, salesRows, range)
        built.todayActivity = todayActivity
        built.partnerAssignmentConfigured = partnerAssignmentConfigured
        setLiveProfile(built)
        setLiveLoading(false)
      }
    })()
    return () => { alive = false }
  }, [isDemo, id, range, tick])

  const profile = useMemo(() => {
    if (isDemo) return demoAgentProfile(id, { range })
    return liveProfile
  }, [isDemo, id, range, tick, liveProfile])

  if (!isDemo && liveLoading && !profile) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team?view=agents" backLabel="Team" title="Agent profile" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      </FadeIn>
    )
  }

  if (liveError) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team?view=agents" backLabel="Team" title="Agent profile" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-rose-300">{liveError}</div>
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

  const delivTotalPages = Math.max(1, Math.ceil(profile.deliveries.length / ROWS_PER_PAGE))
  const delivPaged = profile.deliveries.slice((delivPage - 1) * ROWS_PER_PAGE, delivPage * ROWS_PER_PAGE)

  const retrTotalPages = Math.max(1, Math.ceil(profile.retractions.length / ROWS_PER_PAGE))
  const retrPaged = profile.retractions.slice((retrPage - 1) * ROWS_PER_PAGE, retrPage * ROWS_PER_PAGE)

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/team?view=agents"
        backLabel="Team"
        title={profile.name}
        subtitle={`📞 ${profile.phone || 'N/A'} · joined ${profile.joined_at ? formatDateDDMMYY(profile.joined_at) : 'N/A'}`}
        onRefresh={() => setTick((t) => t + 1)}
      />

      {/* HEADER — status + contact actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold ${active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
          {active ? '🟢 Active' : '🟡 Inactive'}
        </span>
        <a href={`tel:${profile.phone}`} className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20">📞 Call</a>
        <a href={`sms:${profile.phone}`} className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-sm font-semibold text-indigo-200 transition hover:bg-indigo-400/20">💬 SMS</a>
      </div>

      {/* TIME RANGE — affects every section below */}
      <div className="mb-4">
        <label className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Time range</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="dashboard-select inline-block !w-auto">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* SECTION A — KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Partners Managed"     value={profile.totals.partners.toLocaleString()} color="indigo" />
        <StatTile label="Delivered to Partners" value={profile.totals.assigned.toLocaleString()} color="slate" />
        <StatTile label="Collected Back"        value={profile.totals.retracted.toLocaleString()} color="amber" />
        <StatTile label="Supplied to Stalls"    value={profile.totals.suppliedToStalls.toLocaleString()} color="green" />
      </div>

      {/* FIX 6 — partner breakdown by type */}
      {profile.partnerTypeBreakdown.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Partners by type</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {profile.partnerTypeBreakdown.map((t) => (
              <div key={t.type} className="dashboard-subpanel flex items-center justify-between rounded-[18px] px-4 py-3">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${PARTNER_TYPE_PILL[t.type] || PARTNER_TYPE_PILL.other}`}>{t.label}</span>
                <span className="text-xs text-slate-300">
                  <span className="font-semibold text-slate-100">{t.partners}</span> partner{t.partners !== 1 ? 's' : ''} ·
                  {' '}<span className="font-semibold text-indigo-200">{t.delivered}</span> delivered
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SECTION B — Variant breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VariantBreakdownCard data={profile.variants.multigrain} />
        <VariantBreakdownCard data={profile.variants.plain} />
      </div>

      {/* SECTION C — Today's activity */}
      {profile.todayActivity.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today's Activity</h2>
          <div className="dashboard-subpanel rounded-[22px] divide-y divide-[#E8E0D4]">
            {profile.todayActivity.map((ev, i) => {
              // Two shapes: demo events ({action, partner_name, units, variant})
              // and live audit-log entries ({description, entity, time}).
              if (ev.description !== undefined) {
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base">📝</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-slate-100">{ev.description}</span>
                      {ev.entity && <span className="ml-2 text-xs text-slate-400">{ev.entity}</span>}
                    </div>
                    <span className="text-[11px] text-slate-500 flex-shrink-0">{ev.time}</span>
                  </div>
                )
              }
              const ai = ACTIVITY_ICON[ev.action] || ACTIVITY_ICON.assigned
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-base">{ai.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-slate-100">{ev.partner_name}</span>
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

      {/* SECTION D — Delivery log */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Delivery log</h2>
        {profile.deliveries.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No deliveries in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr><Th>Date</Th><Th>Partner</Th><Th right>MG</Th><Th right>Plain</Th><Th right>Delivered</Th><Th right>Sold</Th><Th right>Left</Th></tr>
                </thead>
                <tbody>
                  {delivPaged.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(d.date)}</td>
                      <td className="px-3 py-2"><Link to={`/admin/partner/${d.partner_id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{d.partner_name}</Link></td>
                      <td className="px-3 py-2 text-right text-slate-300">{d.mg}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{d.plain}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-200">{d.delivered}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{d.sold}</td>
                      <td className="px-3 py-2 text-right text-amber-200">{d.left}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {delivPaged.map((d) => (
                <div key={d.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <Link to={`/admin/partner/${d.partner_id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{d.partner_name}</Link>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(d.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
                    <span>Delivered: <span className="font-semibold text-indigo-200">{d.delivered}</span></span>
                    <span>Sold: <span className="font-semibold text-emerald-300">{d.sold}</span></span>
                    <span>Left: <span className="font-semibold text-amber-300">{d.left}</span></span>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={delivPage} totalPages={delivTotalPages} onChange={setDelivPage} />
          </>
        )}
      </section>

      {/* SECTION E — Retraction / collected-back log */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Retraction log</h2>
        {profile.retractions.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No retractions in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr><Th>Date</Th><Th>Partner</Th><Th>Variant</Th><Th right>Units</Th><Th>Reason</Th><Th>Notes</Th></tr>
                </thead>
                <tbody>
                  {retrPaged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                      <td className="px-3 py-2 font-semibold text-slate-100">{r.partner_name}</td>
                      <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-200">{r.units}</td>
                      <td className="px-3 py-2 text-slate-300">{r.reason_label}</td>
                      <td className="px-3 py-2 max-w-[240px] truncate text-slate-400" title={r.notes}>{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {retrPaged.map((r) => (
                <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-100">{r.partner_name}</p>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VariantPill variant={r.variant} label={r.variant_label} />
                    <span className="text-xs font-semibold text-amber-200">{r.units} units</span>
                    <span className="text-xs text-slate-400">{r.reason_label}</span>
                  </div>
                  {r.notes && <p className="mt-1 text-xs text-slate-400">{r.notes}</p>}
                </div>
              ))}
            </div>
            <Pagination page={retrPage} totalPages={retrTotalPages} onChange={setRetrPage} />
          </>
        )}
      </section>

      {/* SECTION F — Stall / retail supply log */}
      {profile.stallSupplies.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Stall / retail supply</h2>
          <div className="hidden md:block overflow-x-auto">
            <table className="dashboard-table min-w-full">
              <thead>
                <tr><Th>Date</Th><Th>Stall</Th><Th>Variant</Th><Th right>Units</Th><Th>Source</Th><Th>Notes</Th></tr>
              </thead>
              <tbody>
                {profile.stallSupplies.map((ss) => (
                  <tr key={ss.id}>
                    <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(ss.date)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-100">{ss.stall}</td>
                    <td className="px-3 py-2"><VariantPill variant={ss.variant} label={ss.variant_label} /></td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-200">{ss.units}</td>
                    <td className="px-3 py-2 text-slate-300">{ss.source}</td>
                    <td className="px-3 py-2 max-w-[240px] truncate text-slate-400" title={ss.notes}>{ss.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {profile.stallSupplies.map((ss) => (
              <div key={ss.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-100">{ss.stall}</p>
                  <p className="text-xs text-slate-500">{formatDateDDMMYY(ss.date)}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <VariantPill variant={ss.variant} label={ss.variant_label} />
                  <span className="text-xs font-semibold text-emerald-200">{ss.units} units</span>
                  <span className="text-xs text-slate-400">from {ss.source}</span>
                </div>
                {ss.notes && <p className="mt-1 text-xs text-slate-400">{ss.notes}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SECTION G — Partners under this agent */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Partners · {profile.partnerPerformance.length}
        </h2>
        {profile.partnerAssignmentConfigured === false && (
          <div className="mb-2 rounded-[16px] border border-amber-300/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-200">
            ℹ️ Partner assignment not configured yet — showing all partners.
          </div>
        )}
        {profile.partnerPerformance.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No partners in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr><Th>Partner</Th><Th>Type</Th><Th right>Delivered</Th><Th right>Sold</Th><Th right>Returned</Th><Th right>Sell-thru</Th></tr>
                </thead>
                <tbody>
                  {partnerPaged.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <Link to={`/admin/partner/${p.id}`} className="font-semibold text-slate-100 hover:text-emerald-200">{p.name}</Link>
                        <p className="text-[11px] text-slate-500">📞 {p.phone}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PARTNER_TYPE_PILL[p.partner_type] || PARTNER_TYPE_PILL.other}`}>{PARTNER_TYPE_LABELS[p.partner_type] || 'Other'}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100">{p.assigned}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{p.sold}</td>
                      <td className="px-3 py-2 text-right text-amber-200">{p.retracted}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{p.sellThrough}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {partnerPaged.map((p) => (
                <Link key={p.id} to={`/admin/partner/${p.id}`} className="block dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">{p.name}</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PARTNER_TYPE_PILL[p.partner_type] || PARTNER_TYPE_PILL.other}`}>{PARTNER_TYPE_LABELS[p.partner_type] || 'Other'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500">Delivered: <span className="font-semibold text-slate-100">{p.assigned}</span></span>
                    <span className="text-slate-500">Sold: <span className="font-semibold text-emerald-300">{p.sold}</span></span>
                    <span className="text-slate-500">Ret: <span className="font-semibold text-amber-300">{p.retracted}</span></span>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination page={partnerPage} totalPages={partnerTotalPages} onChange={setPartnerPage} />
          </>
        )}
      </section>

      {/* SECTION H — Monthly performance chart */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Monthly performance</h2>
        <MonthlyLineChart data={profile.monthly} />
      </section>
    </FadeIn>
  )
}

function Th({ children, right }) {
  return (
    <th className={`border-b border-[#E8E0D4] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function VariantBreakdownCard({ data }) {
  const isPlain = data.key === 'plain'
  return (
    <div className="dashboard-subpanel rounded-[20px] p-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: isPlain ? '#FBF3D4' : '#024628' }} />
        <p className="font-semibold text-slate-100">{data.label}</p>
        <span className="ml-auto text-xs text-slate-500">₹{data.price}/unit</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Cell label="Delivered" value={data.assigned}  className="text-slate-100" />
        <Cell label="Sold"      value={data.sold}      className="text-emerald-200" />
        <Cell label="Left"      value={Math.max(0, data.assigned - data.sold - data.retracted)} className="text-slate-200" />
        <Cell label="Returned"  value={data.retracted} className="text-rose-200" />
      </div>
      <div className="mt-3 flex justify-between text-sm">
        <span className="text-slate-400">Sell-through</span>
        <span className="font-semibold text-slate-100">{data.sellThrough.toFixed(0)}%</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">Revenue</span>
        <span className="font-mono font-semibold text-indigo-200">₹{data.revenue.toLocaleString()}</span>
      </div>
    </div>
  )
}

function Cell({ label, value, className }) {
  return (
    <div className="rounded-[12px] bg-[#F0EBE3] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-semibold ${className}`}>{value.toLocaleString()}</p>
    </div>
  )
}

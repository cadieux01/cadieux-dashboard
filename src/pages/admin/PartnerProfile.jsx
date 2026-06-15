import { useMemo, useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  demoPartnerProfile,
  demoCTAData,
  demoBlock,
  DRILLDOWN_RANGES,
  VARIANTS,
  PARTNER_TYPE_LABELS,
  PARTNER_TYPE_PILL,
} from '../../lib/demoData'
import { formatDateDDMMYY } from '../../lib/date'
import { SHELF_LIFE, shelfDays } from '../../lib/shelfLife'
import PartnerUnsold from '../../components/PartnerUnsold'
import {
  PageHeader,
  StatTile,
  Pagination,
  FadeIn,
  VariantPill,
  REASON_PILL,
  MonthlyLineChart,
} from '../../components/drilldown/Shared'

const ROWS_PER_PAGE = 20

// --- Live-mode helpers ------------------------------------------------------

// Date-range filter against the real "now" (live mode only).
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

// Per-day sell breakdown for one variant: units sold on shelf-day 1..N.
// days_to_sell is whole days from assignment → sale, so sell-day = days+1.
function byDayFromHistory(salesHistory, variantKey) {
  const total = shelfDays(variantKey)
  const buckets = Array.from({ length: total }, (_, i) => ({ day: i + 1, units: 0 }))
  let unitsSum = 0
  let weighted = 0
  for (const s of salesHistory) {
    if (s.variant !== variantKey) continue
    const d = Math.min(Math.max((s.days_to_sell || 0) + 1, 1), total)
    buckets[d - 1].units += s.units
    unitsSum += s.units
    weighted += d * s.units
  }
  return {
    totalDays: total,
    totalUnits: unitsSum,
    avgSellDay: unitsSum > 0 ? Math.round((weighted / unitsSum) * 10) / 10 : 0,
    days: buckets.map((b) => ({ ...b, pct: unitsSum > 0 ? Math.round((b.units / unitsSum) * 100) : 0 })),
  }
}

function buildLiveMonthly(soldRows) {
  const months = []
  const ref = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      multigrain: 0,
      plain: 0,
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

// Shapes a live profile row + raw sales rows into the same object the demo
// builder returns, so every section below renders identically.
function buildLivePartnerProfile(prof, salesRows, range) {
  const rows = (salesRows || []).filter((r) => liveInRange(r.purchase_date || r.created_at, range))

  const variantRow = (key) => {
    const price = VARIANTS[key].price
    const assigned = rows.reduce(
      (s, r) => s + (key === 'multigrain' ? (r.multigrain_assigned || 0) : (r.plain_assigned || 0)),
      0,
    )
    const sold = rows
      .filter((r) => variantKeyFromName(r.product_variant) === key)
      .reduce((s, r) => s + (r.units_sold || 0), 0)
    const retracted = rows
      .filter((r) => variantKeyFromName(r.product_variant) === key)
      .reduce((s, r) => s + (r.retracted_units || 0), 0)
    return {
      key,
      label: VARIANTS[key].short,
      price,
      assigned,
      sold,
      retracted,
      left: Math.max(0, assigned - sold - retracted),
      revenue: sold * price,
      sellThrough: assigned > 0 ? (sold / assigned) * 100 : 0,
    }
  }

  const mg = variantRow('multigrain')
  const plain = variantRow('plain')

  const salesHistory = rows
    .filter((r) => (r.units_sold || 0) > 0)
    .map((r) => {
      const key = variantKeyFromName(r.product_variant)
      const v = VARIANTS[key]
      const date = r.purchase_date || r.created_at
      const days = r.date_of_assignment && date
        ? Math.max(0, Math.round((new Date(date) - new Date(r.date_of_assignment)) / 86400000))
        : 0
      return {
        id: r.id,
        date,
        variant: key,
        variant_label: v.short,
        units: r.units_sold || 0,
        revenue: (r.units_sold || 0) * (r.unit_price || v.price),
        customer: r.buyer_name || '—',
        contact: r.buyer_contact || '',
        days_to_sell: days,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const attributionHistory = rows
    .filter((r) => (r.retracted_units || 0) > 0)
    .map((r) => {
      const key = variantKeyFromName(r.product_variant)
      return {
        id: `${r.id}-ret`,
        date: r.purchase_date || r.created_at,
        variant: key,
        variant_label: VARIANTS[key].short,
        units: r.retracted_units || 0,
        reason: r.retraction_reason || 'other',
        reason_label: r.retraction_reason || 'Retracted',
        diverted_to: r.diverted_to || 'other',
        notes: r.retraction_notes || '',
        attributed_by: '',
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const speedFor = (key) => {
    const list = salesHistory.filter((s) => s.variant === key)
    if (list.length === 0) return { variant: key, label: VARIANTS[key].short, count: 0, avg: 0, fastest: 0, slowest: 0 }
    const days = list.map((r) => r.days_to_sell)
    return {
      variant: key,
      label: VARIANTS[key].short,
      count: list.length,
      avg: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
      fastest: Math.min(...days),
      slowest: Math.max(...days),
    }
  }
  const within = (lo, hi) => salesHistory.filter((s) => s.days_to_sell >= lo && (hi == null || s.days_to_sell < hi)).length

  const customers = salesHistory.map((s) => ({
    id: s.id, name: s.customer, contact: s.contact, variant: s.variant,
    variant_label: s.variant_label, units: s.units, revenue: s.revenue, date: s.date,
  }))
  const withPhone = customers.filter((c) => c.contact).length

  return {
    id: prof.id,
    name: prof.full_name || 'Partner',
    phone: prof.phone || prof.phone_number || '',
    status: prof.status || 'active',
    partner_type: prof.partner_type || 'other',
    joined_at: prof.created_at || null,
    variants: { multigrain: mg, plain: plain },
    totals: {
      assigned: mg.assigned + plain.assigned,
      sold: mg.sold + plain.sold,
      retracted: mg.retracted + plain.retracted,
      revenue: mg.revenue + plain.revenue,
    },
    sellingSpeed: {
      multigrain: speedFor('multigrain'),
      plain: speedFor('plain'),
      distribution: { total: salesHistory.length, within1: within(0, 2), within2: within(2, 3), within3plus: within(3, null) },
      byDay: {
        multigrain: byDayFromHistory(salesHistory, 'multigrain'),
        plain: byDayFromHistory(salesHistory, 'plain'),
      },
    },
    customers,
    customerStats: { unique: new Set(customers.map((c) => c.name.toLowerCase())).size, withPhone, withoutPhone: customers.length - withPhone },
    remarks: [],
    salesHistory,
    attributionHistory,
    monthly: buildLiveMonthly(salesHistory),
  }
}

export default function PartnerProfile() {
  const { id } = useParams()
  const { isDemo, isAdminOrSales, profile: me } = useAuth()
  const [range, setRange] = useState('month')
  const [tick, setTick] = useState(0)
  const [salesPage, setSalesPage] = useState(1)
  const [attrPage, setAttrPage] = useState(1)
  const [custPage, setCustPage] = useState(1)
  const [liveProfile, setLiveProfile] = useState(null)
  const [liveLoading, setLiveLoading] = useState(!isDemo)
  const [liveError, setLiveError] = useState(null)

  useEffect(() => { setSalesPage(1); setAttrPage(1); setCustPage(1) }, [range, id])

  // Live fetch: pull the partner row + their sales, then shape it.
  useEffect(() => {
    if (isDemo) return
    let alive = true
    setLiveLoading(true)
    setLiveError(null)
    ;(async () => {
      // Partner row — select('*') avoids unknown-column errors.
      let prof = null
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', id)
          .single()
        if (error) throw error
        prof = data
      } catch (err) {
        console.warn('Partner row query failed:', err.message)
      }
      if (!prof) { if (alive) { setLiveProfile(null); setLiveLoading(false) } return }

      // Sales — isolated so a failure here never blocks the profile.
      let salesRows = []
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('*')
          .eq('trainer_id', id)
        if (error) throw error
        salesRows = data || []
      } catch (err) {
        console.warn('Partner sales query failed:', err.message)
      }

      if (alive) { setLiveProfile(buildLivePartnerProfile(prof, salesRows, range)); setLiveLoading(false) }
    })()
    return () => { alive = false }
  }, [isDemo, id, range, tick])

  const profile = useMemo(() => {
    if (isDemo) return demoPartnerProfile(id, { range })
    return liveProfile
  }, [isDemo, id, range, tick, liveProfile])

  if (!isDemo && liveLoading && !profile) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team" backLabel="Team" title="Partner profile" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      </FadeIn>
    )
  }

  if (liveError) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team" backLabel="Team" title="Partner profile" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-rose-300">{liveError}</div>
      </FadeIn>
    )
  }

  if (!profile) {
    return (
      <FadeIn className="dashboard-page">
        <PageHeader backTo="/admin/team" backLabel="Team" title="Partner not found" />
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No partner with id "{id}".
        </div>
      </FadeIn>
    )
  }

  const active = profile.status === 'active'
  const typePill = PARTNER_TYPE_PILL[profile.partner_type] || PARTNER_TYPE_PILL.other
  const typeLabel = PARTNER_TYPE_LABELS[profile.partner_type] || 'Other'

  const salesTotalPages = Math.max(1, Math.ceil(profile.salesHistory.length / ROWS_PER_PAGE))
  const salesPaged = profile.salesHistory.slice((salesPage - 1) * ROWS_PER_PAGE, salesPage * ROWS_PER_PAGE)

  const attrTotalPages = Math.max(1, Math.ceil(profile.attributionHistory.length / ROWS_PER_PAGE))
  const attrPaged = profile.attributionHistory.slice((attrPage - 1) * ROWS_PER_PAGE, attrPage * ROWS_PER_PAGE)

  const custTotalPages = Math.max(1, Math.ceil(profile.customers.length / ROWS_PER_PAGE))
  const custPaged = profile.customers.slice((custPage - 1) * ROWS_PER_PAGE, custPage * ROWS_PER_PAGE)

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/team"
        backLabel="Team"
        title={profile.name}
        subtitle={`📞 ${profile.phone || 'N/A'} · joined ${profile.joined_at ? formatDateDDMMYY(profile.joined_at) : 'N/A'}`}
        onRefresh={() => setTick((t) => t + 1)}
      />

      {/* SECTION HEADER — status, type badge, contact actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold ${active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
          {active ? '🟢 Active' : '🟡 Inactive'}
        </span>
        <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold ${typePill}`}>{typeLabel}</span>
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

      {/* SECTION A — Overview KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Received"  value={profile.totals.assigned.toLocaleString()} color="indigo" />
        <StatTile label="Sold"      value={profile.totals.sold.toLocaleString()} color="emerald" />
        <StatTile label="Returned"  value={profile.totals.retracted.toLocaleString()} color="amber" />
        <StatTile label="Revenue"   value={`₹${profile.totals.revenue.toLocaleString()}`} color="green" />
      </div>

      {/* SECTION B — Variant breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VariantBreakdownCard data={profile.variants.multigrain} speed={profile.sellingSpeed.multigrain} />
        <VariantBreakdownCard data={profile.variants.plain} speed={profile.sellingSpeed.plain} />
      </div>

      {/* SECTION C — Selling speed */}
      <SellingSpeedSection speed={profile.sellingSpeed} />

      {/* SECTION C2 — Sell speed breakdown (per shelf day) */}
      {profile.sellingSpeed.byDay && <SellSpeedBreakdown speed={profile.sellingSpeed} />}

      {/* Current stock — shelf life status */}
      {isDemo && <CurrentStockSection partnerId={id} />}

      {/* Received stock countdowns + expiry → unsold (Stage 7). admin/sales can record. */}
      {!isDemo && <PartnerUnsold partnerId={id} canManage={isAdminOrSales} />}

      {/* SECTION D — Customer log */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Customer log</h2>
          <p className="text-xs text-slate-400">
            <span className="font-semibold text-slate-100">{profile.customerStats.unique}</span> customers ·
            {' '}<span className="text-emerald-300">{profile.customerStats.withPhone} with phone</span> ·
            {' '}<span className="text-slate-400">{profile.customerStats.withoutPhone} without</span>
          </p>
        </div>
        {profile.customers.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No customers in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr>
                    <Th>Customer</Th><Th>Phone</Th><Th>Variant</Th><Th right>Units</Th><Th right>Revenue</Th><Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {custPaged.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium text-slate-100">{c.name}</td>
                      <td className="px-3 py-2 text-slate-300">{c.contact || <span className="text-slate-600">—</span>}</td>
                      <td className="px-3 py-2"><VariantPill variant={c.variant} label={c.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-200">{c.units}</td>
                      <td className="px-3 py-2 text-right font-mono text-indigo-200">₹{c.revenue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-400">{formatDateDDMMYY(c.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {custPaged.map((c) => (
                <div key={c.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-100">{c.name}</p>
                    <p className="text-xs text-slate-500">{formatDateDDMMYY(c.date)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VariantPill variant={c.variant} label={c.variant_label} />
                    <span className="text-xs font-semibold text-emerald-200">{c.units} units</span>
                    <span className="text-xs font-mono text-indigo-200">₹{c.revenue.toLocaleString()}</span>
                    {c.contact && <span className="text-xs text-slate-400">📞 {c.contact}</span>}
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={custPage} totalPages={custTotalPages} onChange={setCustPage} />
          </>
        )}
      </section>

      {/* SECTION E — Remarks / notes */}
      <RemarksSection
        partnerId={id}
        remarks={profile.remarks}
        canAdd={isAdminOrSales}
        isDemo={isDemo}
        authorName={me?.full_name || 'You'}
        onAdded={() => setTick((t) => t + 1)}
      />

      {/* SECTION F — Sales history */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sales history</h2>
        {profile.salesHistory.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No sales in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr><Th>Date</Th><Th>Variant</Th><Th right>Units</Th><Th right>Revenue</Th><Th>Customer</Th><Th right>Days</Th></tr>
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
                    <p className="font-semibold text-slate-100">{s.customer}</p>
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

      {/* SECTION G — Retraction / return history */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Retraction history</h2>
        {profile.attributionHistory.length === 0 ? (
          <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No retractions in this period.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="dashboard-table min-w-full">
                <thead>
                  <tr><Th>Date</Th><Th>Variant</Th><Th right>Units</Th><Th>Reason</Th><Th>Diverted to</Th><Th>Notes</Th></tr>
                </thead>
                <tbody>
                  {attrPaged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-slate-300">{formatDateDDMMYY(r.date)}</td>
                      <td className="px-3 py-2"><VariantPill variant={r.variant} label={r.variant_label} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-200">{r.units}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>{r.reason_label}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{DIVERTED_LABEL[r.diverted_to] || '—'}</td>
                      <td className="px-3 py-2 max-w-[260px] truncate text-slate-400" title={r.notes}>{r.notes || '—'}</td>
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
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.reason] || REASON_PILL.other}`}>{r.reason_label}</span>
                    <span className="text-xs font-semibold text-amber-200">{r.units} units</span>
                    <span className="text-xs text-slate-400">→ {DIVERTED_LABEL[r.diverted_to] || '—'}</span>
                  </div>
                  {r.notes && <p className="mt-2 text-xs text-slate-400">{r.notes}</p>}
                </div>
              ))}
            </div>
            <Pagination page={attrPage} totalPages={attrTotalPages} onChange={setAttrPage} />
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

const DIVERTED_LABEL = {
  food_stalls: 'Food Stalls',
  b2b: 'B2B Channels',
  disposed: 'Disposed',
  other: 'Other',
}

function Th({ children, right }) {
  return (
    <th className={`border-b border-[#E8E0D4] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function SellingSpeedSection({ speed }) {
  const dist = speed.distribution
  const pct = (n) => (dist.total > 0 ? Math.round((n / dist.total) * 100) : 0)
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selling speed</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[speed.multigrain, speed.plain].map((s) => (
          <div key={s.variant} className="dashboard-subpanel rounded-[20px] p-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.variant === 'plain' ? '#FBF3D4' : '#024628' }} />
              <p className="font-semibold text-slate-100">{s.label}</p>
              <span className="ml-auto text-xs text-slate-500">{s.count} sales</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-[12px] bg-[#F0EBE3] px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Avg</p>
                <p className="mt-0.5 font-semibold text-slate-100">{s.avg}d</p>
              </div>
              <div className="rounded-[12px] bg-[#F0EBE3] px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Fastest</p>
                <p className="mt-0.5 font-semibold text-emerald-200">{s.fastest}d</p>
              </div>
              <div className="rounded-[12px] bg-[#F0EBE3] px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Slowest</p>
                <p className="mt-0.5 font-semibold text-amber-200">{s.slowest}d</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 dashboard-subpanel rounded-[20px] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Sold within</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <SpeedBucket label="≤ 1 day"  value={dist.within1}     pct={pct(dist.within1)} color="bg-emerald-400" />
          <SpeedBucket label="2 days"   value={dist.within2}     pct={pct(dist.within2)} color="bg-indigo-400" />
          <SpeedBucket label="3+ days"  value={dist.within3plus} pct={pct(dist.within3plus)} color="bg-amber-400" />
        </div>
      </div>
    </section>
  )
}

// Color for a shelf-day bar: day 1 fresh/bright, mid days green, the final day
// red (or amber for the 3-day Multi-Grain whose last day is a discount day),
// and the penultimate day amber for longer (Plain) shelf lives.
function dayBarColor(day, total) {
  if (day === 1) return '#10b981'           // bright green — fastest
  if (day === total) return total <= 3 ? '#D97706' : '#DC2626'
  if (total > 3 && day === total - 1) return '#D97706' // amber
  return '#34d399'                           // green — still fresh
}

function SellSpeedBreakdown({ speed }) {
  const byDay = speed.byDay
  // "Sell By" options span the largest variant shelf life.
  const maxDays = Math.max(byDay.multigrain.totalDays, byDay.plain.totalDays)
  const [sellBy, setSellBy] = useState('all')
  const cutoff = sellBy === 'all' ? maxDays : Number(sellBy)

  const variants = [byDay.multigrain, byDay.plain].map((b, i) => ({
    ...b,
    label: i === 0 ? 'Multi-Grain' : 'Plain',
    dot: i === 0 ? '#024628' : '#FBF3D4',
    // Cumulative % of units sold by the selected cutoff day.
    soldByCutoff: b.totalUnits > 0
      ? Math.round((b.days.filter((d) => d.day <= cutoff).reduce((s, d) => s + d.units, 0) / b.totalUnits) * 100)
      : 0,
  }))

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sell speed breakdown</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Sell by</label>
          <select value={sellBy} onChange={(e) => setSellBy(e.target.value)} className="dashboard-select !w-auto">
            <option value="all">All days</option>
            {Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>Day {d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {variants.map((v) => {
          const maxPct = Math.max(1, ...v.days.map((d) => d.pct))
          return (
            <div key={v.label} className="dashboard-subpanel rounded-[20px] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: v.dot }} />
                <p className="font-semibold text-slate-100">{v.label}</p>
                <span className="ml-auto text-xs text-slate-500">{v.totalUnits} sold · {v.totalDays}d shelf</span>
              </div>

              <div className="mt-3 space-y-1.5">
                {v.days.map((d) => {
                  const dimmed = d.day > cutoff
                  return (
                    <div key={d.day} className={`flex items-center gap-2 ${dimmed ? 'opacity-35' : ''}`}>
                      <span className="w-12 shrink-0 text-xs font-semibold text-slate-500">Day {d.day}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#F0EBE3]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${(d.pct / maxPct) * 100}%`, backgroundColor: dayBarColor(d.day, v.totalDays) }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                        <span className="font-semibold text-slate-100">{d.units}</span> · {d.pct}%
                      </span>
                    </div>
                  )
                })}
              </div>

              <p className="mt-3 rounded-[12px] bg-[#F0EBE3] px-3 py-2 text-xs text-slate-500">
                Average sell time: <span className="font-semibold text-slate-100">{v.avgSellDay} day{v.avgSellDay === 1 ? '' : 's'}</span>
                {sellBy !== 'all' && (
                  <> · <span className="font-semibold text-emerald-300">{v.soldByCutoff}%</span> sold by Day {cutoff}</>
                )}
              </p>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Average sell time — <span className="font-semibold text-slate-100">MG {byDay.multigrain.avgSellDay} days</span>
        {' '}/ <span className="font-semibold text-slate-100">Plain {byDay.plain.avgSellDay} days</span>
      </p>
    </section>
  )
}

function SpeedBucket({ label, value, pct, color }) {
  return (
    <div className="rounded-[12px] bg-[#F0EBE3] px-2 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-100">{value}</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#F0EBE3]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{pct}%</p>
    </div>
  )
}

function RemarksSection({ partnerId, remarks, canAdd, isDemo, authorName, onAdded }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const submit = useCallback(async () => {
    if (!text.trim()) return
    if (isDemo) { demoBlock('Adding remarks is disabled in demo mode'); return }
    setSaving(true)
    setErr(null)
    try {
      const { error } = await supabase.from('partner_remarks').insert({
        partner_id: partnerId,
        author: authorName,
        text: text.trim(),
      })
      if (error) throw error
      setText('')
      onAdded?.()
    } catch (e) {
      setErr(e.message || 'Could not save remark')
    } finally {
      setSaving(false)
    }
  }, [text, isDemo, partnerId, authorName, onAdded])

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Remarks &amp; notes</h2>
      {canAdd && (
        <div className="mb-3 dashboard-subpanel rounded-[20px] p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Add a remark about this partner…"
            className="dashboard-textarea w-full"
          />
          {err && <p className="mt-1 text-xs text-rose-300">{err}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submit}
              disabled={saving || !text.trim()}
              className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-[#fbf3d4] transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Add remark'}
            </button>
          </div>
        </div>
      )}
      {remarks.length === 0 ? (
        <div className="dashboard-subpanel rounded-[20px] px-5 py-6 text-center text-sm text-slate-400">No remarks yet.</div>
      ) : (
        <div className="space-y-2">
          {remarks.map((r) => (
            <div key={r.id} className="dashboard-subpanel rounded-[20px] px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-100">
                  {r.author}
                  {r.author_role && <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{r.author_role}</span>}
                </p>
                <p className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</p>
              </div>
              <p className="mt-1 text-sm text-slate-300">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const STATUS_DOT = { active: 'bg-emerald-400', expiring_soon: 'bg-amber-400', expired: 'bg-rose-400' }
const STATUS_TEXT = { active: 'text-emerald-200', expiring_soon: 'text-amber-200', expired: 'text-rose-200' }
const STATUS_LABEL = { active: 'Active', expiring_soon: 'Expiring Soon', expired: 'Expired' }

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
                  <span className={`text-xs font-semibold ${STATUS_TEXT[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                </div>
                <span className="text-xs text-slate-500">{row.variant_label} · {sl.days}d life</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                <div className="rounded-[8px] bg-[#F0EBE3] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Received</p>
                  <p className="font-semibold text-slate-100">{row.units_assigned}</p>
                </div>
                <div className="rounded-[8px] bg-[#F0EBE3] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Sold</p>
                  <p className="font-semibold text-emerald-300">{row.units_sold}</p>
                </div>
                <div className="rounded-[8px] bg-[#F0EBE3] px-1.5 py-1">
                  <p className="text-[10px] text-slate-500">Left</p>
                  <p className={`font-semibold ${STATUS_TEXT[row.status]}`}>{row.units_remaining}</p>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F0EBE3]">
                <div className={`h-full rounded-full ${STATUS_DOT[row.status]}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function VariantBreakdownCard({ data, speed }) {
  const isPlain = data.key === 'plain'
  return (
    <div className="dashboard-subpanel rounded-[20px] p-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: isPlain ? '#FBF3D4' : '#024628' }} />
        <p className="font-semibold text-slate-100">{data.label}</p>
        <span className="ml-auto text-xs text-slate-500">₹{data.price}/unit</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Cell label="Received"  value={data.assigned}  className="text-slate-100" />
        <Cell label="Sold"      value={data.sold}      className="text-emerald-200" />
        <Cell label="Left"      value={data.left}      className="text-slate-200" />
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
      {speed && speed.count > 0 && (
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-slate-400">Avg sell time</span>
          <span className="font-semibold text-slate-100">{speed.avg}d</span>
        </div>
      )}
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

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import { logAuditEvent } from '../lib/audit'
import { demoCTAData, demoCTARetractions, VARIANTS } from '../lib/demoData'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { getAssignmentStatus, timeRemaining, timeLabel, SHELF_LIFE } from '../lib/shelfLife'

// Derive day-of-N / days-left / % shelf used straight from the row's
// hours_remaining so it stays consistent with the time badge in both demo
// (relative to the demo "today") and live mode.
function dayInfo(variant, hoursRemaining) {
  const total = SHELF_LIFE[variant]?.days ?? 0
  const totalHours = total * 24
  const elapsed = totalHours - hoursRemaining
  const day = Math.min(Math.max(Math.floor(elapsed / 24) + 1, 1), total)
  const daysLeft = Math.max(0, Math.ceil(hoursRemaining / 24))
  const pctUsed = Math.min(100, Math.max(0, (elapsed / totalHours) * 100))
  const lastDay = hoursRemaining > 0 && day >= total
  return { total, day, daysLeft, pctUsed, lastDay }
}

// Largest shelf life across variants — drives the "By Day" filter options.
const MAX_SHELF_DAYS = Math.max(...Object.values(SHELF_LIFE).map((s) => s.days))

// Map a free-text product_variant to a shelf-life variant key. Partner sales and
// single-variant assignments store the full product name here.
function variantKeyOf(productVariant) {
  if (!productVariant) return null
  if (productVariant === VARIANTS.multigrain.name) return 'multigrain'
  if (productVariant === VARIANTS.plain.name) return 'plain'
  if (/multi/i.test(productVariant)) return 'multigrain'
  if (/plain/i.test(productVariant)) return 'plain'
  return null
}

// Remaining UNSOLD units on a raw sales row, split by variant. Single-variant
// rows carry the variant in product_variant and use units_assigned/units_sold;
// multi-variant rows carry a multigrain/plain split. Never goes negative.
function saleRemaining(sale) {
  const pvKey = variantKeyOf(sale.product_variant)
  if (pvKey) {
    const rem = Math.max(0, (sale.units_assigned || 0) - (sale.units_sold || 0) - (sale.retracted_units || 0))
    return { mg: pvKey === 'multigrain' ? rem : 0, pl: pvKey === 'plain' ? rem : 0, total: rem }
  }
  const mg = Math.max(0, (sale.multigrain_assigned || 0) - (sale.multigrain_retracted || 0))
  const pl = Math.max(0, (sale.plain_assigned || 0) - (sale.plain_retracted || 0))
  return { mg, pl, total: mg + pl }
}

const VARIANT_PILL = {
  multigrain: 'bg-[#024628]/40 text-[#7fe0b7] border border-[#024628]/60',
  plain:      'bg-[#FBF3D4]/40 text-[#8A6D1F] border border-[#8A6D1F]/20',
}

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    kpiColor: 'emerald',
    dot: 'bg-emerald-400',
    text: 'text-emerald-200',
    badge: 'bg-emerald-400/10 border border-emerald-400/20 text-emerald-300',
    card: 'border-[#10b981]/30 bg-[#10b981]/8',
  },
  expiring_soon: {
    label: 'About to Expire',
    kpiColor: 'amber',
    dot: 'bg-amber-400',
    text: 'text-amber-200',
    badge: 'bg-amber-400/10 border border-amber-400/20 text-amber-300',
    card: 'border-[#D97706]/30 bg-[#D97706]/8',
  },
  expired: {
    label: 'Unsold / Expired',
    kpiColor: 'rose',
    dot: 'bg-rose-400',
    text: 'text-rose-200',
    badge: 'bg-rose-400/10 border border-rose-400/20 text-rose-300',
    card: 'border-[#DC2626]/30 bg-[#DC2626]/8',
  },
}

const KPI_COLORS = {
  emerald: 'border-[#10b981]/30 bg-[#10b981]/8 text-[#047857]',
  amber:   'border-[#D97706]/30 bg-[#D97706]/8 text-[#b45309]',
  rose:    'border-[#DC2626]/30 bg-[#DC2626]/8 text-[#b91c1c]',
  slate:   'border-[#E8E0D4]    bg-[#F0EBE3]    text-slate-400',
}

// Readable emphasis colour per status for the compact table (darker than the
// card's tinted-on-glass text so it reads on the light panel rows).
const STATUS_STRONG = {
  emerald: 'text-[#047857]',
  amber:   'text-[#b45309]',
  rose:    'text-[#b91c1c]',
  slate:   'text-slate-500',
}

export default function CTA() {
  const { isDemo, user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])       // shelf-life assignment rows
  const [rawSales, setRawSales] = useState([]) // underlying sales rows (for retract-all)
  const [retractions, setRetractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [retractingId, setRetractingId] = useState(null)
  const [partnerFilter, setPartnerFilter] = useState('all')
  const [variantFilter, setVariantFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchData(), { auto: true })

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    if (isDemo) {
      setRows(demoCTAData())
      setRawSales([])
      setRetractions(demoCTARetractions())
      setLoading(false)
      return
    }
    try {
      const today = new Date()
      // Fetch active assignments (units still unsold)
      const { data: salesData, error } = await supabase
        .from('sales')
        .select(`*, trainers:profiles(*)`)
        .order('date_of_assignment', { ascending: true, nullsFirst: false })
      if (error) throw error

      const liveRows = (salesData || []).flatMap((sale) => {
        const date = sale.date_of_assignment
        if (!date) return []
        const partner = sale.trainers || {}
        const pName = partner.full_name || partner.email || `Partner ${sale.trainer_id?.slice(0, 6)}`
        const pPhone = partner.phone || partner.phone_number || ''

        const makeRow = (key, assigned, sold, soldDate) => {
          const remaining = (assigned || 0) - (sold || 0)
          if (remaining <= 0) return null
          return {
            id: `${sale.id}_${key}`,
            partner_id: sale.trainer_id,
            partner_name: pName,
            partner_phone: pPhone,
            variant: key,
            variant_label: VARIANTS[key]?.short || key,
            assigned_date: date,
            sold_date: soldDate || null,
            units_assigned: assigned || 0,
            units_sold: sold || 0,
            units_remaining: remaining,
            status: getAssignmentStatus(key, date, today),
            hours_remaining: timeRemaining(key, date, today),
          }
        }

        // Sale rows + single-variant assignments carry the variant in
        // product_variant and use the generic units_assigned/units_sold columns
        // (the same source the Overview reads). Multi-variant assignments instead
        // carry a multigrain_assigned/plain_assigned split with no product_variant.
        const pvKey = variantKeyOf(sale.product_variant)
        const variants = pvKey
          ? [makeRow(pvKey, sale.units_assigned, sale.units_sold, sale.purchase_date)]
          : [
              makeRow('multigrain', sale.multigrain_assigned, 0, sale.purchase_date),
              makeRow('plain', sale.plain_assigned, 0, sale.purchase_date),
            ]
        return variants.filter(Boolean)
      })

      setRows(liveRows)
      setRawSales(salesData || [])
      setRetractions([]) // live retractions not yet wired up
    } catch (err) {
      console.error('CTA fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Unique partners from rows for filter dropdown
  const partnerOptions = [...new Map(rows.map((r) => [r.partner_id, r.partner_name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = rows.filter((r) => {
    if (partnerFilter !== 'all' && r.partner_id !== partnerFilter) return false
    if (variantFilter !== 'all' && r.variant !== variantFilter) return false
    if (dayFilter !== 'all' && dayInfo(r.variant, r.hours_remaining).day !== Number(dayFilter)) return false
    return true
  })

  const byStatus = (s) => filtered.filter((r) => r.status === s)
  const active       = byStatus('active')
  const expiring     = byStatus('expiring_soon')
  const expired      = byStatus('expired')

  // Single combined table — grouped by urgency (active → expiring → expired),
  // then soonest-to-expire first within each group.
  const STATUS_ORDER = { active: 0, expiring_soon: 1, expired: 2 }
  const sortedFiltered = [...filtered].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.hours_remaining - b.hours_remaining,
  )

  const kpiTiles = [
    { status: 'active',       count: active.length,    units: active.reduce((s, r) => s + r.units_remaining, 0),    cfg: STATUS_CONFIG.active },
    { status: 'expiring_soon', count: expiring.length, units: expiring.reduce((s, r) => s + r.units_remaining, 0),  cfg: STATUS_CONFIG.expiring_soon },
    { status: 'expired',      count: expired.length,   units: expired.reduce((s, r) => s + r.units_remaining, 0),   cfg: STATUS_CONFIG.expired },
    { status: 'retracted',    count: retractions.length, units: retractions.reduce((s, r) => s + r.units, 0),       cfg: { label: 'Retracted', kpiColor: 'slate', dot: 'bg-slate-400', text: 'text-slate-300' } },
  ]

  // Per-partner leftovers (raw sales with unsold units remaining) for the
  // one-tap "retract all remaining" action. Respects the partner filter so you
  // can focus a single partner; variant/day filters don't apply here because
  // "retract all" pulls back EVERY remaining unit for that partner.
  const partnerLeftovers = useMemo(() => {
    const map = new Map()
    for (const sale of rawSales) {
      if (partnerFilter !== 'all' && sale.trainer_id !== partnerFilter) continue
      const rem = saleRemaining(sale)
      if (rem.total <= 0) continue
      const partner = sale.trainers || {}
      const id = sale.trainer_id
      const prev = map.get(id) || {
        partner_id: id,
        partner_name: partner.full_name || partner.email || `Partner ${id?.slice(0, 6)}`,
        partner_phone: partner.phone || partner.phone_number || '',
        mg: 0,
        pl: 0,
        total: 0,
        saleIds: [],
      }
      prev.mg += rem.mg
      prev.pl += rem.pl
      prev.total += rem.total
      prev.saleIds.push(sale.id)
      map.set(id, prev)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [rawSales, partnerFilter])

  // Retract EVERY remaining unsold unit for one partner in a single action,
  // reusing the same sales-row retract fields the Assignment page writes. Sold
  // units are excluded (saleRemaining only counts unsold), so this never claws
  // back a completed sale.
  const retractAllForPartner = async (entry) => {
    if (isDemo) {
      alert('Retract is not available in demo mode.')
      return
    }
    if (!entry?.total) return
    if (!window.confirm(
      `Retract all ${entry.total} unsold unit${entry.total !== 1 ? 's' : ''} from ${entry.partner_name}? This pulls the stock back from the partner.`
    )) return

    setRetractingId(entry.partner_id)
    try {
      const nowIso = new Date().toISOString()
      for (const saleId of entry.saleIds) {
        const sale = rawSales.find((s) => s.id === saleId)
        if (!sale) continue
        const rem = saleRemaining(sale)
        if (rem.total <= 0) continue
        const nextValues = {
          retracted_units: (sale.retracted_units || 0) + rem.total,
          multigrain_retracted: (sale.multigrain_retracted || 0) + rem.mg,
          plain_retracted: (sale.plain_retracted || 0) + rem.pl,
          retract_reason: 'unsold',
          retract_notes: 'Retracted all remaining from CTA',
          retracted_by: user?.id || null,
          retract_date: nowIso,
        }
        const { error } = await supabase.from('sales').update(nextValues).eq('id', saleId)
        if (error) throw error
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'sale',
          entityId: saleId,
          description: `Retracted ${rem.total} unsold unit(s) from ${entry.partner_name} via CTA`,
          oldValues: { retracted_units: sale.retracted_units || 0 },
          newValues: { retracted_units: nextValues.retracted_units },
          metadata: { trainer_id: entry.partner_id, units_delta: rem.total, source: 'cta_retract_all' },
        }).catch(() => {})
      }
      await fetchData()
    } catch (err) {
      console.error('CTA retract-all error:', err)
      alert('Error retracting units: ' + err.message)
    } finally {
      setRetractingId(null)
    }
  }

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dashboard-page-header">
        <div>
          <h1 className="dashboard-title">CTA</h1>
          <p className="dashboard-subtitle hidden sm:block">Shelf life tracking — call to action on unsold stock</p>
        </div>
        <RefreshButton onRefresh={refresh} loading={refreshing} />
      </div>

      {/* KPI tiles */}
      <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {kpiTiles.map(({ status, count, units, cfg }) => (
          <div
            key={status}
            className={`rounded-[20px] border p-4 ${KPI_COLORS[cfg.kpiColor]}`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{cfg.label}</span>
            </div>
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs opacity-60">{units} units remaining</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All partners</option>
          {partnerOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={variantFilter}
          onChange={(e) => setVariantFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All variants</option>
          <option value="multigrain">Multi-Grain ({SHELF_LIFE.multigrain.days}d shelf life)</option>
          <option value="plain">Plain ({SHELF_LIFE.plain.days}d shelf life)</option>
        </select>
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="dashboard-select !w-auto"
        >
          <option value="all">All days</option>
          {Array.from({ length: MAX_SHELF_DAYS }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
        {(partnerFilter !== 'all' || variantFilter !== 'all' || dayFilter !== 'all') && (
          <button
            onClick={() => { setPartnerFilter('all'); setVariantFilter('all'); setDayFilter('all') }}
            className="text-xs text-slate-400 hover:text-slate-100 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Per-partner leftovers — one-tap "retract all remaining". Pulls back
          every UNSOLD unit for that partner (sold units are never touched). */}
      {!isDemo && partnerLeftovers.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            <Undo2 size={14} />
            Leftovers — retract remaining · {partnerLeftovers.length}
          </h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {partnerLeftovers.map((entry) => (
              <div
                key={entry.partner_id}
                className="rounded-[20px] border border-[#E8E0D4] bg-[#F0EBE3] p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => navigate(`/admin/partner/${entry.partner_id}`)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate font-semibold text-slate-700">{entry.partner_name}</p>
                    {entry.partner_phone && (
                      <p className="truncate text-[11px] text-slate-500">{entry.partner_phone}</p>
                    )}
                  </button>
                  <span className="flex-shrink-0 rounded-full bg-[#DC2626]/10 px-2 py-0.5 text-[11px] font-bold text-[#b91c1c]">
                    {entry.total} left
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {entry.mg} Multi-Grain · {entry.pl} Plain
                </p>
                <button
                  onClick={() => retractAllForPartner(entry)}
                  disabled={retractingId === entry.partner_id}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#DC2626]/30 bg-[#DC2626]/10 px-3 py-1.5 text-xs font-semibold text-[#b91c1c] transition-colors hover:bg-[#DC2626]/15 disabled:opacity-50"
                >
                  <Undo2 size={13} />
                  {retractingId === entry.partner_id ? 'Retracting…' : 'Retract all remaining'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Assignments table — compact, mobile-scannable (scrolls sideways on
          narrow screens). Grouped by urgency, soonest-to-expire first. */}
      {sortedFiltered.length > 0 && (
        <div className="mb-6 overflow-auto rounded-[20px] border border-[#E8E0D4]">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#F0EBE3]">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Partner</th>
                <th className="px-3 py-2.5 font-semibold">Variant</th>
                <th className="px-3 py-2.5 font-semibold">Day</th>
                <th className="px-3 py-2.5 font-semibold">Time left</th>
                <th className="px-2 py-2.5 text-right font-semibold">Asgn</th>
                <th className="px-2 py-2.5 text-right font-semibold">Sold</th>
                <th className="px-2 py-2.5 text-right font-semibold">Left</th>
                <th className="px-3 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E0D4]">
              {sortedFiltered.map((row) => {
                const cfg = STATUS_CONFIG[row.status] || STATUS_CONFIG.active
                const { total: daysTotal, day, daysLeft, pctUsed, lastDay } = dayInfo(row.variant, row.hours_remaining)
                const expired = row.status === 'expired'
                const strong = STATUS_STRONG[cfg.kpiColor] || 'text-slate-500'
                return (
                  <tr
                    key={row.id}
                    onClick={() => navigate(`/admin/partner/${row.partner_id}`)}
                    className="cursor-pointer align-top transition hover:bg-[#F0EBE3]/60"
                  >
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KPI_COLORS[cfg.kpiColor]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {(lastDay || expired) && (
                        <p className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${expired ? 'text-[#b91c1c]' : 'text-[#b45309]'}`}>
                          {expired ? '⚠ Retract / divert' : '⚠ Sell today'}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-100">{row.partner_name}</p>
                      {row.partner_phone && <p className="text-[11px] text-slate-500">{row.partner_phone}</p>}
                      <p className="text-[10px] text-slate-500">Assigned {formatDateDDMMYY(row.assigned_date)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARIANT_PILL[row.variant]}`}>
                        {row.variant_label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-bold text-slate-100">Day {day}</span>
                      <span className="text-slate-500"> / {daysTotal}</span>
                      <p className="text-[10px] text-slate-500">{expired ? 'shelf over' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}</p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`font-semibold ${strong}`}>{timeLabel(row.hours_remaining)}</span>
                      <p className="text-[10px] text-slate-500">{Math.round(pctUsed)}% used</p>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-slate-100">{row.units_assigned}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-emerald-300">{row.units_sold}</td>
                    <td className={`px-2 py-2.5 text-right font-mono font-semibold ${strong}`}>{row.units_remaining}</td>
                    <td className="px-3 py-2.5 text-right">
                      {row.partner_phone && (
                        <a
                          href={`tel:${row.partner_phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-block rounded-full bg-[#F0EBE3] px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-[#ECE5DA]"
                        >
                          📞 Call
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Retracted section */}
      {retractions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Retracted (last 30 days) · {retractions.length}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {retractions.map((r) => (
              <div
                key={r.id}
                onClick={() => navigate(`/admin/partner/${r.partner_id}`)}
                className="cursor-pointer rounded-[20px] border border-[#E8E0D4] bg-[#F0EBE3] p-4 transition hover:-translate-y-0.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VARIANT_PILL[r.variant]}`}>
                      {r.variant_label}
                    </span>
                    <span className="text-xs text-slate-500">{r.reason_label}</span>
                  </div>
                  <span className="text-xs text-slate-500">{formatDateDDMMYY(r.date)}</span>
                </div>
                <p className="font-semibold text-slate-100">{r.partner_name}</p>
                <p className="text-xs text-slate-400">{r.partner_phone}</p>
                <p className="mt-1 text-sm font-semibold text-slate-300">{r.units} unit{r.units !== 1 ? 's' : ''} retracted</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && retractions.length === 0 && (
        <div className="dashboard-panel rounded-[24px] px-5 py-12 text-center text-sm text-slate-400">
          No active stock to track right now.
        </div>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

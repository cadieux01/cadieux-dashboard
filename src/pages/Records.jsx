import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAgentRecords, getAgentCustomers } from '../lib/records'
import { VARIANTS } from '../lib/demoData'
import { formatDateDDMMYY } from '../lib/date'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'

// ============================================================================
// Records (exec) — the agent's PAST performance + their partners' history.
// Everything that is NOT a live/active assignment lives here (the active list
// stays on the Assignment page). Scoped to the logged-in agent via agent_id.
//
//   Summary       the agent's own totals: units sold by variant, retracted,
//                 average days-to-sell, partners worked with.
//   Per partner   for each partner the agent supplied: units assigned / sold /
//                 retracted, split by variant, and average days-to-sell.
//   History       the complete row-by-row assignment & sale log, scrollable.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const VKEYS = ['multigrain', 'plain']

// Time-window options for the records filter. `days: null` = all time.
const TIMEFRAMES = [
  { key: '1d', label: '1 day', days: 1 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '1m', label: '1 month', days: 30 },
  { key: '3m', label: '3 months', days: 90 },
  { key: '6m', label: '6 months', days: 180 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: null },
]

// Strip a phone string down to digits for tel:/wa.me links. Adds the India
// country code when a bare 10-digit number is given (matches how numbers are
// stored across the app).
function phoneDigits(raw) {
  if (!raw) return ''
  let d = String(raw).replace(/\D/g, '')
  if (d.length === 10) d = `91${d}`
  return d
}

function ContactButtons({ contact }) {
  const digits = phoneDigits(contact)
  if (!digits) return null
  return (
    <div className="flex flex-shrink-0 gap-2">
      <a
        href={`tel:${digits}`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-600/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/25"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        Call
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#fbf3d4] hover:opacity-90"
        style={{ backgroundColor: '#25D366' }}
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.115zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
        </svg>
        WhatsApp
      </a>
    </div>
  )
}

function emptyVariantStats() {
  return { multigrain: { assigned: 0, sold: 0, retracted: 0 }, plain: { assigned: 0, sold: 0, retracted: 0 } }
}

// Single-variant assignment rows attribute their sold units to that variant.
// Mixed rows (both mg & plain) can't be split, so their sold count is omitted
// from the per-variant sold tally (still counted in the row-level totals).
function rowVariant(row) {
  const mg = row.multigrain_assigned || 0
  const pl = row.plain_assigned || 0
  if (mg > 0 && pl === 0) return 'multigrain'
  if (pl > 0 && mg === 0) return 'plain'
  return null
}

function daysToSell(row) {
  if (!(row.units_sold > 0) || !row.purchase_date || !row.date_of_assignment) return null
  const start = new Date(row.date_of_assignment).getTime()
  const end = new Date(row.purchase_date).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 86400000)
}

function StatPill({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-100',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${tones[tone] || tones.slate}`}>{value}</p>
    </div>
  )
}

function VariantRow({ vkey, stats }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm">
      <span className="font-medium text-slate-200">{VARIANTS[vkey]?.short || vkey}</span>
      <div className="flex gap-4 text-xs">
        <span className="text-slate-400">Assigned <span className="font-semibold text-slate-100">{stats.assigned}</span></span>
        <span className="text-slate-400">Sold <span className="font-semibold text-emerald-400">{stats.sold}</span></span>
        <span className="text-slate-400">Retracted <span className="font-semibold text-rose-400">{stats.retracted}</span></span>
      </div>
    </div>
  )
}

export default function Records() {
  const { profile, isDemo } = useAuth()
  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [timeframe, setTimeframe] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    if (!profile?.id || isDemo) {
      setRows([])
      setCustomers([])
      setLoading(false)
      return
    }
    try {
      setError(null)
      const [data, custData] = await Promise.all([
        getAgentRecords(profile.id),
        getAgentCustomers(profile.id),
      ])
      setRows(data)
      setCustomers(custData)
    } catch (e) {
      console.error('getAgentRecords failed:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => load())

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isDemo])

  // Cut-off timestamp for the selected window (null = all time).
  const cutoff = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.key === timeframe)
    if (!tf || tf.days == null) return null
    return Date.now() - tf.days * 86400000
  }, [timeframe])

  const inWindow = (dateStr) => {
    if (cutoff == null) return true
    const t = new Date(dateStr).getTime()
    if (!Number.isFinite(t)) return true
    return t >= cutoff
  }

  const filteredRows = useMemo(
    () => rows.filter((r) => inWindow(r.date_of_assignment || r.created_at)),
    [rows, cutoff],
  )
  const filteredCustomers = useMemo(
    () => customers.filter((c) => inWindow(c.created_at)),
    [customers, cutoff],
  )

  // Agent-wide summary + per-partner breakdown.
  const { summary, partners } = useMemo(() => {
    const sum = {
      assigned: 0,
      sold: 0,
      retracted: 0,
      byVariant: emptyVariantStats(),
      sellDays: [],
      partnerIds: new Set(),
    }
    const byPartner = new Map()

    for (const r of filteredRows) {
      const assigned = r.units_assigned || 0
      const sold = r.units_sold || 0
      const retracted = r.retracted_units || 0
      const mgA = r.multigrain_assigned || 0
      const plA = r.plain_assigned || 0
      const mgR = r.multigrain_retracted || 0
      const plR = r.plain_retracted || 0
      const v = rowVariant(r)
      const d = daysToSell(r)

      sum.assigned += assigned
      sum.sold += sold
      sum.retracted += retracted
      sum.byVariant.multigrain.assigned += mgA
      sum.byVariant.plain.assigned += plA
      sum.byVariant.multigrain.retracted += mgR
      sum.byVariant.plain.retracted += plR
      if (v) sum.byVariant[v].sold += sold
      if (d != null) sum.sellDays.push(d)
      if (r.trainer_id) sum.partnerIds.add(r.trainer_id)

      const pid = r.trainer_id || 'unknown'
      if (!byPartner.has(pid)) {
        byPartner.set(pid, {
          id: pid,
          name: r.trainers?.name || 'Unknown partner',
          contact: r.trainers?.contact || '',
          assigned: 0,
          sold: 0,
          retracted: 0,
          count: 0,
          byVariant: emptyVariantStats(),
          sellDays: [],
        })
      }
      const p = byPartner.get(pid)
      p.assigned += assigned
      p.sold += sold
      p.retracted += retracted
      p.count += 1
      p.byVariant.multigrain.assigned += mgA
      p.byVariant.plain.assigned += plA
      p.byVariant.multigrain.retracted += mgR
      p.byVariant.plain.retracted += plR
      if (v) p.byVariant[v].sold += sold
      if (d != null) p.sellDays.push(d)
    }

    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null)

    return {
      summary: {
        assigned: sum.assigned,
        sold: sum.sold,
        retracted: sum.retracted,
        byVariant: sum.byVariant,
        avgDays: avg(sum.sellDays),
        partnerCount: sum.partnerIds.size,
      },
      partners: Array.from(byPartner.values())
        .map((p) => ({ ...p, avgDays: avg(p.sellDays) }))
        .sort((a, b) => b.sold - a.sold || b.assigned - a.assigned),
    }
  }, [filteredRows])

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Records</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Your past performance and your partners&rsquo; history — units sold by variant, retracted, and how long sales took.
          </p>
        </div>
        <RefreshButton onRefresh={refresh} loading={refreshing} />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-700 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {isDemo ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Records are not available in demo mode.</p>
        </div>
      ) : loading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Loading records…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">No past records yet. Assignments you make will appear here as they progress.</p>
        </div>
      ) : (
        <>
          {/* Timeframe filter */}
          <div className="mb-6 flex flex-wrap gap-2">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.key}
                onClick={() => setTimeframe(tf.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  timeframe === tf.key
                    ? 'bg-[#024628] text-[#fbf3d4]'
                    : 'border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Agent summary */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Your performance</h2>
            <p className="mb-4 text-xs text-slate-500">
              Totals for {TIMEFRAMES.find((t) => t.key === timeframe)?.label.toLowerCase()}.
            </p>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatPill label="Partners" value={summary.partnerCount} />
              <StatPill label="Assigned" value={summary.assigned} />
              <StatPill label="Sold" value={summary.sold} tone="emerald" />
              <StatPill label="Retracted" value={summary.retracted} tone="rose" />
              <StatPill label="Avg days to sell" value={summary.avgDays == null ? '—' : `${summary.avgDays}d`} tone="amber" />
            </div>
            <div className="space-y-2">
              {VKEYS.map((v) => (
                <VariantRow key={v} vkey={v} stats={summary.byVariant[v]} />
              ))}
            </div>
          </div>

          {/* Per partner */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">By partner</h2>
            <p className="mb-4 text-xs text-slate-500">{partners.length} partner{partners.length === 1 ? '' : 's'} supplied · sorted by units sold.</p>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {partners.length === 0 && (
                <p className="text-sm text-slate-500">No partner activity in this window.</p>
              )}
              {partners.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">{p.name}</p>
                      {p.contact && <p className="text-xs text-slate-500">{p.contact}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <ContactButtons contact={p.contact} />
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                        {p.count} assignment{p.count === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatPill label="Assigned" value={p.assigned} />
                    <StatPill label="Sold" value={p.sold} tone="emerald" />
                    <StatPill label="Retracted" value={p.retracted} tone="rose" />
                    <StatPill label="Avg days" value={p.avgDays == null ? '—' : `${p.avgDays}d`} tone="amber" />
                  </div>
                  <div className="space-y-1.5">
                    {VKEYS.map((v) => (
                      <VariantRow key={v} vkey={v} stats={p.byVariant[v]} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Customers */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Customers</h2>
            <p className="mb-4 text-xs text-slate-500">
              {filteredCustomers.length} customer{filteredCustomers.length === 1 ? '' : 's'} recorded by your partners · call or WhatsApp directly.
            </p>
            {filteredCustomers.length === 0 ? (
              <p className="text-sm text-slate-500">No customers in this window.</p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {filteredCustomers.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{c.buyer_name || 'Unnamed customer'}</p>
                      <p className="truncate text-xs text-slate-500">
                        {c.buyer_contact || 'No contact'}
                        {c.trainers?.name ? ` · via ${c.trainers.name}` : ''}
                        {c.status ? ` · ${c.status}` : ''}
                        {c.created_at ? ` · ${formatDateDDMMYY(c.created_at)}` : ''}
                      </p>
                    </div>
                    <ContactButtons contact={c.buyer_contact} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Complete history */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Complete history</h2>
            <p className="mb-4 text-xs text-slate-500">{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'} · newest first.</p>
            <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {filteredRows.length === 0 && (
                <p className="text-sm text-slate-500">No records in this window.</p>
              )}
              {filteredRows.map((r) => {
                const v = rowVariant(r)
                const d = daysToSell(r)
                return (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{r.trainers?.name || 'Unknown partner'}</p>
                      <p className="text-xs text-slate-500">
                        {v ? VARIANTS[v]?.short : 'Mixed'} · {formatDateDDMMYY(r.date_of_assignment)}
                        {r.purchase_date ? ` → sold ${formatDateDDMMYY(r.purchase_date)}` : ''}
                        {d != null ? ` · ${d}d` : ''}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 gap-3 text-xs">
                      <span className="text-slate-400">Asgn <span className="font-semibold text-slate-100">{r.units_assigned || 0}</span></span>
                      <span className="text-slate-400">Sold <span className="font-semibold text-emerald-400">{r.units_sold || 0}</span></span>
                      <span className="text-slate-400">Retr <span className="font-semibold text-rose-400">{r.retracted_units || 0}</span></span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

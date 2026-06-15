import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAgentRecords } from '../lib/records'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    if (!profile?.id || isDemo) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      setError(null)
      const data = await getAgentRecords(profile.id)
      setRows(data)
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

    for (const r of rows) {
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
  }, [rows])

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
          {/* Agent summary */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Your performance</h2>
            <p className="mb-4 text-xs text-slate-500">Totals across every assignment you&rsquo;ve made.</p>
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
              {partners.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">{p.name}</p>
                      {p.contact && <p className="text-xs text-slate-500">{p.contact}</p>}
                    </div>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                      {p.count} assignment{p.count === 1 ? '' : 's'}
                    </span>
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

          {/* Complete history */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Complete history</h2>
            <p className="mb-4 text-xs text-slate-500">{rows.length} record{rows.length === 1 ? '' : 's'} · newest first.</p>
            <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {rows.map((r) => {
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

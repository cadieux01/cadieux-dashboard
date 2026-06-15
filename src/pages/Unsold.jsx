import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAllUnsold } from '../lib/unsold'
import { VARIANTS } from '../lib/demoData'
import { formatDateDDMMYY, formatDateTimeDDMMYY } from '../lib/date'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'

// ============================================================================
// Unsold (admin) — operation-wide view of wasted / expired stock.
//
// Aggregates every unsold_units row (holder_type agent | partner) so the admin
// can see who is letting stock expire. RLS already returns all holders' rows to
// an admin. Read-only, no monetary charge.
//
//   Totals      total units unsold, split by variant and by holder type.
//   By agent    which agent wasted how much, by variant, most-wasted first.
//   By partner  same for partner-held unsold (Stage 7 will record these).
//   By date     unsold recorded over time, per variant.
//   History     complete row-by-row log, scrollable.
//
// These units are already expired, so each shows the expiry DATE / "EXPIRED",
// not a live countdown.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const VKEYS = ['multigrain', 'plain']

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

function VariantSplit({ byVariant }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {VKEYS.map((v) => (
        <span key={v} className="text-slate-400">
          {VARIANTS[v]?.short || v}{' '}
          <span className="font-semibold text-rose-400">{byVariant[v] || 0}</span>
        </span>
      ))}
    </div>
  )
}

// One holder (agent or partner) block, used by both the By-agent and
// By-partner sections.
function HolderRow({ h }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{h.name}</p>
          {h.contact && <p className="text-xs text-slate-500">{h.contact}</p>}
        </div>
        <span className="flex-shrink-0 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-400">
          {h.units} unsold
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <VariantSplit byVariant={h.byVariant} />
        <span className="text-xs text-slate-500">
          {h.count} record{h.count === 1 ? '' : 's'} · last {formatDateDDMMYY(h.lastDate)}
        </span>
      </div>
    </div>
  )
}

export default function Unsold() {
  const { isDemo } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    if (isDemo) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      setError(null)
      const data = await getAllUnsold()
      setRows(data)
    } catch (e) {
      console.error('getAllUnsold failed:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => load())

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo])

  const { totals, agents, partners, byDate } = useMemo(() => {
    const t = {
      units: 0,
      byVariant: { multigrain: 0, plain: 0 },
      byHolder: { agent: 0, partner: 0 },
    }
    const holders = { agent: new Map(), partner: new Map() }
    const dateMap = new Map()

    for (const r of rows) {
      const u = r.units || 0
      t.units += u
      if (t.byVariant[r.variant] !== undefined) t.byVariant[r.variant] += u
      if (t.byHolder[r.holder_type] !== undefined) t.byHolder[r.holder_type] += u

      const bucket = holders[r.holder_type]
      if (bucket) {
        const key = r.holder_id || 'unknown'
        if (!bucket.has(key)) {
          bucket.set(key, {
            id: key,
            name: r.holder_name,
            contact: r.holder_contact,
            units: 0,
            count: 0,
            byVariant: { multigrain: 0, plain: 0 },
            lastDate: r.created_at,
          })
        }
        const h = bucket.get(key)
        h.units += u
        h.count += 1
        if (h.byVariant[r.variant] !== undefined) h.byVariant[r.variant] += u
        if (new Date(r.created_at) > new Date(h.lastDate)) h.lastDate = r.created_at
      }

      const day = (r.created_at || '').slice(0, 10)
      if (day) {
        if (!dateMap.has(day)) dateMap.set(day, { day, units: 0, multigrain: 0, plain: 0 })
        const d = dateMap.get(day)
        d.units += u
        if (d[r.variant] !== undefined) d[r.variant] += u
      }
    }

    const sortByUnits = (m) => Array.from(m.values()).sort((a, b) => b.units - a.units)
    return {
      totals: t,
      agents: sortByUnits(holders.agent),
      partners: sortByUnits(holders.partner),
      byDate: Array.from(dateMap.values()).sort((a, b) => (a.day < b.day ? 1 : -1)),
    }
  }, [rows])

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Unsold</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Wasted &amp; expired stock across the whole operation — who let how much expire, by variant and over time.
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
          <p className="text-sm text-slate-400">Unsold tracking is not available in demo mode.</p>
        </div>
      ) : loading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Loading unsold…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">
            No unsold units recorded yet. Expired stock recorded by agents (and, later, partners) will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Totals</h2>
            <p className="mb-4 text-xs text-slate-500">All recorded wasted stock, tracking only — no charge.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatPill label="Total unsold" value={totals.units} tone="rose" />
              <StatPill label={VARIANTS.multigrain?.short || 'Multi-Grain'} value={totals.byVariant.multigrain} />
              <StatPill label={VARIANTS.plain?.short || 'Plain'} value={totals.byVariant.plain} />
              <StatPill label="Held by agents" value={totals.byHolder.agent} tone="amber" />
              <StatPill label="Held by partners" value={totals.byHolder.partner} tone="amber" />
            </div>
          </div>

          {/* By agent */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">By agent</h2>
            <p className="mb-4 text-xs text-slate-500">
              {agents.length} agent{agents.length === 1 ? '' : 's'} · most wasted first.
            </p>
            {agents.length === 0 ? (
              <p className="text-sm text-slate-400">No agent-held unsold stock.</p>
            ) : (
              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {agents.map((h) => (
                  <HolderRow key={h.id} h={h} />
                ))}
              </div>
            )}
          </div>

          {/* By partner */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">By partner</h2>
            <p className="mb-4 text-xs text-slate-500">
              {partners.length} partner{partners.length === 1 ? '' : 's'} · most wasted first. Partner-side recording arrives in a later stage.
            </p>
            {partners.length === 0 ? (
              <p className="text-sm text-slate-400">No partner-held unsold stock yet.</p>
            ) : (
              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {partners.map((h) => (
                  <HolderRow key={h.id} h={h} />
                ))}
              </div>
            )}
          </div>

          {/* By date */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Over time</h2>
            <p className="mb-4 text-xs text-slate-500">Units recorded unsold per day · newest first.</p>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {byDate.map((d) => (
                <div
                  key={d.day}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <span className="text-sm font-medium text-slate-100">{formatDateDDMMYY(d.day)}</span>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <VariantSplit byVariant={d} />
                    <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 font-semibold text-rose-400">{d.units} total</span>
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
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {r.units} × {r.variant_label}
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                        {r.holder_type}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-400">{r.holder_name}</p>
                    <p className="text-xs text-slate-500">
                      Recorded {formatDateTimeDDMMYY(r.created_at)}
                      {r.batch ? ` · Batch #${r.batch.batch_number}` : ''}
                      {r.batch?.expiry_at ? ` · expired ${formatDateDDMMYY(r.batch.expiry_at)}` : ''}
                    </p>
                  </div>
                  <span className="flex-shrink-0 rounded bg-rose-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-rose-400">
                    {r.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

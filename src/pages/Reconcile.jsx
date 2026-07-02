import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getDriftReport } from '../lib/drift'
import { VARIANTS } from '../lib/demoData'
import { formatDateDDMMYY, formatDateTimeDDMMYY } from '../lib/date'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'

// ============================================================================
// Reconcile (admin) — PHASE 1 drift visibility. READ-ONLY.
//
// Surfaces the disagreement between:
//   ledger truth        agent_inventory_ledger 'delivered' rows (agent side)
//   partner-side credit partner_assignments (workflow) + sales.*_assigned
//                       (assignment shape)
// so the admin can see exactly WHICH partner holds units that the ledger never
// released, and how many. Nothing is written; no RPC/RLS/trigger touched.
//
// Sections:
//   Totals          system-wide phantom + orphan + leak counters.
//   Per-agent       ledger totals + in-hand, per variant, per agent.
//   Drift table     per (agent × partner × variant): delivered vs credited,
//                   red when partner is over-credited.
//   Orphan lists    unlinked partner_assignments (leak #1), unbatched sales
//                   (leak #2/#3), partner self-inserted sales (leak #3),
//                   unattributed partner_assignments/sales.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const VKEYS = ['multigrain', 'plain']

function StatPill({ label, value, tone = 'slate', hint }) {
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
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  )
}

function VariantSplit({ byVariant, tone = 'rose' }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : 'text-rose-400'
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {VKEYS.map((v) => (
        <span key={v} className="text-slate-400">
          {VARIANTS[v]?.short || v}{' '}
          <span className={`font-semibold ${toneCls}`}>{byVariant[v] || 0}</span>
        </span>
      ))}
    </div>
  )
}

// One agent's ledger card: received / delivered / returned / expired /
// withdrawn / in-hand — per variant, plus roll-up.
function AgentLedgerCard({ a }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{a.name}</p>
          {a.contact && <p className="text-xs text-slate-500">{a.contact} · {a.role}</p>}
        </div>
        <span className="flex-shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
          in hand: {a.in_hand}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="pb-1 pr-3 text-left font-medium">Variant</th>
              <th className="pb-1 pr-3 text-right font-medium">Received</th>
              <th className="pb-1 pr-3 text-right font-medium">Delivered</th>
              <th className="pb-1 pr-3 text-right font-medium">Returned</th>
              <th className="pb-1 pr-3 text-right font-medium">Expired</th>
              <th className="pb-1 pr-3 text-right font-medium">Withdrawn</th>
              <th className="pb-1 pr-3 text-right font-medium">In hand</th>
            </tr>
          </thead>
          <tbody>
            {VKEYS.map((v) => {
              const b = a.byVariant[v]
              return (
                <tr key={v} className="border-t border-slate-800/70 text-slate-300">
                  <td className="py-1 pr-3 text-slate-200">{VARIANTS[v]?.short || v}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.received}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.delivered}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.returned}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.expired}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.withdrawn}</td>
                  <td className="py-1 pr-3 text-right font-semibold tabular-nums text-emerald-300">{b.in_hand}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// One drift row: agent × partner × variant.
function DriftRow({ r }) {
  const bg =
    r.drift > 0 ? 'bg-rose-500/5 border-rose-500/30'
    : r.drift < 0 ? 'bg-amber-500/5 border-amber-500/30'
    : 'bg-slate-950/40 border-slate-800'
  const driftCls =
    r.drift > 0 ? 'text-rose-400'
    : r.drift < 0 ? 'text-amber-400'
    : 'text-emerald-400'
  const label =
    r.drift > 0 ? 'PHANTOM'
    : r.drift < 0 ? 'ORPHAN'
    : 'RECONCILED'
  const labelCls =
    r.drift > 0 ? 'bg-rose-500/15 text-rose-400'
    : r.drift < 0 ? 'bg-amber-500/15 text-amber-400'
    : 'bg-emerald-500/15 text-emerald-400'
  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">
            {r.agent_name} <span className="text-slate-500">→</span> {r.partner_name}
          </p>
          <p className="text-xs text-slate-500">
            {r.variant_label}
            {r.agent_role && <span> · agent {r.agent_role}</span>}
            {r.partner_contact && <span> · {r.partner_contact}</span>}
          </p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${labelCls}`}>
          {label}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-slate-800/70 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Ledger delivered</p>
          <p className="text-sm font-bold tabular-nums text-slate-200">{r.ledger_delivered}</p>
        </div>
        <div className="rounded border border-slate-800/70 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Partner credited</p>
          <p className="text-sm font-bold tabular-nums text-slate-200">{r.partner_credited}</p>
        </div>
        <div className="rounded border border-slate-800/70 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Drift</p>
          <p className={`text-sm font-bold tabular-nums ${driftCls}`}>
            {r.drift > 0 ? '+' : ''}{r.drift}
          </p>
        </div>
      </div>
    </div>
  )
}

const VIEW_OPTIONS = [
  { value: 'drift', label: 'Drift by (agent × partner × variant)' },
  { value: 'ledger', label: 'Per-agent ledger' },
  { value: 'unlinked', label: 'Unlinked partner assignments (leak #1)' },
  { value: 'unbatched', label: 'Unbatched sales (leak #2 / #3)' },
  { value: 'selfsales', label: 'Partner self-sales (leak #3)' },
  { value: 'unattributed_pa', label: 'Unattributed partner assignments' },
  { value: 'unattributed_sales', label: 'Unattributed sales assigned' },
]

export default function Reconcile() {
  const { isDemo, isAdmin } = useAuth()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('drift')
  const [driftFilter, setDriftFilter] = useState('phantom') // phantom | all | orphan

  const load = async () => {
    if (isDemo) {
      setReport(null)
      setLoading(false)
      return
    }
    try {
      setError(null)
      const data = await getDriftReport()
      setReport(data)
    } catch (e) {
      console.error('getDriftReport failed:', e)
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

  const filteredDrift = useMemo(() => {
    if (!report) return []
    if (driftFilter === 'phantom') return report.driftRows.filter((r) => r.drift > 0)
    if (driftFilter === 'orphan') return report.driftRows.filter((r) => r.drift < 0)
    return report.driftRows
  }, [report, driftFilter])

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Reconcile</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Read-only drift view — where the agent ledger and partner-side credits disagree.
          </p>
        </div>
        <RefreshButton onRefresh={refresh} loading={refreshing} />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-700 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!isAdmin && !isDemo && (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Admin only.</p>
        </div>
      )}

      {isDemo ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Reconciliation view is not available in demo mode.</p>
        </div>
      ) : loading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Computing drift…</p>
        </div>
      ) : !report ? null : (
        <>
          {/* Totals */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">System-wide totals</h2>
            <p className="mb-4 text-xs text-slate-500">
              Phantom = partner over-credited vs ledger. Orphan = agent shipped but partner side has no credit.
              Nothing here writes.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatPill
                label="Phantom units"
                value={report.summary.phantom_units}
                tone="rose"
                hint={`MG ${report.summary.phantom_by_variant.multigrain} · PL ${report.summary.phantom_by_variant.plain}`}
              />
              <StatPill
                label="Orphan units"
                value={report.summary.orphan_units}
                tone="amber"
                hint={`MG ${report.summary.orphan_by_variant.multigrain} · PL ${report.summary.orphan_by_variant.plain}`}
              />
              <StatPill
                label="Unlinked PAs (leak #1)"
                value={report.summary.by_leak.leak1_unlinked_assignments}
                tone="rose"
                hint={`${report.summary.by_leak.leak1_phantom_units} phantom units`}
              />
              <StatPill
                label="Unbatched sales"
                value={report.summary.by_leak.leak23_unbatched_sales}
                tone="amber"
                hint="Stage-4+ contract violation"
              />
              <StatPill
                label="Partner self-sales"
                value={report.summary.by_leak.leak3_partner_self_sales}
                tone="rose"
                hint={`${report.summary.by_leak.leak3_partner_self_units} sold units`}
              />
              <StatPill
                label="Unattributed PAs"
                value={report.summary.by_leak.unattributed_partner_assignments}
                tone="amber"
                hint={`${report.summary.by_leak.unattributed_partner_assignment_units} units`}
              />
              <StatPill
                label="Unattributed sales"
                value={report.summary.by_leak.unattributed_sales_assigned}
                tone="amber"
              />
              <StatPill
                label="Agents seen"
                value={report.agents.length}
              />
              <StatPill
                label="Drift rows"
                value={report.driftRows.length}
                hint={`${report.driftRows.filter((r) => r.drift > 0).length} phantom`}
              />
            </div>
          </div>

          {/* Consolidated breakdown */}
          <div className={CARD}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-100">Breakdown</h2>
                <p className="text-xs text-slate-500">
                  {view === 'drift' && `${filteredDrift.length} row${filteredDrift.length === 1 ? '' : 's'} · worst drift first.`}
                  {view === 'ledger' && `${report.agents.length} agent${report.agents.length === 1 ? '' : 's'}.`}
                  {view === 'unlinked' && `${report.unlinkedAssignments.length} unlinked partner assignment${report.unlinkedAssignments.length === 1 ? '' : 's'}.`}
                  {view === 'unbatched' && `${report.unbatchedSales.length} sales row${report.unbatchedSales.length === 1 ? '' : 's'} with no batch clock.`}
                  {view === 'selfsales' && `${report.partnerSelfSales.length} partner-self-sold row${report.partnerSelfSales.length === 1 ? '' : 's'}.`}
                  {view === 'unattributed_pa' && `${report.unattributedPA.length} partner assignment${report.unattributedPA.length === 1 ? '' : 's'} with no salesperson.`}
                  {view === 'unattributed_sales' && `${report.salesUnattributedAssigned.length} sales row${report.salesUnattributedAssigned.length === 1 ? '' : 's'} with assigned units but no agent.`}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {view === 'drift' && (
                  <select
                    value={driftFilter}
                    onChange={(e) => setDriftFilter(e.target.value)}
                    className="dashboard-select w-full sm:w-auto"
                  >
                    <option value="phantom">Phantom only</option>
                    <option value="orphan">Orphan only</option>
                    <option value="all">All (incl. reconciled)</option>
                  </select>
                )}
                <select
                  value={view}
                  onChange={(e) => setView(e.target.value)}
                  className="dashboard-select w-full sm:w-auto"
                >
                  {VIEW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {view === 'drift' && (
              filteredDrift.length === 0 ? (
                <p className="text-sm text-slate-400">No rows for this filter.</p>
              ) : (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                  {filteredDrift.map((r) => (
                    <DriftRow key={r.key} r={r} />
                  ))}
                </div>
              )
            )}

            {view === 'ledger' && (
              report.agents.length === 0 ? (
                <p className="text-sm text-slate-400">No agent ledger activity yet.</p>
              ) : (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                  {report.agents.map((a) => (
                    <AgentLedgerCard key={a.agent_id} a={a} />
                  ))}
                </div>
              )
            )}

            {view === 'unlinked' && (
              report.unlinkedAssignments.length === 0 ? (
                <p className="text-sm text-slate-400">Every partner assignment has a matching ledger delivery.</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {report.unlinkedAssignments.map((r) => (
                    <div key={r.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {r.salesperson_name} <span className="text-slate-500">→</span> {r.partner_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {r.units} × {r.variant_label} · status <span className="uppercase">{r.status}</span>
                            {r.assigned_by_name && r.assigned_by_name !== '—' && (
                              <span> · assigned by {r.assigned_by_name}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTimeDDMMYY(r.created_at)}
                            {r.batch_id ? ' · batch attached' : ' · no batch'}
                          </p>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-400">
                          +{r.phantom_units} phantom
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {view === 'unbatched' && (
              report.unbatchedSales.length === 0 ? (
                <p className="text-sm text-slate-400">Every sales row carries a batch clock.</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {report.unbatchedSales.map((r) => (
                    <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {r.agent_name} <span className="text-slate-500">→</span> {r.partner_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {(r.multigrain_assigned > 0 || r.plain_assigned > 0) && (
                              <>MG assigned {r.multigrain_assigned} · PL assigned {r.plain_assigned} · </>
                            )}
                            {r.product_variant && (
                              <>sold {r.units_sold} × {r.product_variant} · </>
                            )}
                            <span className="uppercase">no batch</span>
                          </p>
                          <p className="text-[11px] text-slate-500">
                            assigned {r.date_of_assignment ? formatDateDDMMYY(r.date_of_assignment) : '—'}
                            {r.purchase_date && <> · sold {formatDateDDMMYY(r.purchase_date)}</>}
                            <> · created {formatDateTimeDDMMYY(r.created_at)}</>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {view === 'selfsales' && (
              report.partnerSelfSales.length === 0 ? (
                <p className="text-sm text-slate-400">No partner self-inserted sales detected.</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {report.partnerSelfSales.map((r) => (
                    <div key={r.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {r.partner_name} · self-sold {r.units_sold} × {r.variant_label}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            sold {r.purchase_date ? formatDateDDMMYY(r.purchase_date) : '—'} · created {formatDateTimeDDMMYY(r.created_at)}
                          </p>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold uppercase text-rose-400">
                          leak #3
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {view === 'unattributed_pa' && (
              report.unattributedPA.length === 0 ? (
                <p className="text-sm text-slate-400">Every partner assignment names a salesperson.</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {report.unattributedPA.map((r) => (
                    <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        Partner {r.partner_name} · {r.units} × {r.variant_label}
                      </p>
                      <p className="text-xs text-slate-500">
                        status <span className="uppercase">{r.status}</span>
                        {r.assigned_by_name && r.assigned_by_name !== '—' && <> · assigned by {r.assigned_by_name}</>}
                        {' · '}
                        {formatDateTimeDDMMYY(r.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}

            {view === 'unattributed_sales' && (
              report.salesUnattributedAssigned.length === 0 ? (
                <p className="text-sm text-slate-400">Every assigned-shape sales row names an agent.</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {report.salesUnattributedAssigned.map((r) => (
                    <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        Partner {r.partner_name} · MG {r.multigrain_assigned} · PL {r.plain_assigned}
                      </p>
                      <p className="text-xs text-slate-500">
                        assigned {r.date_of_assignment ? formatDateDDMMYY(r.date_of_assignment) : '—'}
                        {' · '}
                        {r.batch_id ? 'batch attached' : 'no batch'}
                        {' · '}
                        {formatDateTimeDDMMYY(r.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

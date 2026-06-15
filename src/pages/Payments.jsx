import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { listCreditAssignments, summarizePayments } from '../lib/payments'
import PaymentVerifications from '../components/PaymentVerifications'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'

// ============================================================================
// Payments (admin / sales) — partner credit overview + verification queue.
//
//   Verification queue   open "mark as paid" requests from partners; view the
//                        proof and Verify (→ paid) or Reject (→ pending).
//   By partner           outstanding / awaiting / settled owed per partner,
//                        most-owed first. Admin sees all partners; a sales
//                        agent sees only the partners they assigned to.
//
// Payment state is independent of the shelf-life clock.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

function OwedPill({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-100',
    amber: 'text-amber-300',
    sky: 'text-sky-300',
    emerald: 'text-emerald-300',
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-lg font-bold ${tones[tone] || tones.slate}`}>{value}</p>
    </div>
  )
}

export default function Payments() {
  const { isDemo, isAdmin, profile } = useAuth()
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
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
      // Admin sees every partner's credit ledger; a sales agent sees only the
      // assignments they made (RLS still scopes the partner side).
      const data = await listCreditAssignments(isAdmin ? {} : { agentId: profile?.id })
      setRows(data)
      const partnerIds = [...new Set(data.map((r) => r.trainer_id).filter(Boolean))]
      if (partnerIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, phone_number')
          .in('id', partnerIds)
        setNames(Object.fromEntries((profs || []).map((p) => [p.id, p])))
      } else {
        setNames({})
      }
    } catch (e) {
      console.error('Load payments failed:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => load())

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, isAdmin, profile?.id])

  const { partners, totals } = useMemo(() => {
    const byPartner = new Map()
    for (const r of rows) {
      const key = r.trainer_id || 'unknown'
      if (!byPartner.has(key)) byPartner.set(key, [])
      byPartner.get(key).push(r)
    }
    const list = Array.from(byPartner.entries()).map(([id, list]) => ({
      id,
      name: names[id]?.full_name || 'Partner',
      phone: names[id]?.phone_number || '',
      ...summarizePayments(list),
    }))
    list.sort((a, b) => b.owedOutstanding - a.owedOutstanding)
    return { partners: list, totals: summarizePayments(rows) }
  }, [rows, names])

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Payments</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Partner credit &amp; payment verification — what each partner owes the company, and proof to confirm.
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
          <p className="text-sm text-slate-400">Payments tracking is not available in demo mode.</p>
        </div>
      ) : (
        <>
          {/* Verification queue */}
          <div className="mb-6">
            <PaymentVerifications />
          </div>

          {/* Totals */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Owed to company</h2>
            <p className="mb-4 text-xs text-slate-500">
              Across {partners.length} partner{partners.length === 1 ? '' : 's'} with credit-tracked assignments.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <OwedPill label="Outstanding" value={inr(totals.owedOutstanding)} tone="amber" />
              <OwedPill label="On credit" value={inr(totals.owedPending)} tone="amber" />
              <OwedPill label="Awaiting verification" value={inr(totals.owedAwaiting)} tone="sky" />
              <OwedPill label="Settled (paid)" value={inr(totals.owedPaid)} tone="emerald" />
            </div>
          </div>

          {/* By partner */}
          <div className={CARD}>
            <h2 className="mb-1 text-lg font-semibold text-slate-100">By partner</h2>
            <p className="mb-4 text-xs text-slate-500">Most owed first.</p>
            {loading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : partners.length === 0 ? (
              <p className="text-sm text-slate-400">No credit-tracked assignments yet.</p>
            ) : (
              <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {partners.map((p) => (
                  <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">{p.name}</p>
                        {p.phone && <p className="text-xs text-slate-500">{p.phone}</p>}
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-300">
                        {inr(p.owedOutstanding)} owed
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>On credit <span className="font-mono font-semibold text-amber-300">{inr(p.owedPending)}</span></span>
                      <span>Awaiting <span className="font-mono font-semibold text-sky-300">{inr(p.owedAwaiting)}</span></span>
                      <span>Paid <span className="font-mono font-semibold text-emerald-300">{inr(p.owedPaid)}</span></span>
                      <span className="text-slate-500">
                        {p.countPending + p.countAwaiting + p.countPaid} assignment{p.countPending + p.countAwaiting + p.countPaid === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

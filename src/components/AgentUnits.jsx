import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { VARIANTS } from '../lib/demoData'
import { formatDateTimeDDMMYY } from '../lib/date'
import UnitWheel from './UnitWheel'
import {
  getAgentInventory,
  getAgentHoldingsByBatch,
  deliverToPartner,
  recordReturn,
  variantLabel,
} from '../lib/agentInventory'
import { getBatchFreshnessMap, batchMsLeft, fmtBatchLeft } from '../lib/batches'

// ============================================================================
// AgentUnits — live inventory ledger for one agent (salesperson).
//   available = received − delivered + returned
// Big "Total Available" number + received/delivered/returned breakdown +
// scrollable history. When canManage is true (the agent viewing their own
// page) it also exposes "Assign to partner" (gated on available > 0) and
// "Record return". Read-only for admins viewing the agent.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

const ENTRY_META = {
  received: { label: 'Received', cls: 'text-emerald-400', sign: '+' },
  delivered: { label: 'Delivered', cls: 'text-amber-400', sign: '−' },
  returned: { label: 'Returned', cls: 'text-sky-400', sign: '+' },
  expired: { label: 'Expired (unsold)', cls: 'text-rose-400', sign: '−' },
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-0.5 font-display text-xl font-bold ${accent || 'text-slate-100'}`}>{value}</p>
    </div>
  )
}

export default function AgentUnits({ agentId, canManage = false }) {
  const [inv, setInv] = useState(null)
  const [loading, setLoading] = useState(true)
  const [partners, setPartners] = useState([])
  // In-hand batch lots, used to offer a source batch when recording a return
  // so the returned row can keep that batch's expiry clock.
  const [holdings, setHoldings] = useState([])
  const [mode, setMode] = useState(null) // 'deliver' | 'return' | null
  const [form, setForm] = useState({ partner_id: '', variant: 'multigrain', units: '', batch_id: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Live batch-expiry clock for history rows that carry a batch_id.
  const [freshness, setFreshness] = useState({})
  const [now, setNow] = useState(Date.now())
  const tickRef = useRef(null)

  const load = async (background = false) => {
    if (!background) setLoading(true)
    try {
      const data = await getAgentInventory(agentId)
      setInv(data)
      const batchIds = (data?.history || []).map((h) => h.batch_id).filter(Boolean)
      setFreshness(batchIds.length ? await getBatchFreshnessMap(batchIds) : {})
      if (canManage) {
        try { setHoldings(await getAgentHoldingsByBatch(agentId)) } catch { /* non-fatal */ }
      }
    } catch (e) {
      console.warn('getAgentInventory failed:', e.message)
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const onFocus = () => load(true)
    const onVisible = () => { if (document.visibilityState === 'visible') load(true) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(() => load(true), 30000)
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
      clearInterval(tickRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  useEffect(() => {
    if (!canManage) return
    supabase
      .from('profiles')
      .select('id, full_name, phone, status')
      .eq('role', 'partner')
      .order('full_name', { ascending: true })
      // Exclude deactivated / removed partners — can't deliver new stock to them.
      .then(({ data }) => setPartners((data || []).filter((p) => p.status !== 'deleted' && p.status !== 'inactive')))
  }, [canManage])

  const resetForm = () => {
    setMode(null)
    setForm({ partner_id: '', variant: 'multigrain', units: '', batch_id: '' })
    setErr(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    const units = parseInt(form.units) || 0
    if (!form.partner_id) { setErr('Please select a partner.'); return }
    if (units <= 0) { setErr('Please enter a unit count.'); return }
    setBusy(true)
    try {
      if (mode === 'deliver') {
        await deliverToPartner({ agentId, partnerId: form.partner_id, variant: form.variant, units })
      } else {
        await recordReturn({ agentId, partnerId: form.partner_id, variant: form.variant, units, batchId: form.batch_id || null })
      }
      resetForm()
      await load(true)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-400">Loading units…</p>
      </div>
    )
  }

  const available = inv?.available || 0
  const byVariant = inv?.byVariant || {}
  const history = inv?.history || []

  return (
    <div className={CARD}>
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Units</h2>

      {/* Big total available */}
      <div className="mb-4 rounded-xl border border-emerald-600/40 bg-emerald-500/10 px-4 py-5 text-center">
        <p className="text-xs uppercase tracking-wide text-emerald-300">Total Available Units</p>
        <p className="mt-1 font-display text-5xl font-bold text-emerald-300">{available}</p>
        <p className="mt-1 text-xs text-slate-400">
          {VARIANTS.multigrain.short}: {byVariant.multigrain?.available || 0} ·{' '}
          {VARIANTS.plain.short}: {byVariant.plain?.available || 0}
        </p>
      </div>

      {/* Per-variant breakdown (Multigrain / Plain shown separately) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {['multigrain', 'plain'].map((key) => {
          const v = byVariant[key] || { available: 0, delivered: 0, returned: 0 }
          return (
            <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-200">{VARIANTS[key].short}</p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Available" value={v.available} accent="text-emerald-400" />
                <Stat label="Active Sales" value={v.delivered} accent="text-amber-400" />
                <Stat label="Retracted" value={v.returned} accent="text-sky-400" />
              </div>
            </div>
          )
        })}
      </div>

      {/* Manage actions (agent only) */}
      {canManage && (
        <div className="mb-4">
          {!mode ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { resetForm(); setMode('deliver') }}
                disabled={available <= 0}
                title={available <= 0 ? 'No available units — ask an admin to assign you stock first.' : undefined}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-[#fbf3d4] hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Assign to partner
              </button>
              <button
                type="button"
                onClick={() => { resetForm(); setMode('return') }}
                className="rounded-lg border border-sky-500 bg-sky-600 px-3 py-1.5 text-sm font-semibold text-[#fbf3d4] hover:bg-sky-500"
              >
                Record return
              </button>
              {available <= 0 && (
                <p className="w-full text-xs text-amber-400">
                  No available units. An admin must assign you stock before you can deliver to a partner.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-sm font-semibold text-slate-200">
                {mode === 'deliver' ? 'Assign units to a partner' : 'Record units returned by a partner'}
              </p>
              <select
                value={form.partner_id}
                onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
                className="dashboard-select"
              >
                <option value="">Select partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.phone || 'Partner'}</option>
                ))}
              </select>
              <select
                value={form.variant}
                onChange={(e) => setForm({ ...form, variant: e.target.value, batch_id: '' })}
                className="dashboard-select"
              >
                <option value="multigrain">{VARIANTS.multigrain.short}</option>
                <option value="plain">{VARIANTS.plain.short}</option>
              </select>
              {mode === 'return' && (() => {
                // Optional source batch so the returned lot keeps its expiry clock.
                const seen = new Set()
                const opts = holdings
                  .filter((h) => h.variant === form.variant && h.batch && !seen.has(h.batch.id) && seen.add(h.batch.id))
                  .map((h) => h.batch)
                if (opts.length === 0) return null
                return (
                  <select
                    value={form.batch_id}
                    onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                    className="dashboard-select"
                  >
                    <option value="">Source batch (optional)…</option>
                    {opts.map((b) => (
                      <option key={b.id} value={b.id}>Batch #{b.batch_number}</option>
                    ))}
                  </select>
                )
              })()}
              <UnitWheel
                label="Units"
                value={parseInt(form.units) || 0}
                max={mode === 'deliver' ? byVariant[form.variant]?.available || 0 : 100}
                onChange={(n) => setForm({ ...form, units: n })}
                hint={
                  mode === 'deliver'
                    ? `Available ${form.variant === 'plain' ? VARIANTS.plain.short : VARIANTS.multigrain.short}: ${byVariant[form.variant]?.available || 0}`
                    : undefined
                }
                emptyMessage="0 available"
              />
              {err && <p className="text-sm font-semibold text-rose-400">{err}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy ? '…' : mode === 'deliver' ? 'Assign' : 'Record return'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* History */}
      <h3 className="mb-2 text-sm font-semibold text-slate-300">History</h3>
      {history.length === 0 ? (
        <p className="text-sm text-slate-400">No inventory activity yet.</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {history.map((h) => {
            const meta = ENTRY_META[h.entry_type] || { label: h.entry_type, cls: 'text-slate-300', sign: '' }
            const batch = h.batch_id ? freshness[h.batch_id] : null
            const ms = batch ? batchMsLeft(batch.expiry_at, now) : null
            const expired = ms != null && ms <= 0
            return (
              <div
                key={h.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    <span className={meta.cls}>{meta.label}</span>{' '}
                    {h.units} × {variantLabel(h.variant)}
                    {h.partner_name ? ` · ${h.partner_name}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTimeDDMMYY(h.created_at)} · by {h.actor_name}
                  </p>
                  {h.batch_id ? (
                    batch ? (
                      <p className={`mt-0.5 text-xs font-semibold ${expired ? 'text-rose-400' : ms != null && ms <= 86400000 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        Batch #{batch.batch_number} · {fmtBatchLeft(ms)}
                      </p>
                    ) : null
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-500">No batch · no expiry</p>
                  )}
                </div>
                <span className={`flex-shrink-0 font-mono text-sm font-semibold ${meta.cls}`}>
                  {meta.sign}{h.units}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

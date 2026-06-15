import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { VARIANTS } from '../lib/demoData'
import { formatDateTimeDDMMYY } from '../lib/date'
import UnitWheel from '../components/UnitWheel'
import RefreshButton from '../components/RefreshButton'
import {
  getStockPool,
  allot,
  listAllAllotments,
} from '../lib/allot'

// ============================================================================
// Allot (admin) — manage the central stock pool and hand units to execs.
//   • Central pool: authoritative total per variant. "Available" = total minus
//     units already reserved by pending/accepted allotments.
//   • Allot: send units to a sales exec. The DB guard blocks over-allotment;
//     the exec then accepts (credits their inventory) or rejects (back to pool).
// This never writes to logistics.sales, so the Overview ASSIGNED KPI is
// unaffected.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'
const VARIANT_KEYS = ['multigrain', 'plain']

const STATUS_META = {
  pending: { label: 'Pending', cls: 'text-amber-400' },
  accepted: { label: 'Accepted', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-rose-400' },
}

function PoolCard({ variant, total, available }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{VARIANTS[variant]?.short || variant}</p>
      <p className="mt-1 font-display text-4xl font-bold text-slate-100">{available}</p>
      <p className="mt-0.5 text-xs text-slate-500">available · {total} total</p>
    </div>
  )
}

export default function Allot({ embedded = false }) {
  const [pool, setPool] = useState(null)
  const [execs, setExecs] = useState([])
  const [allotments, setAllotments] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Allot form
  const [allotForm, setAllotForm] = useState({ exec_id: '', variant: 'multigrain', units: '' })
  const [allotBusy, setAllotBusy] = useState(false)
  const [allotErr, setAllotErr] = useState(null)

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const [p, a] = await Promise.all([getStockPool(), listAllAllotments()])
      setPool(p)
      setAllotments(a)
    } catch (e) {
      console.warn('Allot load failed:', e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    supabase
      .from('profiles')
      .select('id, full_name, phone, status')
      .eq('role', 'sales')
      .order('full_name', { ascending: true })
      .then(({ data }) => setExecs((data || []).filter((e) => (e.status || 'active') === 'active')))
  }, [])

  const submitAllot = async (e) => {
    e.preventDefault()
    setAllotErr(null)
    const units = parseInt(allotForm.units) || 0
    if (!allotForm.exec_id) { setAllotErr('Please select an exec.'); return }
    if (units <= 0) { setAllotErr('Please enter a unit count.'); return }
    setAllotBusy(true)
    try {
      await allot({ execId: allotForm.exec_id, variant: allotForm.variant, units })
      setAllotForm({ exec_id: '', variant: 'multigrain', units: '' })
      await load(true)
    } catch (e2) {
      setAllotErr(e2.message)
    } finally {
      setAllotBusy(false)
    }
  }

  const availForVariant = pool?.[allotForm.variant]?.available || 0

  return (
    <div className={embedded ? '' : 'dashboard-page'}>
      {embedded ? (
        <div className="mb-4 flex justify-end">
          <RefreshButton onRefresh={() => load(true)} loading={refreshing} />
        </div>
      ) : (
        <div className="dashboard-page-header">
          <div className="min-w-0">
            <h1 className="dashboard-title">Allot</h1>
            <p className="dashboard-subtitle hidden truncate sm:block">
              Hold central stock and allot units to your execs. They accept into their own inventory.
            </p>
          </div>
          <RefreshButton onRefresh={() => load(true)} loading={refreshing} />
        </div>
      )}

      {loading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      ) : (
        <>
          {/* Central pool */}
          <div className={CARD}>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Central stock</h2>
            <div className="grid grid-cols-2 gap-3">
              {VARIANT_KEYS.map((v) => (
                <PoolCard
                  key={v}
                  variant={v}
                  total={pool?.[v]?.total || 0}
                  available={pool?.[v]?.available || 0}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Central stock is the live total of non-expired batch units. Add or edit stock from the Batches page.
            </p>
          </div>

          {/* Allot to exec */}
          <div className={CARD}>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Allot to an exec</h2>
            <form onSubmit={submitAllot} className="space-y-3">
              <select
                value={allotForm.exec_id}
                onChange={(e) => setAllotForm({ ...allotForm, exec_id: e.target.value })}
                className="dashboard-select"
              >
                <option value="">Select exec…</option>
                {execs.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.full_name || ex.phone || 'Exec'}</option>
                ))}
              </select>
              <select
                value={allotForm.variant}
                onChange={(e) => setAllotForm({ ...allotForm, variant: e.target.value })}
                className="dashboard-select"
              >
                <option value="multigrain">{VARIANTS.multigrain.short}</option>
                <option value="plain">{VARIANTS.plain.short}</option>
              </select>
              <UnitWheel
                label="Units"
                value={parseInt(allotForm.units) || 0}
                max={availForVariant}
                onChange={(n) => setAllotForm({ ...allotForm, units: n })}
                hint={`Central available: ${availForVariant}`}
                emptyMessage="0 in central stock"
              />
              {allotErr && <p className="text-sm font-semibold text-rose-400">{allotErr}</p>}
              <button
                type="submit"
                disabled={allotBusy || availForVariant <= 0}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allotBusy ? '…' : 'Allot'}
              </button>
            </form>
          </div>

          {/* Recent allotments */}
          <div className={CARD}>
            <h2 className="mb-3 text-lg font-semibold text-slate-100">Recent allotments</h2>
            {allotments.length === 0 ? (
              <p className="text-sm text-slate-400">No allotments yet.</p>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {allotments.map((a) => {
                  const meta = STATUS_META[a.status] || { label: a.status, cls: 'text-slate-300' }
                  return (
                    <div
                      key={a.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-100">
                          {a.units} × {a.variant_label} · {a.exec_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTimeDDMMYY(a.allotted_at)} · by {a.allotted_by_name}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 text-sm font-semibold ${meta.cls}`}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

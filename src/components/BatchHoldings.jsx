import { useEffect, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { getAgentHoldingsByBatch } from '../lib/agentInventory'
import { batchMsLeft, fmtBatchLeft } from '../lib/batches'

// ============================================================================
// BatchHoldings — an agent's in-hand stock broken down BY BATCH (FIFO, oldest
// first), each lot carrying its originating batch so we can show a live expiry
// countdown ("Xd Yh left"). The countdown ticks client-side from a 1s `now`
// against the batch's expiry_at — no DB hammering. Lots with no batch (pre-batch
// 'received' rows / NULL batch_id) render gracefully as "No batch / no expiry".
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

function freshnessCls(ms) {
  if (ms == null) return 'text-slate-400'
  if (ms <= 0) return 'text-rose-400'
  if (ms <= 24 * 60 * 60 * 1000) return 'text-amber-400'
  return 'text-emerald-300'
}

export default function BatchHoldings({ agentId }) {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const load = async (background = false) => {
    if (!background) setLoading(true)
    try {
      const data = await getAgentHoldingsByBatch(agentId)
      setHoldings(data)
    } catch (e) {
      console.warn('getAgentHoldingsByBatch failed:', e.message)
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
    const id = setInterval(() => load(true), 60000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  // Tick `now` every second so the countdowns update live (no DB calls).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className={CARD}>
        <p className="text-sm text-slate-400">Loading stock by batch…</p>
      </div>
    )
  }

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-lg font-semibold text-slate-100">Stock by batch (FIFO)</h2>
      <p className="mb-4 text-xs text-slate-500">
        Your in-hand stock, oldest first. Each lot carries the freshness clock from the batch it came from.
      </p>

      {holdings.length === 0 ? (
        <p className="text-sm text-slate-400">No in-hand stock.</p>
      ) : (
        <div className="space-y-2">
          {holdings.map((h, i) => {
            const ms = h.batch ? batchMsLeft(h.batch.expiry_at, now) : null
            const left = fmtBatchLeft(ms)
            return (
              <div
                key={`${h.variant}-${h.batch?.id || 'nobatch'}-${i}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    {h.units} × {h.variant_label || VARIANTS[h.variant]?.short || h.variant}
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.batch
                      ? `Batch #${h.batch.batch_number}`
                      : 'No batch · no expiry'}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-sm font-semibold ${freshnessCls(ms)}`}>
                  {left || '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

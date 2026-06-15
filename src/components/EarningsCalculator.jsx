import { useState, useCallback } from 'react'
import { calculateEarnings } from '../lib/payments'
import { VARIANTS } from '../lib/demoData'

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

function toYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

function defaultRange(payoutDays) {
  const cycle = Number(payoutDays) > 0 ? Number(payoutDays) : 10
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (cycle - 1))
  return { from: toYMD(from), to: toYMD(to) }
}

function VariantRows({ split, scope }) {
  return (
    <div className="space-y-2">
      {['multigrain', 'plain'].map((k) => {
        const v = split[k]
        if (!v || v.units <= 0) return null
        return (
          <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">{VARIANTS[k].short}</span>
              <span className="text-xs text-slate-400">{v.units} sold · {inr(v.gross)} gross</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-emerald-300">{scope === 'partner' ? 'You earned' : 'Partner share'}</span>
              <span className="font-mono font-semibold text-emerald-300">{inr(v.earned)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-amber-300">{scope === 'partner' ? 'Send to company' : 'Owed to company'}</span>
              <span className="font-mono font-semibold text-amber-300">{inr(v.owed)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TotalsBlock({ totals, scope }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-center">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">{scope === 'partner' ? 'Gross sales' : 'Total revenue'}</div>
        <div className="mt-1 font-mono text-base font-semibold text-slate-100">{inr(totals.gross)}</div>
      </div>
      <div className="rounded-lg border border-emerald-700/40 bg-emerald-500/10 px-3 py-2.5 text-center">
        <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">{scope === 'partner' ? 'You earned' : 'Partner share'}</div>
        <div className="mt-1 font-mono text-base font-semibold text-emerald-300">{inr(totals.earned)}</div>
      </div>
      <div className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2.5 text-center">
        <div className="text-[10px] uppercase tracking-wider text-amber-300/80">{scope === 'partner' ? 'Send to company' : 'Company total'}</div>
        <div className="mt-1 font-mono text-base font-semibold text-amber-300">{inr(totals.owed)}</div>
      </div>
    </div>
  )
}

/**
 * Earnings / payout calculator over a chosen period, from ACTUAL sale records.
 *
 * scope='partner'  — partner's own view: Gross / You earned / Send to company.
 * scope='admin'    — admin/sales view: Total revenue / Total partner share /
 *                    company total, plus a per-partner breakdown when partnerId
 *                    is omitted (aggregate across all partners).
 *
 * partnerId    — scope to a single partner (own portal or admin per-partner).
 * payoutDays   — seeds the default period length.
 */
export default function EarningsCalculator({ partnerId = null, payoutDays = null, scope = 'partner' }) {
  const init = defaultRange(payoutDays)
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)

  const run = useCallback(async () => {
    setErr(null)
    setBusy(true)
    try {
      const data = await calculateEarnings({ partnerId, fromDate: from, toDate: to })
      setResult(data)
    } catch (e) {
      console.error('Earnings calc failed:', e)
      setErr(e.message || 'Could not calculate.')
    } finally {
      setBusy(false)
    }
  }, [partnerId, from, to])

  const setCycle = () => {
    const r = defaultRange(payoutDays)
    setFrom(r.from)
    setTo(r.to)
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-400">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="dashboard-input mt-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="dashboard-input mt-1 text-sm" />
        </label>
        <button
          type="button"
          onClick={setCycle}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600"
        >
          Last {Number(payoutDays) > 0 ? payoutDays : 10}d
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Calculating…' : 'Calculate'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}

      {result && (
        <div className="mt-4 space-y-4">
          <TotalsBlock totals={result.totals} scope={scope} />

          {result.totals.units === 0 ? (
            <p className="text-sm text-slate-400">No sales recorded in this period.</p>
          ) : scope === 'partner' || partnerId ? (
            <VariantRows split={result.totals.byVariant} scope={scope} />
          ) : (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Per partner ({result.partners.length})
              </h4>
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {result.partners.map((p) => (
                  <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-100">{p.name}</span>
                      <span className="text-xs text-slate-400">{p.units} sold · {inr(p.gross)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-emerald-300">Partner share</span>
                      <span className="font-mono font-semibold text-emerald-300">{inr(p.earned)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-300">Owes company</span>
                      <span className="font-mono font-semibold text-amber-300">{inr(p.owed)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {['multigrain', 'plain'].map((k) => {
                        const v = p.byVariant[k]
                        if (!v || v.units <= 0) return null
                        return <span key={k} className="mr-3">{VARIANTS[k].short}: {v.units} (share {inr(v.earned)})</span>
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

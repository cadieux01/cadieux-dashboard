import { useState } from 'react'
import AgentUnits from './AgentUnits'
import BatchHoldings from './BatchHoldings'
import AllotmentInbox from './AllotmentInbox'

// ============================================================================
// AgentAllotmentArea — the agent's stock area, split into TWO TABS:
//   Units      in-hand available stock: the live ledger totals (AgentUnits)
//              plus a FIFO batch breakdown with live freshness countdowns.
//   Allotment  stock the admin has allotted: totals + incoming requests to
//              Accept / Reject, each showing the batch countdown.
// Both /admin/units and /admin/allotment render this; they just open on a
// different default tab so the two existing nav items keep working.
// ============================================================================

const TABS = [
  { key: 'units', label: 'Units' },
  { key: 'allotment', label: 'Allotment' },
]

export default function AgentAllotmentArea({ agentId, defaultTab = 'units' }) {
  const [tab, setTab] = useState(defaultTab === 'allotment' ? 'allotment' : 'units')

  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key
                ? 'bg-emerald-600 text-[#fbf3d4]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'units' ? (
        <>
          <AgentUnits agentId={agentId} canManage />
          <BatchHoldings agentId={agentId} />
        </>
      ) : (
        <AllotmentInbox agentId={agentId} />
      )}
    </div>
  )
}

import { useAuth } from '../context/AuthContext'
import AgentAllotmentArea from '../components/AgentAllotmentArea'

// ============================================================================
// Allotment (exec) — the agent's stock area, opening on the Allotment tab:
// totals + incoming allotments to Accept (credits the agent ledger, carrying
// the batch clock) or Reject (returns units to the central pool), each with a
// live batch countdown. The same tabbed area also hosts the Units tab. Demo
// accounts have no real inventory, so it's hidden in demo mode.
// ============================================================================

export default function Allotment() {
  const { profile, isDemo } = useAuth()

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Allotment</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Stock the admin has allotted to you. Accept to add it to your inventory, or reject to return it.
          </p>
        </div>
      </div>

      {profile && !isDemo ? (
        <AgentAllotmentArea agentId={profile.id} defaultTab="allotment" />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <p className="text-sm text-slate-400">Allotments are not available in demo mode.</p>
        </div>
      )}
    </div>
  )
}

import { useAuth } from '../context/AuthContext'
import AgentAllotmentArea from '../components/AgentAllotmentArea'

// ============================================================================
// Stock (exec) — the agent's allotment inbox: stock the admin has allotted to
// them, with totals and incoming requests to Accept / Reject (each showing the
// batch freshness countdown). This is the single Stock entry for the agent.
// Demo accounts have no real inventory, so it's hidden in demo.
// ============================================================================

export default function Units() {
  const { profile, isDemo } = useAuth()

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Stock</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Stock allotted to you by the admin — accept or reject incoming allotments.
          </p>
        </div>
      </div>

      {profile && !isDemo ? (
        <AgentAllotmentArea agentId={profile.id} allotmentOnly />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <p className="text-sm text-slate-400">Units are not available in demo mode.</p>
        </div>
      )}
    </div>
  )
}

import { useAuth } from '../context/AuthContext'
import AgentUnits from '../components/AgentUnits'

// ============================================================================
// Units (exec) — dedicated page showing this agent's own inventory ledger:
// per variant (Multigrain / Plain) Total Available, Active Sales (delivered),
// and Total Retracted (returned). All numbers come from agent_inventory_ledger
// via AgentUnits. Demo accounts have no real inventory, so it's hidden in demo.
// ============================================================================

export default function Units() {
  const { profile, isDemo } = useAuth()

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">My Units</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Your live unit numbers per variant — available stock, active sales, and returns.
          </p>
        </div>
      </div>

      {profile && !isDemo ? (
        <AgentUnits agentId={profile.id} canManage />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <p className="text-sm text-slate-400">Units are not available in demo mode.</p>
        </div>
      )}
    </div>
  )
}

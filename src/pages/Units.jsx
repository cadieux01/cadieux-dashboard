import { useAuth } from '../context/AuthContext'
import AgentAllotmentArea from '../components/AgentAllotmentArea'

// ============================================================================
// Units (exec) — the agent's stock area, opening on the Units tab: live ledger
// totals per variant (Available / Active Sales / Retracted) plus a FIFO batch
// breakdown with freshness countdowns. The same tabbed area also hosts the
// Allotment tab. Demo accounts have no real inventory, so it's hidden in demo.
// ============================================================================

export default function Units() {
  const { profile, isDemo } = useAuth()

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Stock</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Your live unit numbers per variant — available stock, active sales, and returns.
          </p>
        </div>
      </div>

      {profile && !isDemo ? (
        <AgentAllotmentArea agentId={profile.id} defaultTab="units" />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <p className="text-sm text-slate-400">Units are not available in demo mode.</p>
        </div>
      )}
    </div>
  )
}

import { useAuth } from '../context/AuthContext'
import AllotmentInbox from '../components/AllotmentInbox'

// ============================================================================
// Allotment (exec) — dedicated page for stock an admin has allotted to this
// exec. Hosts the AllotmentInbox (Accept credits the agent ledger, Reject
// returns units to the central pool). Demo accounts have no real inventory, so
// the inbox is hidden in demo mode.
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
        <AllotmentInbox agentId={profile.id} />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <p className="text-sm text-slate-400">Allotments are not available in demo mode.</p>
        </div>
      )}
    </div>
  )
}

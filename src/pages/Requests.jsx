import { useState } from 'react'
import AdminPartnerRequests from './AdminPartnerRequests'
import ChangeRequests from './ChangeRequests'

// ============================================================================
// Requests — one place for both request queues that used to be separate nav
// items (and confusingly both surfaced as "Partner Requests"):
//   • Stock requests   → partner stock supply workflow (Request/Supply/Tracking)
//   • Profile changes  → name / phone / password change approvals
// Each tab renders the existing page component in `embedded` mode (no duplicate
// page header / wrapper), so all their logic is reused untouched.
// ============================================================================

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
        active
          ? 'bg-[#024628] text-[#fbf3d4]'
          : 'bg-[#F0EBE3] text-slate-300 hover:bg-[#E8E0D4]'
      }`}
    >
      {children}
    </button>
  )
}

export default function Requests() {
  const [tab, setTab] = useState('stock')

  return (
    <div className="dashboard-page pb-24 sm:pb-8">
      <div className="relative z-10 mb-4">
        <span className="dashboard-kicker">Operations</span>
        <h1 className="dashboard-title mt-2">Requests</h1>
        <p className="dashboard-subtitle hidden truncate sm:block">
          Partner stock supply requests and profile change approvals in one place.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <TabBtn active={tab === 'stock'} onClick={() => setTab('stock')}>Stock requests</TabBtn>
        <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')}>Profile changes</TabBtn>
      </div>

      {tab === 'stock' ? <AdminPartnerRequests embedded /> : <ChangeRequests embedded />}
    </div>
  )
}

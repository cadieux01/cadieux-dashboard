import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminPartnerRequests from './AdminPartnerRequests'
import ChangeRequests from './ChangeRequests'
import CustomerRequests from './CustomerRequests'

// ============================================================================
// Requests — one place for the request queues that used to be separate nav
// items (and confusingly each surfaced as "Partner Requests"):
//   • Stock requests     → partner stock supply workflow (Request/Supply/Tracking)
//   • Profile changes    → name / phone / password change approvals
//   • Customer requests  → end-customer order changes (delivery / items /
//                          address) + new-pincode "deliver here please" asks
// Each tab renders the existing page component in `embedded` mode (no
// duplicate page header / wrapper). The tab is sticky in the URL via the
// `?tab=` search param so notification deep-links can land users in the
// right queue.
// ============================================================================

const TABS = new Set(['stock', 'profile', 'customer'])

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
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const initial = TABS.has(requested) ? requested : 'stock'
  const [tab, setTab] = useState(initial)

  // Keep URL ↔ local state in sync so deep-links land on the right tab and
  // tab clicks update the URL without remounting the whole tree.
  useEffect(() => {
    const q = params.get('tab')
    if (TABS.has(q) && q !== tab) setTab(q)
  }, [params, tab])

  const switchTo = (next) => {
    setTab(next)
    const p = new URLSearchParams(params)
    if (next === 'stock') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  return (
    <div className="dashboard-page pb-24 sm:pb-8">
      <div className="relative z-10 mb-4">
        <span className="dashboard-kicker">Operations</span>
        <h1 className="dashboard-title mt-2">Requests</h1>
        <p className="dashboard-subtitle hidden truncate sm:block">
          Partner stock supply, profile change approvals, and end-customer
          order changes in one place.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <TabBtn active={tab === 'stock'} onClick={() => switchTo('stock')}>Stock requests</TabBtn>
        <TabBtn active={tab === 'profile'} onClick={() => switchTo('profile')}>Profile changes</TabBtn>
        <TabBtn active={tab === 'customer'} onClick={() => switchTo('customer')}>Customer requests</TabBtn>
      </div>

      {tab === 'stock' && <AdminPartnerRequests embedded />}
      {tab === 'profile' && <ChangeRequests embedded />}
      {tab === 'customer' && <CustomerRequests embedded />}
    </div>
  )
}

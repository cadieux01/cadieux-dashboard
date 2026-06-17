import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Partners from './Partners'
import SalesExec from './SalesExec'
import Customers from './Customers'

// Team — one page, tabbed. Partners + Agents are visible to admin and sales;
// the Customer sub-tab (customer/leads list) is ADMIN-ONLY (agents never see
// customer data). Payments live on their own standalone nav item now.
const VALID_VIEWS = new Set(['partners', 'agents', 'customers'])

export default function Team() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('view') || 'partners'
  const view = VALID_VIEWS.has(raw) ? raw : 'partners'

  // If a non-admin lands on the admin-only customers view, reset to partners.
  useEffect(() => {
    if (!isAdmin && view === 'customers') {
      setSearchParams({}, { replace: true })
    }
  }, [isAdmin, view, setSearchParams])

  const setView = (v) => {
    if (v === 'partners') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ view: v }, { replace: true })
    }
  }

  const tabCls = (active) =>
    `rounded-full px-3.5 py-1 text-sm font-semibold transition-colors ${
      active ? 'bg-[#024628] text-[#fbf3d4]' : 'text-slate-500 hover:text-slate-300'
    }`

  const effectiveView = !isAdmin && view === 'customers' ? 'partners' : view

  return (
    <>
      {/* Team sub-tab bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#E8E0D4] bg-[#F7F3ED] px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setView('partners')} className={tabCls(effectiveView === 'partners')}>
            Partner
          </button>
          <button onClick={() => setView('agents')} className={tabCls(effectiveView === 'agents')}>
            Agent
          </button>
          {isAdmin && (
            <button onClick={() => setView('customers')} className={tabCls(effectiveView === 'customers')}>
              Customer
            </button>
          )}
        </div>
      </div>

      {effectiveView === 'agents' ? (
        <SalesExec />
      ) : effectiveView === 'customers' ? (
        <Customers />
      ) : (
        <Partners />
      )}
    </>
  )
}

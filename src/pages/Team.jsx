import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Partners from './Partners'
import SalesExec from './SalesExec'
import Payments from './Payments'

// Team & Payment — one page, tabbed. Team tab = partner accounts (admins also
// get an Agents sub-view); Payment tab = the credit/payment + verification view.
const VALID_VIEWS = new Set(['partners', 'agents', 'payment'])

export default function Team() {
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('view') || 'partners'
  const view = VALID_VIEWS.has(raw) ? raw : 'partners'

  // If a non-admin lands here with view=agents, reset to partners.
  useEffect(() => {
    if (role !== 'admin' && view === 'agents') {
      setSearchParams({}, { replace: true })
    }
  }, [role, view, setSearchParams])

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

  return (
    <>
      {/* Team / Payment toggle bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#E8E0D4] bg-[#F7F3ED] px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setView('partners')} className={tabCls(view === 'partners')}>
            Partners
          </button>
          {role === 'admin' && (
            <button onClick={() => setView('agents')} className={tabCls(view === 'agents')}>
              Agents
            </button>
          )}
          <button onClick={() => setView('payment')} className={tabCls(view === 'payment')}>
            Payment
          </button>
        </div>
      </div>

      {view === 'payment' ? <Payments /> : view === 'agents' ? <SalesExec /> : <Partners />}
    </>
  )
}

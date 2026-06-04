import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Partners from './Partners'
import SalesExec from './SalesExec'

export default function Team() {
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') || 'partners'

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

  return (
    <>
      {/* Partners / Agents toggle bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#E8E0D4] bg-[#F7F3ED] px-4 py-2.5">
        <div className="flex gap-1">
          <button
            onClick={() => setView('partners')}
            className={`rounded-full px-3.5 py-1 text-sm font-semibold transition-colors ${
              view === 'partners'
                ? 'bg-[#024628] text-[#fbf3d4]'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Partners
          </button>
          {role === 'admin' && (
            <button
              onClick={() => setView('agents')}
              className={`rounded-full px-3.5 py-1 text-sm font-semibold transition-colors ${
                view === 'agents'
                  ? 'bg-[#024628] text-[#fbf3d4]'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Agents
            </button>
          )}
        </div>
      </div>

      {view === 'partners' ? <Partners /> : <SalesExec />}
    </>
  )
}

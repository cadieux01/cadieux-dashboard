import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CentralStock from './CentralStock'
import Allot from './Allot'

// ============================================================================
// Stock (admin) — single home for the two halves of central inventory:
//   • Batches: create / edit production batches with their shelf-life clock.
//   • Allot:   hand non-expired central units to a sales exec.
// They were two separate nav items (/admin/central-stock + /admin/allot);
// merged here behind one "Stock" nav item with tabs. Old routes redirect in.
// ============================================================================

const TABS = [
  { id: 'batches', label: 'Batches' },
  { id: 'allot', label: 'Allot' },
]

export default function Stock() {
  const [params] = useSearchParams()
  const initial = params.get('tab') === 'allot' ? 'allot' : 'batches'
  const [tab, setTab] = useState(initial)

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Stock</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Manage production batches and allot central units to your execs.
          </p>
        </div>
      </div>

      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-emerald-600 text-[#fbf3d4]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'batches' ? <CentralStock embedded /> : <Allot embedded />}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { demoDrilldownPartners, DRILLDOWN_RANGES } from '../../lib/demoData'
import { PageHeader, FadeIn } from '../../components/drilldown/Shared'

const SORT_OPTIONS = [
  { value: 'name',       label: 'By Name' },
  { value: 'sold',       label: 'By Sold' },
  { value: 'attributed', label: 'By Attributed' },
]

export default function OverviewPartners() {
  const { isDemo } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('sold')
  const [range, setRange] = useState('all')
  const [tick, setTick] = useState(0)

  const partners = useMemo(() => {
    if (!isDemo) return []
    const rows = demoDrilldownPartners()
    const term = search.trim().toLowerCase()
    const filtered = term
      ? rows.filter((p) => p.name.toLowerCase().includes(term) || (p.phone || '').includes(term))
      : rows
    const cmp =
      sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : sort === 'attributed' ? (a, b) => b.attributed - a.attributed
      : (a, b) => b.sold - a.sold
    return [...filtered].sort(cmp)
  }, [isDemo, search, sort, range, tick])

  return (
    <FadeIn className="dashboard-page">
      <PageHeader
        backTo="/admin/overview"
        backLabel="Overview"
        title="Partners"
        subtitle={`${partners.length} ${partners.length === 1 ? 'partner' : 'partners'}`}
        onRefresh={() => setTick((t) => t + 1)}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone..."
          className="dashboard-select sm:col-span-1"
          aria-label="Search partners"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="dashboard-select" aria-label="Sort partners">
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="dashboard-select" aria-label="Date range">
          {DRILLDOWN_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {!isDemo ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No data yet.
        </div>
      ) : partners.length === 0 ? (
        <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
          No partners match this search.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((p) => (
            <PartnerCard key={p.id} partner={p} onClick={() => navigate(`/admin/partner/${p.id}`)} />
          ))}
        </div>
      )}
    </FadeIn>
  )
}

function PartnerCard({ partner, onClick }) {
  const initial = (partner.name || '?').trim().charAt(0).toUpperCase()
  const active = partner.status === 'active'
  return (
    <button
      type="button"
      onClick={onClick}
      className="dashboard-subpanel flex flex-col gap-2 rounded-[22px] p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#ECE5DA]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#024628] font-display text-base font-bold text-[#FBF3D4]">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-100">{partner.name}</p>
          <p className="truncate text-xs text-slate-500">📞 {partner.phone || 'No contact'}</p>
        </div>
      </div>
      <div className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
        <span aria-hidden>{active ? '🟢' : '🟡'}</span>
        <span>{active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-[14px] bg-[#F0EBE3] px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Sold</p>
          <p className="mt-0.5 font-semibold text-emerald-200">{partner.sold}</p>
        </div>
        <div className="rounded-[14px] bg-[#F0EBE3] px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Attr</p>
          <p className="mt-0.5 font-semibold text-amber-200">{partner.attributed}</p>
        </div>
      </div>
    </button>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDateDDMMYY } from '../lib/date'
import { categoryForEntity } from '../lib/audit'
import { displayLogin } from '../lib/phone'

// Read-only audit trail. Audit logs are IMMUTABLE: this page can only
// read and export them — never edit or delete. Mutations to the
// audit_logs table are blocked at the database level by RLS (see
// security/audit-table-upgrade.sql).
//
// Data strategy: pull up to MAX_ROWS most-recent rows within the chosen
// date range (date range is applied server-side on created_at, which is
// guaranteed to exist), then filter / search / paginate entirely in the
// browser. This keeps the page resilient regardless of which optional
// columns (category, source) have been added yet, and lets search span
// every loaded field at once.

const MAX_ROWS = 2000
const PER_PAGE = 50

// Action vocabulary the page understands. Extra/unknown values still
// render (fallback styling) — this only drives the dropdown + colours.
const ACTION_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'FEEDBACK_REPLY']

// Base category list from the product spec. The dropdown shows the union
// of this list and any categories actually present in the loaded rows.
const BASE_CATEGORIES = [
  'order',
  'product',
  'customer',
  'location',
  'store',
  'review',
  'settings',
  'sale',
  'partner',
]

const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

function isoDay(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rangeForPreset(preset, customFrom, customTo) {
  const today = new Date()
  switch (preset) {
    case 'today':
      return { from: isoDay(today), to: isoDay(today) }
    case '7d': {
      const f = new Date(today)
      f.setDate(f.getDate() - 6)
      return { from: isoDay(f), to: isoDay(today) }
    }
    case '30d': {
      const f = new Date(today)
      f.setDate(f.getDate() - 29)
      return { from: isoDay(f), to: isoDay(today) }
    }
    case 'custom':
      return { from: customFrom || null, to: customTo || null }
    case 'all':
    default:
      return { from: null, to: null }
  }
}

function actionBadgeClass(value) {
  switch (value) {
    case 'CREATE':
      return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    case 'UPDATE':
      return 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
    case 'DELETE':
      return 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
    case 'LOGIN':
      return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
    case 'FEEDBACK_REPLY':
      return 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
    default:
      return 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
  }
}

function rowCategory(row) {
  return row.category || categoryForEntity(row.entity_type) || 'other'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default function AuditLogs() {
  const [rows, setRows] = useState([])
  const [profilesById, setProfilesById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [preset, setPreset] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filterAction, setFilterAction] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)

  const { from, to } = rangeForPreset(preset, customFrom, customTo)

  useEffect(() => {
    let active = true
    const fetchLogs = async () => {
      setLoading(true)
      setError(null)
      try {
        let query = supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(MAX_ROWS)

        if (from) query = query.gte('created_at', `${from}T00:00:00`)
        if (to) query = query.lte('created_at', `${to}T23:59:59.999`)

        const { data, error: qErr } = await query
        if (qErr) throw qErr
        if (!active) return

        const logs = data || []
        setRows(logs)

        // Best-effort enrichment: map user_id -> { email, full_name }.
        // Admins can read all profiles (RLS). Failure is non-fatal — we
        // simply fall back to the stored user_name.
        const ids = [...new Set(logs.map((l) => l.user_id).filter(Boolean))]
        if (ids.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', ids)
          if (active && profs) {
            const map = {}
            for (const p of profs) map[p.id] = p
            setProfilesById(map)
          }
        } else if (active) {
          setProfilesById({})
        }
      } catch (e) {
        if (active) {
          setError(
            e?.message
              ? `Could not load audit logs: ${e.message}`
              : 'Could not load audit logs.',
          )
          setRows([])
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchLogs()
    return () => {
      active = false
    }
  }, [from, to])

  // Reset to first page whenever the result set changes.
  useEffect(() => {
    setPage(1)
  }, [filterAction, filterCategory, search, from, to])

  const categoryOptions = useMemo(() => {
    const present = new Set(rows.map(rowCategory))
    return [...new Set([...BASE_CATEGORIES, ...present])].sort()
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filterAction !== 'all' && row.action_type !== filterAction) return false
      if (filterCategory !== 'all' && rowCategory(row) !== filterCategory) return false
      if (q) {
        const prof = profilesById[row.user_id]
        const haystack = [
          row.user_name,
          // Show phone number for synthetic <phone>@cadieux.<role>
          // logins; fall back to raw email for real admin accounts.
          displayLogin(prof?.email),
          prof?.full_name,
          row.description,
          row.entity_type,
          rowCategory(row),
          row.action_type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [rows, filterAction, filterCategory, search, profilesById])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const exportCsv = () => {
    const headers = [
      'timestamp',
      'user_name',
      'login',
      'action_type',
      'category',
      'entity_type',
      'entity_id',
      'description',
      'old_values',
      'new_values',
    ]
    const lines = [headers.join(',')]
    for (const row of filtered) {
      const prof = profilesById[row.user_id]
      lines.push(
        [
          row.created_at,
          row.user_name,
          displayLogin(prof?.email) || '',
          row.action_type,
          rowCategory(row),
          row.entity_type,
          row.entity_id,
          row.description,
          row.old_values,
          row.new_values,
        ]
          .map(csvEscape)
          .join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${isoDay(new Date())}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 font-mono">
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-white mb-2 font-sans">Audit Logs</h1>
        <p className="text-slate-400 font-sans">
          Every recorded action across the system, oldest hidden beneath the newest.
        </p>
      </div>

      {/* Immutability notice */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <svg
          className="h-5 w-5 flex-shrink-0 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        <span className="text-sm text-amber-300 font-sans">
          Audit logs are permanent and cannot be edited or deleted.
        </span>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Date range */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
              Date range
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={`rounded-lg border px-3 py-2 text-sm font-sans transition-colors ${
                    preset === p.key
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {preset === 'custom' && (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
                  From
                </span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
                  To
                </span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Action */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
              Action
            </span>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All actions</option>
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
              Category
            </span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-sans capitalize focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="flex flex-1 flex-col gap-1 min-w-[200px]">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-sans">
              Search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="user, description, anything…"
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Export */}
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-sans text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 font-sans">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h3 className="text-lg font-semibold text-white font-sans">Activity Log</h3>
          <span className="text-sm text-slate-500 font-sans">
            {filtered.length === 0
              ? 'No entries'
              : `Showing ${(page - 1) * PER_PAGE + 1}–${Math.min(
                  page * PER_PAGE,
                  filtered.length,
                )} of ${filtered.length}`}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-950/60">
                <tr className="text-left text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <th className="px-4 py-3 font-semibold font-sans">Timestamp</th>
                  <th className="px-4 py-3 font-semibold font-sans">User</th>
                  <th className="px-4 py-3 font-semibold font-sans">Action</th>
                  <th className="px-4 py-3 font-semibold font-sans">Category</th>
                  <th className="px-4 py-3 font-semibold font-sans">Description</th>
                  <th className="px-4 py-3 font-semibold font-sans">Details</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500 font-sans">
                      No matching entries.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, idx) => {
                    const prof = profilesById[row.user_id]
                    const hasDiff = row.old_values || row.new_values
                    const isOpen = expandedId === row.id
                    return (
                      <RowGroup
                        key={row.id || idx}
                        row={row}
                        prof={prof}
                        idx={idx}
                        hasDiff={hasDiff}
                        isOpen={isOpen}
                        onToggle={() =>
                          setExpandedId(isOpen ? null : row.id)
                        }
                      />
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white font-sans transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400 font-sans">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white font-sans transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function RowGroup({ row, prof, idx, hasDiff, isOpen, onToggle }) {
  const zebra = idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/40'
  return (
    <>
      <tr className={`border-b border-white/5 ${zebra}`}>
        <td className="px-4 py-3 align-top text-slate-300">
          <div className="text-slate-200">{formatDateDDMMYY(row.created_at)}</div>
          <div className="text-xs text-slate-500">
            {row.created_at ? new Date(row.created_at).toLocaleTimeString() : ''}
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="font-sans font-medium text-white">
            {row.user_name || 'Unknown'}
          </div>
          {prof?.email && (
            <div className="text-xs text-slate-500">{displayLogin(prof.email)}</div>
          )}
        </td>
        <td className="px-4 py-3 align-top">
          <span
            className={`inline-block rounded px-2 py-1 text-xs font-semibold font-sans ${actionBadgeClass(
              row.action_type,
            )}`}
          >
            {row.action_type || '—'}
          </span>
        </td>
        <td className="px-4 py-3 align-top capitalize text-slate-300">
          {row.category || categoryForEntity(row.entity_type) || 'other'}
        </td>
        <td className="px-4 py-3 align-top text-slate-200">
          {renderDescription(row.description)}
        </td>
        <td className="px-4 py-3 align-top">
          {hasDiff ? (
            <button
              type="button"
              onClick={onToggle}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 font-sans transition-colors hover:text-white"
            >
              {isOpen ? 'Hide' : 'View'}
            </button>
          ) : (
            <span className="text-xs text-slate-600">—</span>
          )}
        </td>
      </tr>
      {isOpen && hasDiff && (
        <tr className="bg-slate-950/70">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <JsonBlock label="Before" value={row.old_values} tone="rose" />
              <JsonBlock label="After" value={row.new_values} tone="emerald" />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function renderDescription(value) {
  if (!value) return <span className="text-slate-600">—</span>
  const parts = String(value).split(' | ')
  if (parts.length === 2) {
    return (
      <div className="space-y-1">
        <div className="text-white">{parts[0]}</div>
        <div className="my-1 h-px w-full bg-slate-700"></div>
        <div className="text-slate-300">{parts[1]}</div>
      </div>
    )
  }
  return <span className="text-white">{value}</span>
}

function JsonBlock({ label, value, tone }) {
  const border = tone === 'rose' ? 'border-rose-500/30' : 'border-emerald-500/30'
  const text = tone === 'rose' ? 'text-rose-300' : 'text-emerald-300'
  let pretty
  try {
    pretty =
      value == null
        ? '—'
        : JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2)
  } catch {
    pretty = String(value)
  }
  return (
    <div className={`rounded-lg border ${border} bg-slate-900/80 p-3`}>
      <div className={`mb-2 text-[11px] uppercase tracking-[0.2em] font-sans ${text}`}>
        {label}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">
        {pretty}
      </pre>
    </div>
  )
}

import { Link } from 'react-router-dom'
import RefreshButton from '../RefreshButton'

// ============================================================================
// Shared building blocks for the overview drill-down pages.
// All pages share the same dark theme, back-link header, filter bar, and
// stat tiles. Keep these primitives lean so each page reads as a layout
// declaration rather than a wall of markup.
// ============================================================================

// PageHeader — title, optional back link, refresh button, action slot.
export function PageHeader({ backTo, backLabel, title, subtitle, onRefresh, refreshing, actions }) {
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {backTo && (
          <Link
            to={backTo}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:text-emerald-200"
          >
            <span aria-hidden>←</span>
            <span>{backLabel || 'Back'}</span>
          </Link>
        )}
        <h1 className="dashboard-title">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {onRefresh && <RefreshButton onRefresh={onRefresh} loading={refreshing} />}
      </div>
    </div>
  )
}

// StatTile — small KPI-like number in the summary bar.
export function StatTile({ label, value, color }) {
  const colors = {
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
    indigo: 'text-indigo-200',
    rose: 'text-rose-200',
    slate: 'text-slate-200',
    green: 'text-emerald-200',
    cream: 'text-[#8A6D1F]',
  }
  return (
    <div className="dashboard-subpanel rounded-[16px] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${colors[color] || 'text-slate-100'}`}>{value}</p>
    </div>
  )
}

// VariantPill — colored badge used in tables.
export function VariantPill({ variant, label }) {
  const isPlain = variant === 'plain'
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${isPlain ? 'border-[#8A6D1F]/30 bg-[#FBF3D4]/40 text-[#8A6D1F]' : 'border-emerald-400/30 bg-emerald-400/12 text-emerald-200'}`}
    >
      {label}
    </span>
  )
}

// REASON_PILL — color + style mapping for attribution reasons.
export const REASON_PILL = {
  damaged:         'bg-rose-500/15 text-rose-200 border-rose-400/30',
  expired:         'bg-orange-500/15 text-[#9a3412] border-orange-400/30',
  customer_return: 'bg-yellow-500/15 text-[#854d0e] border-yellow-400/30',
  unsold:          'bg-slate-500/15 text-slate-200 border-slate-400/30',
  other:           'bg-sky-500/15 text-[#075985] border-sky-400/30',
}

export const REASON_FILL = {
  damaged: '#f43f5e',
  expired: '#f97316',
  customer_return: '#eab308',
  unsold: '#64748b',
  other: '#0ea5e9',
}

// Pagination — prev/next pager. Hidden if only one page.
export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded-full border border-[#E8E0D4] bg-[#F0EBE3] px-3 py-1 font-semibold text-slate-200 transition hover:bg-[#ECE5DA] disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="rounded-full border border-[#E8E0D4] bg-[#F0EBE3] px-3 py-1 font-semibold text-slate-200 transition hover:bg-[#ECE5DA] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}

// FadeIn — wraps page content with a 200ms fade-up entrance.
export function FadeIn({ children, className = '' }) {
  return (
    <div className={`animate-[fadeUp_200ms_ease-out] ${className}`}>
      {children}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// CSV export helper — coerces an array of objects into a CSV string and
// triggers a browser download.
export function downloadCsv(filename, rows, columns) {
  const escape = (val) => {
    if (val == null) return ''
    const s = String(val)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = columns.map((c) => escape(c.label)).join(',')
  const body = rows
    .map((row) => columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
    .join('\n')
  const csv = `${header}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// MonthlyLineChart — lightweight SVG line chart for the partner profile +
// variant detail pages. Two series: multigrain (green) + plain (cream).
// Hand-rolled to avoid the Recharts dep we previously removed.
export function MonthlyLineChart({ data, height = 180 }) {
  const w = 600
  const h = height
  const padding = { top: 14, right: 12, bottom: 22, left: 30 }
  const innerW = w - padding.left - padding.right
  const innerH = h - padding.top - padding.bottom
  if (!data || data.length === 0) {
    return (
      <div className="dashboard-subpanel flex h-[180px] items-center justify-center rounded-[20px] text-sm text-slate-400">
        No monthly data yet.
      </div>
    )
  }
  const maxY = Math.max(1, ...data.map((d) => Math.max(d.multigrain, d.plain)))
  const niceMax = Math.ceil(maxY / 5) * 5 || 5
  const xStep = innerW / Math.max(1, data.length - 1)
  const yScale = (v) => padding.top + innerH - (v / niceMax) * innerH
  const xScale = (i) => padding.left + i * xStep

  const path = (key) =>
    data
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[key]).toFixed(1)}`)
      .join(' ')

  return (
    <div className="dashboard-subpanel rounded-[20px] p-3">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
          {/* Y grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line
              key={i}
              x1={padding.left}
              y1={padding.top + innerH * (1 - t)}
              x2={w - padding.right}
              y2={padding.top + innerH * (1 - t)}
              stroke="#E8E0D4"
              strokeWidth={1}
            />
          ))}
          {/* Y labels */}
          {[0, niceMax / 2, niceMax].map((v, i) => (
            <text
              key={i}
              x={padding.left - 4}
              y={yScale(v) + 3}
              fill="#7c8a9a"
              fontSize="9"
              textAnchor="end"
            >
              {Math.round(v)}
            </text>
          ))}
          {/* X labels */}
          {data.map((d, i) => (
            <text
              key={i}
              x={xScale(i)}
              y={h - 6}
              fill="#7c8a9a"
              fontSize="9"
              textAnchor="middle"
            >
              {d.label}
            </text>
          ))}
          {/* Lines */}
          <path d={path('multigrain')} fill="none" stroke="#024628" strokeWidth={2.5} />
          <path d={path('plain')} fill="none" stroke="#FBF3D4" strokeWidth={2.5} />
          {/* Points */}
          {data.map((d, i) => (
            <g key={`pt-${i}`}>
              <circle cx={xScale(i)} cy={yScale(d.multigrain)} r={2.5} fill="#024628" />
              <circle cx={xScale(i)} cy={yScale(d.plain)} r={2.5} fill="#FBF3D4" />
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex justify-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#024628' }} /> Multi-Grain
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#FBF3D4' }} /> Plain
        </span>
      </div>
    </div>
  )
}

// ReasonBars — horizontal mini bars summing to a total. Used by Attributed
// and VariantDetail pages.
export function ReasonBars({ counts, reasons, total }) {
  return (
    <div className="dashboard-subpanel rounded-[20px] p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Breakdown by reason</p>
      <div className="space-y-2">
        {reasons.map((r) => {
          const units = counts[r.value] || 0
          const pct = total > 0 ? (units / total) * 100 : 0
          return (
            <div key={r.value} className="flex items-center gap-3">
              <span className={`inline-flex w-32 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${REASON_PILL[r.value]}`}>
                {r.label}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[#F0EBE3]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%`, backgroundColor: REASON_FILL[r.value] }}
                />
              </div>
              <span className="w-16 text-right text-xs text-slate-300">{units} ({pct.toFixed(0)}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

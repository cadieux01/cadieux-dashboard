export default function KPICard({ title, value, subtitle, icon, trend, trendUp, color = 'indigo' }) {
  const themes = {
    indigo: {
      glow: 'from-indigo-400/18 via-indigo-300/6 to-transparent',
      icon: 'bg-indigo-400/14 text-indigo-200',
      badge: 'bg-indigo-400/12 text-indigo-100',
      border: 'border-indigo-300/12',
    },
    emerald: {
      glow: 'from-emerald-400/18 via-emerald-300/6 to-transparent',
      icon: 'bg-emerald-400/14 text-emerald-100',
      badge: 'bg-emerald-400/12 text-emerald-100',
      border: 'border-emerald-300/12',
    },
    amber: {
      glow: 'from-amber-300/18 via-amber-200/6 to-transparent',
      icon: 'bg-amber-300/14 text-amber-100',
      badge: 'bg-amber-300/12 text-amber-100',
      border: 'border-amber-200/12',
    },
    rose: {
      glow: 'from-rose-300/18 via-rose-200/6 to-transparent',
      icon: 'bg-rose-300/14 text-rose-100',
      badge: 'bg-rose-300/12 text-rose-100',
      border: 'border-rose-200/12',
    },
    purple: {
      glow: 'from-violet-300/18 via-violet-200/6 to-transparent',
      icon: 'bg-violet-300/14 text-violet-100',
      badge: 'bg-violet-300/12 text-violet-100',
      border: 'border-violet-200/12',
    },
  }

  const theme = themes[color] || themes.indigo

  return (
    <div
      className={`dashboard-panel rounded-[28px] p-5 sm:p-6 ${theme.border}`}
    >
      <div className={`absolute -right-10 -top-12 h-28 w-28 rounded-full bg-gradient-to-br ${theme.glow} blur-3xl`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${theme.badge}`}>
            {title}
          </div>
          <p className="mt-4 font-display text-3xl font-semibold tracking-[-0.05em] text-white sm:text-[2.2rem]">
            {value}
          </p>
          {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
          {trend !== undefined && (
            <div
              className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${
                trendUp ? 'bg-emerald-400/12 text-emerald-200' : 'bg-rose-400/12 text-rose-200'
              }`}
            >
              <svg className={`h-4 w-4 ${trendUp ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span>{trend}%</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${theme.icon}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

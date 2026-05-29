export default function AlertBanner({ type = 'warning', title, message, onDismiss }) {
  const styles = {
    warning: {
      bg: 'border-amber-300/18 bg-amber-400/8',
      icon: 'text-amber-200',
      title: 'text-amber-100',
    },
    error: {
      bg: 'border-rose-300/18 bg-rose-400/8',
      icon: 'text-rose-200',
      title: 'text-rose-100',
    },
    success: {
      bg: 'border-emerald-300/18 bg-emerald-400/8',
      icon: 'text-emerald-100',
      title: 'text-emerald-100',
    },
    info: {
      bg: 'border-indigo-300/18 bg-indigo-400/8',
      icon: 'text-indigo-100',
      title: 'text-indigo-100',
    },
  }

  const style = styles[type]

  const icons = {
    warning: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }

  return (
    <div className={`${style.bg} flex items-start gap-3 rounded-[24px] border p-4 shadow-[0_20px_45px_rgba(2,6,23,0.2)] backdrop-blur-xl`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.05] ${style.icon}`}>{icons[type]}</div>
      <div className="flex-1">
        <h4 className={`font-semibold ${style.title}`}>{title}</h4>
        {message && <p className="text-slate-400 text-sm mt-1">{message}</p>}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-slate-500 transition-colors hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

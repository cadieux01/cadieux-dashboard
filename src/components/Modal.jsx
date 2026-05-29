export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/68 backdrop-blur-md"
        onClick={onClose}
      />

      <div className="relative flex min-h-full items-start justify-center py-4 sm:items-center sm:py-0">
        {/* Modal - Mobile-first responsive */}
        <div className="dashboard-panel relative w-full max-w-md overflow-hidden rounded-[28px]">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/8 bg-slate-950/88 p-4 backdrop-blur-xl sm:p-6">
            <h2 className="pr-2 font-display text-base font-semibold tracking-tight text-white sm:text-lg">{title}</h2>
            <button
              onClick={onClose}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border border-white/8 text-slate-400 transition-all hover:border-white/12 hover:bg-white/[0.05] hover:text-white"
              aria-label="Close"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div
            className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-4 [webkit-overflow-scrolling:touch] sm:max-h-[calc(100dvh-8rem)] sm:p-6"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}










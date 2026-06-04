export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(2,70,40,0.4)] backdrop-blur-md"
        onClick={onClose}
      />

      <div className="relative flex min-h-full items-start justify-center py-4 sm:items-center sm:py-0">
        {/* Modal - Mobile-first responsive */}
        <div className="dashboard-panel relative w-full max-w-[400px] overflow-hidden rounded-2xl">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E8E0D4] bg-white/95 px-4 py-3 backdrop-blur-xl">
            <h2 className="pr-2 font-display text-base font-semibold tracking-tight text-slate-100">{title}</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-[#E8E0D4] text-slate-400 transition-all hover:border-[#D1C9BC] hover:bg-[#F0EBE3] hover:text-slate-100"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div
            className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-4 [webkit-overflow-scrolling:touch] sm:max-h-[calc(100dvh-8rem)]"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}










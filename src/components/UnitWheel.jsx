import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================================
// UnitWheel — iOS Clock-style scroll-wheel picker for unit counts.
// ----------------------------------------------------------------------------
// Replaces +/- steppers everywhere a "units" value is entered. The centred
// number is the selected value; a highlighted band marks the centre and the
// top/bottom fade out. It does NOT wrap/loop — it stops cleanly at min and max.
//
// Input methods (all supported):
//   • touch drag / flick   (native overflow scroll + scroll-snap, great on iPad)
//   • mouse wheel / trackpad scroll  (native overflow scroll)
//   • keyboard ↑/↓ / PageUp/PageDown / Home/End  (focusable, a11y)
//   • tap the centre value to type a number directly (kept in sync, clamped)
//
// Props:
//   value     number      current value (clamped into [min,max] on render)
//   onChange  (n)=>void   called with a NUMBER whenever the selection changes
//   min       number      default 0
//   max       number      default 100 (the ceiling — set per usage)
//   label     string?     small heading above the wheel
//   hint      string?     small caption below the wheel
//   disabled  boolean?    render read-only
//   emptyMessage string?  shown (disabled) when max<=min (e.g. "0 available")
// ============================================================================

const ITEM_H = 40 // px per row
const PAD = ITEM_H * 2 // top/bottom padding so first/last value can centre

export default function UnitWheel({
  value,
  onChange,
  min = 0,
  max = 100,
  label,
  hint,
  disabled = false,
  emptyMessage = '0 available',
}) {
  const scrollerRef = useRef(null)
  const snapTimer = useRef(null)
  const isUserScrolling = useRef(false)
  const [typing, setTyping] = useState(false)
  const [typeBuf, setTypeBuf] = useState('')

  const lo = min
  const hi = Math.max(min, max)
  const safeMax = hi <= lo // only one value possible
  const current = Math.max(lo, Math.min(hi, Number(value) || 0))

  const numbers = []
  for (let n = lo; n <= hi; n++) numbers.push(n)

  // Scroll the wheel so `n` sits in the centre band.
  const scrollToValue = useCallback(
    (n, smooth) => {
      const el = scrollerRef.current
      if (!el) return
      el.scrollTo({ top: (n - lo) * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
    },
    [lo],
  )

  // Keep the wheel aligned with the external value when it changes from outside
  // (e.g. a max change clamps it) — but never fight an in-progress user scroll.
  useEffect(() => {
    if (isUserScrolling.current || typing) return
    scrollToValue(current, false)
  }, [current, scrollToValue, typing])

  const commit = (n) => {
    const clamped = Math.max(lo, Math.min(hi, n))
    if (clamped !== current) onChange(clamped)
  }

  const handleScroll = () => {
    if (disabled || safeMax) return
    isUserScrolling.current = true
    if (snapTimer.current) clearTimeout(snapTimer.current)
    snapTimer.current = setTimeout(() => {
      const el = scrollerRef.current
      if (!el) return
      const idx = Math.round(el.scrollTop / ITEM_H)
      const n = Math.max(lo, Math.min(hi, lo + idx))
      // Snap exactly onto the row, then report the value.
      el.scrollTo({ top: (n - lo) * ITEM_H, behavior: 'smooth' })
      isUserScrolling.current = false
      commit(n)
    }, 120)
  }

  const handleKey = (e) => {
    if (disabled || safeMax) return
    let n = current
    if (e.key === 'ArrowUp') n = current - 1
    else if (e.key === 'ArrowDown') n = current + 1
    else if (e.key === 'PageUp') n = current - 5
    else if (e.key === 'PageDown') n = current + 5
    else if (e.key === 'Home') n = lo
    else if (e.key === 'End') n = hi
    else return
    e.preventDefault()
    const clamped = Math.max(lo, Math.min(hi, n))
    scrollToValue(clamped, true)
    commit(clamped)
  }

  const startTyping = () => {
    if (disabled || safeMax) return
    setTypeBuf(String(current))
    setTyping(true)
  }
  const finishTyping = () => {
    const digits = typeBuf.replace(/[^0-9]/g, '')
    const n = digits === '' ? lo : Math.max(lo, Math.min(hi, parseInt(digits, 10)))
    setTyping(false)
    scrollToValue(n, false)
    commit(n)
  }

  if (safeMax) {
    return (
      <div className="rounded-xl border border-[#E8E0D4] bg-[#F0EBE3] p-3">
        {label && <p className="mb-2 text-center text-xs font-semibold text-[#3C4A40]">{label}</p>}
        <p className="py-6 text-center text-sm font-semibold text-[#5C6D62]">{emptyMessage}</p>
        {hint && <p className="mt-1.5 text-center text-xs text-[#5C6D62]">{hint}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E8E0D4] bg-[#F0EBE3] p-3">
      {label && <p className="mb-2 text-center text-xs font-semibold text-[#3C4A40]">{label}</p>}

      <div
        className={`relative mx-auto w-full max-w-[180px] select-none ${disabled ? 'opacity-50' : ''}`}
        style={{ height: ITEM_H * 5 }}
      >
        {/* centre highlight band */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg border-y-2 border-[#024628]/30 bg-[#024628]/5"
          style={{ height: ITEM_H }}
        />
        {/* top/bottom fade */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              'linear-gradient(to bottom, #F0EBE3 0%, rgba(240,235,227,0) 35%, rgba(240,235,227,0) 65%, #F0EBE3 100%)',
          }}
        />

        {typing ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={typeBuf}
              onChange={(e) => setTypeBuf(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={finishTyping}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); finishTyping() }
                if (e.key === 'Escape') { e.preventDefault(); setTyping(false) }
              }}
              className="w-20 rounded-lg border border-[#024628] bg-white px-2 py-1 text-center font-display text-[28px] font-bold leading-none text-[#1A2B1F] focus:outline-none"
            />
          </div>
        ) : (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            onKeyDown={handleKey}
            tabIndex={disabled ? -1 : 0}
            role="spinbutton"
            aria-label={label || 'Units'}
            aria-valuenow={current}
            aria-valuemin={lo}
            aria-valuemax={hi}
            className="hide-scrollbar absolute inset-0 overflow-y-scroll focus:outline-none focus:ring-2 focus:ring-[#024628] focus:ring-offset-0"
            style={{
              scrollSnapType: 'y mandatory',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
          >
            <div style={{ height: PAD }} />
            {numbers.map((n) => (
              <div
                key={n}
                onClick={n === current ? startTyping : () => { scrollToValue(n, true); commit(n) }}
                className={`flex cursor-pointer items-center justify-center font-display font-bold tabular-nums transition-colors ${
                  n === current ? 'text-[28px] text-[#024628]' : 'text-[20px] text-[#9AA89E]'
                }`}
                style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
              >
                {n}
              </div>
            ))}
            <div style={{ height: PAD }} />
          </div>
        )}
      </div>

      {!typing && (
        <p className="mt-1 text-center text-[11px] text-[#5C6D62]">tap number to type</p>
      )}
      {hint && <p className="mt-1.5 text-center text-xs text-[#5C6D62]">{hint}</p>}
    </div>
  )
}

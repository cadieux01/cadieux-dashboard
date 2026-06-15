import { useCallback, useEffect, useRef } from 'react'

// ============================================================================
// WheelDateTime — iOS Clock-style scroll-wheel date + time picker.
// ----------------------------------------------------------------------------
// Five spinning columns: Year · Month · Day · Hour : Minute. The centred row
// in each column is the selected value (highlight band + top/bottom fade).
// Controlled: `value` is a JS Date; `onChange(Date)` fires whenever a wheel
// settles. Auto-fills to "now" when value is missing/invalid (the parent seeds
// it with new Date()). No native <input type=date/time> → no OS popup, so the
// dough cursor never has to yield to a native control.
//
// Input methods: touch drag / flick, mouse-wheel / trackpad, keyboard
// (↑/↓/Home/End), and tap a row to select it. Days auto-clamp to the month.
// ============================================================================

const ITEM_H = 36 // px per row
const PAD = ITEM_H * 2 // top/bottom spacer so the first/last row can centre
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n) => String(n).padStart(2, '0')
const daysInMonth = (year, monthIdx) => new Date(year, monthIdx + 1, 0).getDate()

function Column({ items, index, onIndex, ariaLabel }) {
  const scrollerRef = useRef(null)
  const snapTimer = useRef(null)
  const isUserScrolling = useRef(false)

  const scrollToIndex = useCallback((i, smooth) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Re-align when the value changes from outside (e.g. day clamped by month),
  // but never fight an in-progress user scroll.
  useEffect(() => {
    if (isUserScrolling.current) return
    scrollToIndex(index, false)
  }, [index, scrollToIndex])

  const handleScroll = () => {
    isUserScrolling.current = true
    if (snapTimer.current) clearTimeout(snapTimer.current)
    snapTimer.current = setTimeout(() => {
      const el = scrollerRef.current
      if (!el) return
      let i = Math.round(el.scrollTop / ITEM_H)
      i = Math.max(0, Math.min(items.length - 1, i))
      el.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
      isUserScrolling.current = false
      if (i !== index) onIndex(i)
    }, 110)
  }

  const handleKey = (e) => {
    let i = index
    if (e.key === 'ArrowUp') i = index - 1
    else if (e.key === 'ArrowDown') i = index + 1
    else if (e.key === 'Home') i = 0
    else if (e.key === 'End') i = items.length - 1
    else return
    e.preventDefault()
    i = Math.max(0, Math.min(items.length - 1, i))
    scrollToIndex(i, true)
    if (i !== index) onIndex(i)
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      onKeyDown={handleKey}
      tabIndex={0}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuetext={String(items[index]?.label ?? '')}
      className="hide-scrollbar flex-1 select-none overflow-y-scroll focus:outline-none"
      style={{
        height: ITEM_H * 5,
        scrollSnapType: 'y mandatory',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      }}
    >
      <div style={{ height: PAD }} />
      {items.map((it, i) => (
        <div
          key={it.key}
          onClick={() => { scrollToIndex(i, true); if (i !== index) onIndex(i) }}
          className={`flex cursor-pointer items-center justify-center font-display font-bold tabular-nums transition-colors ${
            i === index ? 'text-[20px] text-[#024628]' : 'text-[15px] text-[#9AA89E]'
          }`}
          style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
        >
          {it.label}
        </div>
      ))}
      <div style={{ height: PAD }} />
    </div>
  )
}

export default function WheelDateTime({ value, onChange, label, hint }) {
  const d = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date()
  const baseYear = new Date().getFullYear()

  const years = []
  for (let y = baseYear - 1; y <= baseYear + 2; y++) years.push(y)

  const year = d.getFullYear()
  const monthIdx = d.getMonth()
  const day = d.getDate()
  const hour = d.getHours()
  const minute = d.getMinutes()

  const dim = daysInMonth(year, monthIdx)

  const yearItems = years.map((y) => ({ key: y, label: String(y) }))
  const monthItems = MONTHS.map((m, i) => ({ key: i, label: m }))
  const dayItems = Array.from({ length: dim }, (_, i) => ({ key: i + 1, label: pad2(i + 1) }))
  const hourItems = Array.from({ length: 24 }, (_, i) => ({ key: i, label: pad2(i) }))
  const minuteItems = Array.from({ length: 60 }, (_, i) => ({ key: i, label: pad2(i) }))

  const yearIndex = Math.max(0, years.indexOf(year))

  // Build a new Date from the parts, clamping the day to the chosen month.
  const emit = (y, mo, dy, hh, mm) => {
    const safeDay = Math.min(dy, daysInMonth(y, mo))
    onChange(new Date(y, mo, safeDay, hh, mm, 0, 0))
  }

  const Sep = ({ children }) => (
    <span className="flex items-center px-0.5 font-display text-lg font-bold text-[#024628]/40">{children}</span>
  )

  return (
    <div>
      {label && <p className="mb-1 block text-xs text-slate-400">{label}</p>}
      <div className="relative rounded-xl border border-[#E8E0D4] bg-[#F0EBE3] px-2 py-2">
        {/* centre highlight band */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-2 top-1/2 z-0 -translate-y-1/2 rounded-lg border-y-2 border-[#024628]/30 bg-[#024628]/5"
          style={{ height: ITEM_H }}
        />
        {/* top/bottom fade */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            background:
              'linear-gradient(to bottom, #F0EBE3 0%, rgba(240,235,227,0) 38%, rgba(240,235,227,0) 62%, #F0EBE3 100%)',
          }}
        />
        <div className="relative z-10 flex items-stretch">
          <Column items={yearItems} index={yearIndex} onIndex={(i) => emit(years[i], monthIdx, day, hour, minute)} ariaLabel="Year" />
          <Column items={monthItems} index={monthIdx} onIndex={(i) => emit(year, i, day, hour, minute)} ariaLabel="Month" />
          <Column items={dayItems} index={day - 1} onIndex={(i) => emit(year, monthIdx, i + 1, hour, minute)} ariaLabel="Day" />
          <Sep> </Sep>
          <Column items={hourItems} index={hour} onIndex={(i) => emit(year, monthIdx, day, i, minute)} ariaLabel="Hour" />
          <Sep>:</Sep>
          <Column items={minuteItems} index={minute} onIndex={(i) => emit(year, monthIdx, day, hour, i)} ariaLabel="Minute" />
        </div>
      </div>
      <p className="mt-1 text-center text-[11px] text-[#5C6D62]">scroll the wheels · defaults to now</p>
      {hint && <p className="mt-0.5 text-center text-xs text-[#5C6D62]">{hint}</p>}
    </div>
  )
}

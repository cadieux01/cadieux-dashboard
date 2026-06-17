import { useCallback, useEffect, useRef } from 'react'

// ============================================================================
// WheelDateTime — iOS Clock-style scroll-wheel date + time picker.
// ----------------------------------------------------------------------------
// Five clearly-separated spinning columns, each with a small label above it:
//   Month · Date · Hour · Minute · AM/PM   (12-hour clock).
// There is NO year wheel — the year is fixed to the value's year (current year
// when seeded with `new Date()`), so the picker never lets you scroll off into
// a wrong year. The centred row in each column is the selected value (shared
// highlight band + top/bottom fade).
//
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

function Column({ items, index, onIndex, ariaLabel, maxIndex }) {
  const scrollerRef = useRef(null)
  const snapTimer = useRef(null)
  const isUserScrolling = useRef(false)
  // Highest selectable row (out-of-range rows beyond it are greyed + inert).
  const cap = Number.isInteger(maxIndex) ? Math.max(0, Math.min(items.length - 1, maxIndex)) : items.length - 1

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
      i = Math.max(0, Math.min(cap, i))
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
    else if (e.key === 'End') i = cap
    else return
    e.preventDefault()
    i = Math.max(0, Math.min(cap, i))
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
      className="hide-scrollbar flex-1 select-none overflow-y-scroll rounded-lg bg-white/40 focus:outline-none focus:ring-2 focus:ring-[#024628]/30"
      style={{
        height: ITEM_H * 5,
        scrollSnapType: 'y mandatory',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      }}
    >
      <div style={{ height: PAD }} />
      {items.map((it, i) => {
        const blocked = i > cap
        return (
          <div
            key={it.key}
            onClick={() => { if (blocked) return; scrollToIndex(i, true); if (i !== index) onIndex(i) }}
            className={`flex items-center justify-center font-display font-bold tabular-nums transition-colors ${
              blocked
                ? 'cursor-not-allowed text-[15px] text-[#CDD3CD]'
                : i === index
                  ? 'cursor-pointer text-[20px] text-[#024628]'
                  : 'cursor-pointer text-[15px] text-[#9AA89E]'
            }`}
            style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
          >
            {it.label}
          </div>
        )
      })}
      <div style={{ height: PAD }} />
    </div>
  )
}

export default function WheelDateTime({ value, onChange, label, hint, max }) {
  const d = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date()
  // Optional upper bound (a JS Date). Future months/dates beyond it are greyed
  // out, and any settled value is clamped so it can never exceed `max`.
  const maxDate = max instanceof Date && !Number.isNaN(max.getTime()) ? max : null

  // Year is fixed (no wheel) — taken from the value so editing an existing
  // batch keeps its year; a fresh `new Date()` gives the current year.
  const year = d.getFullYear()
  const monthIdx = d.getMonth()
  const day = d.getDate()
  const hour24 = d.getHours()
  const minute = d.getMinutes()

  const isPM = hour24 >= 12
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12

  const dim = daysInMonth(year, monthIdx)

  const monthItems = MONTHS.map((m, i) => ({ key: i, label: m }))
  const dayItems = Array.from({ length: dim }, (_, i) => ({ key: i + 1, label: pad2(i + 1) }))
  const hourItems = Array.from({ length: 12 }, (_, i) => ({ key: i + 1, label: pad2(i + 1) }))
  const minuteItems = Array.from({ length: 60 }, (_, i) => ({ key: i, label: pad2(i) }))
  const ampmItems = [{ key: 'AM', label: 'AM' }, { key: 'PM', label: 'PM' }]

  // Build a new Date from the parts, clamping the day to the chosen month and
  // folding 12-hour + AM/PM back into a 24-hour value.
  const emit = (mo, dy, h12, mm, pm) => {
    const safeDay = Math.min(dy, daysInMonth(year, mo))
    const h24 = (h12 % 12) + (pm ? 12 : 0)
    let next = new Date(year, mo, safeDay, h24, mm, 0, 0)
    // Backstop clamp: a settled value can never exceed the bound (covers the
    // time wheels, which aren't index-greyed because of the AM/PM split).
    if (maxDate && next.getTime() > maxDate.getTime()) next = new Date(maxDate.getTime())
    onChange(next)
  }

  // Grey out future months/dates beyond the bound (same year — the bound is
  // capped to the end of the current day by the caller, so year never differs).
  const monthMaxIndex = maxDate && year >= maxDate.getFullYear() ? maxDate.getMonth() : 11
  const dateMaxIndex = !maxDate || year < maxDate.getFullYear()
    ? dim - 1
    : monthIdx < maxDate.getMonth()
      ? dim - 1
      : monthIdx === maxDate.getMonth()
        ? maxDate.getDate() - 1
        : 0

  const COLS = [
    { key: 'month', heading: 'Month', items: monthItems, index: monthIdx, maxIndex: monthMaxIndex,
      onIndex: (i) => emit(i, day, hour12, minute, isPM), aria: 'Month' },
    { key: 'date', heading: 'Date', items: dayItems, index: day - 1, maxIndex: dateMaxIndex,
      onIndex: (i) => emit(monthIdx, i + 1, hour12, minute, isPM), aria: 'Date' },
    { key: 'hour', heading: 'Hour', items: hourItems, index: hour12 - 1,
      onIndex: (i) => emit(monthIdx, day, i + 1, minute, isPM), aria: 'Hour' },
    { key: 'minute', heading: 'Min', items: minuteItems, index: minute,
      onIndex: (i) => emit(monthIdx, day, hour12, i, isPM), aria: 'Minute' },
    { key: 'ampm', heading: 'AM/PM', items: ampmItems, index: isPM ? 1 : 0,
      onIndex: (i) => emit(monthIdx, day, hour12, minute, i === 1), aria: 'AM or PM' },
  ]

  return (
    <div>
      {label && <p className="mb-1 block text-xs text-slate-400">{label}</p>}
      <div className="rounded-xl border border-[#E8E0D4] bg-[#F0EBE3] px-2 pb-2 pt-1.5">
        {/* per-column labels */}
        <div className="mb-1 flex gap-1.5">
          {COLS.map((c) => (
            <span key={c.key} className="flex-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[#5C6D62]">
              {c.heading}
            </span>
          ))}
        </div>

        {/* wheels */}
        <div className="relative">
          {/* centre highlight band */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 rounded-lg border-y-2 border-[#024628]/30 bg-[#024628]/5"
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
          <div className="relative z-10 flex gap-1.5">
            {COLS.map((c) => (
              <Column key={c.key} items={c.items} index={c.index} onIndex={c.onIndex} ariaLabel={c.aria} maxIndex={c.maxIndex} />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1 text-center text-[11px] text-[#5C6D62]">scroll the wheels · defaults to now</p>
      {hint && <p className="mt-0.5 text-center text-xs text-[#5C6D62]">{hint}</p>}
    </div>
  )
}

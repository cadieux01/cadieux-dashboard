import { useEffect, useRef, useState } from 'react'

// Dough cursor — ported from cadieux.in (the public site uses a GSAP-driven
// version; this repo has no GSAP, so the same effect is reproduced with a
// single requestAnimationFrame loop and transform/opacity writes only).
//
// A small gold dot lags behind the pointer; the gap between the pointer and
// the rendered dot IS the velocity, which drives an elastic stretch along the
// direction of travel and a squish perpendicular to it. When the pointer stops
// the dot springs back to round. GPU-friendly: every per-frame write is a
// single `transform`, plus an `opacity` reveal handled by CSS transition.
//
// Gating (matches the site): desktop fine-pointer only, and reduced-motion
// bails entirely so the native cursor shows instead. The native pointer is
// hidden via the `html.dough-cursor` CSS rules (see index.css); text inputs
// keep their I-beam. `pointer-events: none` means the dot never intercepts
// clicks, dropdowns, or form controls.
export default function DoughCursor() {
  const dotRef = useRef(null)
  const [active, setActive] = useState(false)

  // Decide once on mount whether the cursor should run at all.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setActive(true)
  }, [])

  useEffect(() => {
    if (!active) return
    const dot = dotRef.current
    if (!dot) return

    const root = document.documentElement
    root.classList.add('dough-cursor')

    let px = window.innerWidth / 2
    let py = window.innerHeight / 2
    let rx = px // rendered (lagged) position
    let ry = py
    let sx = 1 // current scale, eased toward the target each frame
    let sy = 1
    let lastAngle = 0
    let seenMove = false
    let rafId = 0

    const render = () => {
      // Centre on the pointer via calc(-50%), then rotate + stretch around
      // the dot's own centre (default transform-origin).
      dot.style.transform =
        `translate3d(calc(${rx}px - 50%), calc(${ry}px - 50%), 0) rotate(${lastAngle}deg) scaleX(${sx}) scaleY(${sy})`
    }
    render()

    const tick = () => {
      const dx = px - rx
      const dy = py - ry
      rx += dx * 0.62
      ry += dy * 0.62
      const speed = Math.hypot(dx, dy)
      const stretch = Math.min(speed * 0.05, 0.85)
      const tx = 1 + stretch // along movement
      const ty = 1 - stretch * 0.6 // perpendicular squish
      sx += (tx - sx) * 0.25
      sy += (ty - sy) * 0.25
      // Only re-aim while moving; when still, keep the last angle (round dot).
      if (speed > 0.5) lastAngle = (Math.atan2(dy, dx) * 180) / Math.PI
      render()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    const onMove = (e) => {
      px = e.clientX
      py = e.clientY
      if (!seenMove) {
        seenMove = true
        dot.style.opacity = '1'
      }
    }
    const onLeave = () => {
      dot.style.opacity = '0'
    }
    const onEnter = () => {
      if (seenMove) dot.style.opacity = '1'
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('mouseenter', onEnter)
      root.classList.remove('dough-cursor')
    }
  }, [active])

  if (!active) return null
  return <div ref={dotRef} className="dough-cursor-dot" aria-hidden="true" />
}

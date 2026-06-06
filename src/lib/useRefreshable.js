import { useCallback, useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 60 // px pulled down before a refresh triggers
const MAX_PULL = 90

/**
 * Shared refresh state for a data page:
 *   - refresh()     re-runs the page's fetch fn, tracks loading, stamps lastUpdated
 *   - refreshing    true while the fetch is in flight
 *   - lastUpdated   ms timestamp of the last successful refresh
 *   - pullDistance  current pull-to-refresh drag distance (px), for the indicator
 *
 * Also wires pull-to-refresh: on touch devices, dragging down from the top of
 * the scroll container (the <main> element) past 60px triggers refresh().
 *
 * Pass `{ auto: true }` to keep the page live without a manual reload: it
 * re-fetches when the tab regains focus/visibility and on a polling interval
 * (default 30s, only while the tab is visible).
 */
export default function useRefreshable(refreshFn, { auto = false, intervalMs = 30000 } = {}) {
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(() => Date.now())
  const [pullDistance, setPullDistance] = useState(0)
  const fnRef = useRef(refreshFn)
  fnRef.current = refreshFn

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fnRef.current?.()
    } catch (err) {
      console.error('Refresh failed:', err)
    } finally {
      setRefreshing(false)
      setLastUpdated(Date.now())
    }
  }, [])

  // Live auto-refresh: refetch on focus/visibility and a polling interval so a
  // change made elsewhere (e.g. a partner records a sale) shows up without the
  // user manually reloading or hitting refresh.
  useEffect(() => {
    if (!auto) return
    const onFocus = () => refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const id = intervalMs > 0
      ? setInterval(() => { if (document.visibilityState === 'visible') refresh() }, intervalMs)
      : null
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      if (id) clearInterval(id)
    }
  }, [auto, intervalMs, refresh])

  useEffect(() => {
    const scroller = document.querySelector('main')
    if (!scroller) return

    let startY = null
    let active = false
    let pull = 0

    const onStart = (e) => {
      if (scroller.scrollTop <= 0) {
        startY = e.touches[0].clientY
        active = true
      } else {
        active = false
      }
    }
    const onMove = (e) => {
      if (!active || startY === null) return
      const delta = e.touches[0].clientY - startY
      if (delta > 0 && scroller.scrollTop <= 0) {
        pull = Math.min(delta, MAX_PULL)
        setPullDistance(pull)
      }
    }
    const onEnd = () => {
      if (active && pull > PULL_THRESHOLD) refresh()
      pull = 0
      startY = null
      active = false
      setPullDistance(0)
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: true })
    scroller.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
    }
  }, [refresh])

  return { refresh, refreshing, lastUpdated, pullDistance }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  getMyNotifications,
  markNotificationsRead,
  relativeTime,
} from '../lib/notifications'

// Phone-style notification bell + unread badge, fixed top-right on every
// portal. Tap opens a panel (dropdown on desktop, full-width sheet on mobile)
// listing the caller's own notifications newest-first; opening marks them read
// so the badge clears. Each role sees ONLY its own feed (RLS-scoped RPC).
export default function NotificationBell() {
  const { user, isDemo } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const openRef = useRef(open)
  openRef.current = open

  const load = useCallback(() => {
    // Don't refetch while the panel is open — preserve the read/unread snapshot
    // the user is currently looking at.
    if (openRef.current) return
    getMyNotifications(30)
      .then(({ unreadCount, items: rows }) => {
        setItems(rows)
        setUnread(unreadCount)
      })
      .catch(() => {})
  }, [])

  // Live polling (same pattern the sidebar badge uses): mount, focus/visibility,
  // 45s interval. Disabled in demo / when signed out.
  useEffect(() => {
    if (isDemo || !user) return
    load()
    const onFocus = () => load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 45000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [isDemo, user, load])

  const handleOpen = () => {
    setOpen(true)
    if (unread > 0) {
      setUnread(0)
      markNotificationsRead().catch(() => {})
    }
  }

  const handleClose = () => {
    setOpen(false)
    // Refresh after closing so the next view reflects persisted read-state.
    setTimeout(load, 0)
  }

  if (isDemo || !user) return null

  return (
    <>
      <button
        onClick={open ? handleClose : handleOpen}
        className="fixed top-4 right-16 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-[#E8E0D4] bg-white text-[#024628] shadow-lg transition-all hover:text-[#035c36] lg:right-4"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-[55] bg-[rgba(2,70,40,0.25)] lg:bg-transparent"
            onClick={handleClose}
          />

          {/* Panel: full-width sheet on mobile, dropdown on desktop */}
          <div className="fixed left-2 right-2 top-16 z-[56] max-h-[70vh] overflow-hidden rounded-2xl border border-[#E8E0D4] bg-white shadow-2xl lg:left-auto lg:right-4 lg:w-96">
            <div className="flex items-center justify-between border-b border-[#E8E0D4] px-4 py-3">
              <h3 className="text-sm font-bold text-[#024628]">Notifications</h3>
              <button
                onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[calc(70vh-3rem)] overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <Bell size={28} className="text-slate-300" />
                  <p className="text-sm text-slate-400">No notifications yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-[#F0EAE0]">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 ${
                        n.is_read ? '' : 'bg-[rgba(2,70,40,0.05)]'
                      }`}
                    >
                      {!n.is_read && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#024628]" />
                      )}
                      <div className={`min-w-0 flex-1 ${n.is_read ? 'pl-5' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">
                            {n.title}
                          </p>
                          <span className="flex-shrink-0 text-[11px] font-medium text-slate-400">
                            {relativeTime(n.created_at)}
                          </span>
                        </div>
                        {n.message && (
                          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
                            {n.message}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

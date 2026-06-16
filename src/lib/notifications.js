import { supabase } from './supabase'

// ============================================================================
// notifications.js — data layer for the in-app notification bell.
//
// Backed by logistics.notifications (per-recipient feed, RLS-scoped to the
// caller). Rows are written by AFTER triggers on the event tables; the client
// only ever reads its own feed and marks its own rows read, via two
// SECURITY DEFINER RPCs.
// ============================================================================

// Fetch the caller's recent notifications + unread count in one round trip.
// Returns { unreadCount, items: [{ id, type, title, message, related_id,
// is_read, created_at }] }, newest-first.
export async function getMyNotifications(limit = 30) {
  const { data, error } = await supabase.rpc('get_my_notifications', {
    p_limit: limit,
  })
  if (error) throw error
  const payload = data || {}
  return {
    unreadCount: payload.unread_count || 0,
    items: Array.isArray(payload.items) ? payload.items : [],
  }
}

// Mark notifications read. Pass an array of ids to mark specific ones, or omit
// to mark ALL of the caller's unread notifications read. Returns the count
// updated.
export async function markNotificationsRead(ids = null) {
  const { data, error } = await supabase.rpc('mark_notifications_read', {
    p_ids: ids && ids.length ? ids : null,
  })
  if (error) throw error
  return data || 0
}

// Compact relative timestamp: "now", "5m", "2h", "3d", else a short date.
export function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 0) return 'now'
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w`
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

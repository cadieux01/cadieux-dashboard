// adminBridge.js — shared dashboard ↔ cadieux.in website admin API bridge.
//
// SECURITY MODEL
//   The dashboard runs in the browser with only the anon publishable key
//   (logistics-schema-scoped). It does NOT carry the website's ADMIN_TOKEN
//   or Supabase service-role key. To act on the website's admin endpoints
//   (order-change-requests, delivery-requests, WhatsApp conversations) we:
//     1. Forward our Supabase JWT to the `dashboard-admin-bridge` Edge
//        Function (Cadieux-Website project). That function verifies the
//        JWT, checks logistics.profiles for active admin/sales, and mints
//        a 1-hour HMAC-SHA256 session token (algorithm matches the
//        website's signAdminSession / verifyAdminSessionToken pair).
//     2. We POST that token as `Authorization: Bearer <token>` to the
//        website's admin endpoints. The website's `isAdmin(req)` accepts
//        EITHER the admin_session cookie OR a Bearer header carrying that
//        same token.
//   At no point does the browser see ADMIN_TOKEN or the service-role key.
//
// The minted token is cached in sessionStorage so we don't re-mint on
// every action; we refresh it when missing or within a 60s safety margin
// of its `expires_at`.
//
// WHY THIS MODULE EXISTS (the "Unauthorized" fix)
//   Root cause of the intermittent "Unauthorized" the super-admin saw:
//   `mintBridgeToken` used `supabase.auth.getSession()`, which hands back
//   whatever access_token is cached — and after the tab has been asleep
//   that Supabase JWT (≈1h TTL) is frequently EXPIRED, because the
//   autorefresh timer does not fire while the tab is backgrounded and
//   getSession() does NOT proactively refresh. The bridge then rejects the
//   stale JWT with 401 ("Invalid or expired session") and the dashboard
//   surfaced that as "Unauthorized". The old website-401 retry didn't help
//   because it re-minted with the SAME stale JWT.
//
//   The fix: before minting, if the access_token is missing or within
//   JWT_REFRESH_MARGIN_S of expiry, force `supabase.auth.refreshSession()`
//   to obtain a fresh JWT; and if the bridge still answers 401, retry the
//   mint ONCE with a forced refresh. Recovery is silent — no user-visible
//   "Unauthorized". This lives in ONE module so customerRequests.js and
//   whatsappChat.js can't drift apart.

import { supabase } from './supabase'

const BRIDGE_URL =
  import.meta.env?.VITE_DASHBOARD_BRIDGE_URL ||
  'https://uejagupcwevadfhfuadv.supabase.co/functions/v1/dashboard-admin-bridge'

const WEBSITE_BASE =
  import.meta.env?.VITE_CADIEUX_WEBSITE_URL || 'https://www.cadieux.in'

const TOKEN_CACHE_KEY = 'cdx_dashboard_admin_token'
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000 // re-mint if <60s left
// Refresh the Supabase JWT proactively if it has <2 min of life left, so
// the bridge never sees an about-to-expire (or already-expired) token.
const JWT_REFRESH_MARGIN_S = 120

// ---------------------------------------------------------------------------
// Bridge token cache
// ---------------------------------------------------------------------------

function readCachedToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.token || typeof parsed.expires_at !== 'number') return null
    if (parsed.expires_at - Date.now() < TOKEN_REFRESH_MARGIN_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedToken(value) {
  try {
    sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(value))
  } catch {
    /* sessionStorage may be unavailable; just skip caching */
  }
}

function clearCachedToken() {
  try {
    sessionStorage.removeItem(TOKEN_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Fresh Supabase JWT
// ---------------------------------------------------------------------------

// Returns a Supabase access_token that is NOT about to expire. getSession()
// can hand back an expired JWT after the tab has been backgrounded (the
// autorefresh timer doesn't fire while asleep), which the bridge rejects
// with 401. So when the token is missing or near expiry — or when the
// caller forces it — we call refreshSession() to mint a new one first.
async function getFreshAccessToken({ forceRefresh = false } = {}) {
  const { data } = await supabase.auth.getSession()
  let session = data?.session ?? null

  const nowS = Math.floor(Date.now() / 1000)
  const nearExpiry =
    typeof session?.expires_at === 'number' &&
    session.expires_at - nowS < JWT_REFRESH_MARGIN_S

  if (forceRefresh || !session?.access_token || nearExpiry) {
    const { data: refreshed, error } = await supabase.auth.refreshSession()
    if (!error && refreshed?.session?.access_token) {
      session = refreshed.session
    }
  }

  return session?.access_token ?? null
}

// ---------------------------------------------------------------------------
// Mint / get bridge token
// ---------------------------------------------------------------------------

async function mintBridgeToken({ forceRefresh = false, retry = true } = {}) {
  const jwt = await getFreshAccessToken({ forceRefresh })
  if (!jwt) throw new Error('Not signed in')

  let res
  try {
    res = await fetch(BRIDGE_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    })
  } catch (e) {
    throw new Error(
      `Could not reach the admin bridge (${e?.message || 'fetch failed'}). ` +
        'Check that dashboard-admin-bridge is deployed and ALLOWED_ORIGIN ' +
        `includes "${window.location.origin}".`,
    )
  }

  // The bridge rejected our JWT as invalid/expired. Our cached session token
  // was likely stale — force a real refresh and try exactly once more. This
  // is what turns the old visible "Unauthorized" into a silent recovery.
  if (res.status === 401 && retry) {
    return mintBridgeToken({ forceRefresh: true, retry: false })
  }

  let body = null
  let raw = null
  try {
    raw = await res.text()
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const msg =
      (body && (body.error || body.message)) ||
      (raw && raw.trim()) ||
      `Bridge returned HTTP ${res.status}`
    throw new Error(msg)
  }
  if (!body?.token || typeof body?.expires_at !== 'number') {
    throw new Error('Bridge response missing token / expires_at')
  }
  const cached = { token: body.token, expires_at: body.expires_at }
  writeCachedToken(cached)
  return cached
}

async function getBridgeToken() {
  const cached = readCachedToken()
  if (cached) return cached
  return mintBridgeToken()
}

// ---------------------------------------------------------------------------
// Website admin API wrapper
// ---------------------------------------------------------------------------

export async function callAdmin(path, { method = 'GET', body, retry = true } = {}) {
  const { token } = await getBridgeToken()
  const url = `${WEBSITE_BASE}${path}`
  let res
  try {
    res = await fetch(url, {
      method,
      mode: 'cors',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new Error(`Could not reach ${url} (${e?.message || 'fetch failed'}).`)
  }

  if (res.status === 401 && retry) {
    // The minted admin token was rejected — usually because the underlying
    // Supabase JWT went stale between mint and use. Drop the cache and
    // re-mint with a FORCED JWT refresh so recovery is silent, then retry
    // the call once.
    clearCachedToken()
    await mintBridgeToken({ forceRefresh: true, retry: false })
    return callAdmin(path, { method, body, retry: false })
  }

  let parsed = null
  let raw = null
  try {
    raw = await res.text()
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  if (!res.ok) {
    const msg =
      (parsed && (parsed.error || parsed.message)) ||
      (raw && raw.trim()) ||
      `Admin API returned HTTP ${res.status}`
    throw new Error(msg)
  }
  return parsed
}

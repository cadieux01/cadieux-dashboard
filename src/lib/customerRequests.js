// customerRequests.js — dashboard ↔ cadieux.in website admin API bridge.
//
// SECURITY MODEL
//   The dashboard runs in the browser with only the anon publishable key
//   (logistics-schema-scoped). It does NOT carry the website's ADMIN_TOKEN
//   or Supabase service-role key. To approve/reject order-change-requests
//   and delivery-requests on the website, we:
//     1. Forward our Supabase JWT to the `dashboard-admin-bridge` Edge
//        Function (Cadieux-Website project). That function verifies the
//        JWT, checks logistics.profiles for active admin/sales, and mints
//        a 1-hour HMAC-SHA256 session token (algorithm matches the
//        website's signAdminSession / verifyAdminSessionToken pair).
//     2. We POST that token as `Authorization: Bearer <token>` to the
//        website's admin endpoints. The website's `isAdmin(req)` accepts
//        EITHER the admin_session cookie OR a Bearer header carrying that
//        same token.
//
//   At no point does the browser see ADMIN_TOKEN or the service-role key.
//
// The minted token is cached in sessionStorage so we don't re-mint on
// every action; we refresh it when missing or within a 60s safety margin
// of its `expires_at`.

import { supabase } from './supabase'

const BRIDGE_URL =
  import.meta.env?.VITE_DASHBOARD_BRIDGE_URL ||
  'https://uejagupcwevadfhfuadv.supabase.co/functions/v1/dashboard-admin-bridge'

const WEBSITE_BASE =
  import.meta.env?.VITE_CADIEUX_WEBSITE_URL || 'https://www.cadieux.in'

const TOKEN_CACHE_KEY = 'cdx_dashboard_admin_token'
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000 // re-mint if <60s left

// ---------------------------------------------------------------------------
// Bridge token cache + fetcher
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

async function mintBridgeToken() {
  const { data: sessionWrap } = await supabase.auth.getSession()
  const jwt = sessionWrap?.session?.access_token
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

async function callAdmin(path, { method = 'GET', body, retry = true } = {}) {
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
    throw new Error(
      `Could not reach ${url} (${e?.message || 'fetch failed'}).`,
    )
  }

  if (res.status === 401 && retry) {
    // Token may have just expired — drop cache and try once more.
    clearCachedToken()
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

// ---------------------------------------------------------------------------
// Order change requests (delivery / items / address)
// ---------------------------------------------------------------------------

export async function listOrderChangeRequests(status = 'pending') {
  const data = await callAdmin(
    `/api/admin/order-change-requests?status=${encodeURIComponent(status)}`,
  )
  return Array.isArray(data?.requests) ? data.requests : []
}

export async function approveOrderChangeRequest(id, adminResponse) {
  return callAdmin(`/api/admin/order-change-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      action: 'approve',
      ...(adminResponse ? { admin_response: adminResponse } : {}),
    },
  })
}

export async function rejectOrderChangeRequest(id, adminResponse) {
  return callAdmin(`/api/admin/order-change-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      action: 'reject',
      ...(adminResponse ? { admin_response: adminResponse } : {}),
    },
  })
}

// ---------------------------------------------------------------------------
// Delivery requests (unserviceable pincode "please deliver here")
// ---------------------------------------------------------------------------

export async function listDeliveryRequests(status = 'pending') {
  const data = await callAdmin(
    `/api/admin/delivery-requests?status=${encodeURIComponent(status)}`,
  )
  return Array.isArray(data?.requests) ? data.requests : []
}

export async function markDeliveryRequestServiceable(id, { areaName, note } = {}) {
  return callAdmin(
    `/api/admin/delivery-requests/${encodeURIComponent(id)}/mark-serviceable`,
    {
      method: 'POST',
      body: {
        ...(areaName ? { area_name: areaName } : {}),
        ...(note ? { note } : {}),
      },
    },
  )
}

export async function rejectDeliveryRequest(id, note) {
  return callAdmin(
    `/api/admin/delivery-requests/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: note ? { note } : {},
    },
  )
}

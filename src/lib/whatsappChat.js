// whatsappChat.js — dashboard ↔ cadieux.in website admin API bridge for
// WhatsApp conversations (super-admin Chat page).
//
// SECURITY: identical bridge model to `customerRequests.js`. The browser
// forwards its Supabase JWT to `dashboard-admin-bridge`, which mints a 1h
// HMAC-SHA256 admin_session token. That token is sent as
// `Authorization: Bearer …` to the website's admin endpoints, whose
// `isAdmin(req)` accepts either the admin_session cookie OR that Bearer.
// ADMIN_TOKEN / service-role never touch the browser.
//
// We deliberately reuse the same sessionStorage cache key
// (`cdx_dashboard_admin_token`) as customerRequests.js so the two libs
// share one minted token per tab.

import { supabase } from './supabase'

const BRIDGE_URL =
  import.meta.env?.VITE_DASHBOARD_BRIDGE_URL ||
  'https://uejagupcwevadfhfuadv.supabase.co/functions/v1/dashboard-admin-bridge'

const WEBSITE_BASE =
  import.meta.env?.VITE_CADIEUX_WEBSITE_URL || 'https://www.cadieux.in'

const TOKEN_CACHE_KEY = 'cdx_dashboard_admin_token'
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000

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
    /* ignore */
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
      `Could not reach the admin bridge (${e?.message || 'fetch failed'}).`,
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
// WhatsApp admin API
// ---------------------------------------------------------------------------

export async function listConversations(status = 'all') {
  const data = await callAdmin(
    `/api/admin/whatsapp/conversations?status=${encodeURIComponent(status)}`,
  )
  return Array.isArray(data?.conversations) ? data.conversations : []
}

export async function getConversation(id) {
  const data = await callAdmin(
    `/api/admin/whatsapp/conversations/${encodeURIComponent(id)}`,
  )
  return {
    conversation: data?.conversation ?? null,
    messages: Array.isArray(data?.messages) ? data.messages : [],
  }
}

function patchConversation(id, action) {
  return callAdmin(
    `/api/admin/whatsapp/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { action } },
  )
}

export const resolveConversation = (id) => patchConversation(id, 'resolve')
export const closeConversation = (id) => patchConversation(id, 'close')
export const reopenConversation = (id) => patchConversation(id, 'reopen')

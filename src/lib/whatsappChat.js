// whatsappChat.js — dashboard ↔ cadieux.in website admin API bindings for
// WhatsApp conversations (super-admin Chat page).
//
// The bridge/token/JWT plumbing (and the "Unauthorized" fix) lives in
// ./adminBridge, shared with customerRequests.js so the two libs can't
// drift. This module just exposes the WhatsApp-specific calls.

import { callAdmin } from './adminBridge'

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

// Send a free-form WhatsApp reply from the super-admin dashboard. Goes
// through the website's /send endpoint, which relays to the shared MSG91
// send path the bot already uses — no duplication of send/store/24h-gate
// logic. Returns { ok:true, message } on success. On failure throws an
// Error whose .message is the real MSG91 / server error. Two special
// props on the error are set for the UI:
//   err.windowClosed  → true when Meta's 24h reply window has expired.
//   err.rateLimited   → true when the admin has hit the send rate limit.
export async function sendMessage(id, text) {
  try {
    const data = await callAdmin(
      `/api/admin/whatsapp/conversations/${encodeURIComponent(id)}/send`,
      { method: 'POST', body: { text } },
    )
    return {
      message: data?.message ?? null,
      waMessageId: data?.wa_message_id ?? null,
    }
  } catch (err) {
    // callAdmin surfaces { error, window_closed?, ... } from the JSON body
    // via err.message + err.data (when present). We normalise the two
    // special cases so the UI can render them without string-matching.
    if (err && typeof err === 'object') {
      const data = err.data || {}
      if (data.window_closed === true || err.status === 409) {
        err.windowClosed = true
      }
      if (err.status === 429) {
        err.rateLimited = true
      }
    }
    throw err
  }
}

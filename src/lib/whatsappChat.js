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

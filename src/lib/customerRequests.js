// customerRequests.js — dashboard ↔ cadieux.in website admin API bindings
// for order-change-requests and delivery-requests.
//
// The bridge/token/JWT plumbing (and the "Unauthorized" fix) lives in
// ./adminBridge; this module just exposes the request-specific calls.

import { callAdmin } from './adminBridge'

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

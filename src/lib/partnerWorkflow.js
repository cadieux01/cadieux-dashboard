import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'

// ============================================================================
// PARTNER REQUEST → ACCEPT → ASSIGN → DELIVER WORKFLOW
// ----------------------------------------------------------------------------
// Data-access layer for the partner_requests + partner_assignments tables
// (logistics schema). Every state change is written to logistics.audit_logs.
//
// RLS (enforced server-side, anon client):
//   partner_requests   SELECT: admin/sales OR own; INSERT: own + role=partner;
//                      UPDATE: admin/sales.
//   partner_assignments SELECT: admin/sales OR own; INSERT/UPDATE: admin/sales.
// This module never uses a service-role key — all calls run as the logged-in
// user and are filtered by RLS, so a partner only ever sees their own rows.
// ============================================================================

export const WORKFLOW_VARIANT_OPTIONS = [
  { value: 'multigrain', label: VARIANTS.multigrain.short },
  { value: 'plain', label: VARIANTS.plain.short },
]

export function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

// --- Profile name lookup ----------------------------------------------------
// Fetches { id: { full_name, phone } } for a set of profile ids so we can
// render partner/salesperson names without relying on ambiguous FK embeds
// (profiles is referenced by several columns).
async function fetchProfileMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .in('id', unique)
  if (error) {
    console.warn('Profile lookup failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((p) => [p.id, p]))
}

// Salespeople (+ admins) available for the admin "pick a salesperson" picker.
export async function listSalespeople() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .in('role', ['sales', 'admin'])
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}

// --- Requests ---------------------------------------------------------------

// Partner submits a new request → status 'pending'.
export async function createRequest({ partnerId, variant, units }) {
  const { data, error } = await supabase
    .from('partner_requests')
    .insert({ partner_id: partnerId, variant, units_requested: units, status: 'pending' })
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'partner_request',
    entityId: data.id,
    category: 'partner',
    description: `Partner requested ${units} × ${variantLabel(variant)}`,
    newValues: { variant, units_requested: units, status: 'pending' },
  })
  return data
}

// A partner's own requests, each enriched with the delivery status of any
// assignment created from it (so the partner sees Pending / Accepted / Delivered).
export async function listMyRequests(partnerId) {
  const { data: requests, error } = await supabase
    .from('partner_requests')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const reqIds = (requests || []).map((r) => r.id)
  let assignments = []
  if (reqIds.length > 0) {
    const { data, error: aErr } = await supabase
      .from('partner_assignments')
      .select('*')
      .in('source_request_id', reqIds)
    if (aErr) throw aErr
    assignments = data || []
  }
  const asgByReq = Object.fromEntries(assignments.map((a) => [a.source_request_id, a]))

  return (requests || []).map((r) => {
    const asg = asgByReq[r.id]
    let displayStatus = 'pending'
    if (asg && asg.status === 'confirmed') displayStatus = 'delivered'
    else if (r.status === 'accepted' || asg) displayStatus = 'accepted'
    return { ...r, assignment: asg || null, displayStatus }
  })
}

// All pending requests awaiting acceptance (admin/sales). RLS returns all rows
// to admin/sales. Enriched with partner names.
export async function listPendingRequests() {
  const { data: requests, error } = await supabase
    .from('partner_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error

  const profiles = await fetchProfileMap((requests || []).map((r) => r.partner_id))
  return (requests || []).map((r) => ({
    ...r,
    partner_name: profiles[r.partner_id]?.full_name || 'Partner',
    partner_phone: profiles[r.partner_id]?.phone || '',
  }))
}

// Accept a request → status 'accepted'. accepted_by holds the RESPONSIBLE
// salesperson (sales accepting = themselves; admin accepting = picked one).
export async function acceptRequest({ requestId, salespersonId }) {
  const { data, error } = await supabase
    .from('partner_requests')
    .update({ status: 'accepted', accepted_by: salespersonId, accepted_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'partner_request',
    entityId: data.id,
    category: 'partner',
    description: `Accepted request for ${data.units_requested} × ${variantLabel(data.variant)}`,
    newValues: { status: 'accepted', accepted_by: salespersonId },
  })
  return data
}

// Accepted requests to fulfil (the Supply tab). Each row carries its linked
// assignment (if one exists) so the UI can show an "Assign" action when none
// exists yet, then the delivery status (Pending → Confirmed) afterwards.
// Enriched with partner + responsible-salesperson names.
export async function listSupply() {
  const { data: requests, error } = await supabase
    .from('partner_requests')
    .select('*')
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: true })
  if (error) throw error

  const reqIds = (requests || []).map((r) => r.id)
  let asgByReq = {}
  if (reqIds.length > 0) {
    const { data: asg, error: aErr } = await supabase
      .from('partner_assignments')
      .select('*')
      .in('source_request_id', reqIds)
    if (aErr) throw aErr
    asgByReq = Object.fromEntries((asg || []).map((a) => [a.source_request_id, a]))
  }

  const profiles = await fetchProfileMap(
    (requests || []).flatMap((r) => [r.partner_id, r.accepted_by]),
  )
  return (requests || []).map((r) => ({
    ...r,
    partner_name: profiles[r.partner_id]?.full_name || 'Partner',
    partner_phone: profiles[r.partner_id]?.phone || '',
    salesperson_name: profiles[r.accepted_by]?.full_name || '—',
    assignment: asgByReq[r.id] || null,
  }))
}

// A partner's own assignments (stock delivered to them by an agent/admin).
// RLS scopes the result to partner_id = auth.uid() for a partner. Used by the
// partner Home to compute available stock (delivered − sold).
export async function listMyAssignments(partnerId) {
  const { data, error } = await supabase
    .from('partner_assignments')
    .select('*')
    .eq('partner_id', partnerId)
    .order('assigned_at', { ascending: false })
  if (error) throw error
  return data || []
}

// --- Assignments ------------------------------------------------------------

// Create an assignment (admin/sales). sourceRequestId links it back to the
// originating request (null for a proactive assign from the Partners page).
export async function createAssignment({
  partnerId,
  salespersonId,
  variant,
  units,
  sourceRequestId = null,
  assignedBy,
}) {
  const { data, error } = await supabase
    .from('partner_assignments')
    .insert({
      partner_id: partnerId,
      salesperson_id: salespersonId,
      variant,
      units,
      status: 'pending',
      source_request_id: sourceRequestId,
      assigned_by: assignedBy,
    })
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'partner_assignment',
    entityId: data.id,
    category: 'partner',
    description: `Assigned ${units} × ${variantLabel(variant)} to partner`,
    newValues: { variant, units, status: 'pending', source_request_id: sourceRequestId },
  })
  return data
}

// Confirm delivery of an assignment → status 'confirmed' + confirmed_by/at.
export async function confirmAssignment({ assignmentId, confirmedBy }) {
  const { data, error } = await supabase
    .from('partner_assignments')
    .update({ status: 'confirmed', confirmed_by: confirmedBy, confirmed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'partner_assignment',
    entityId: data.id,
    category: 'partner',
    description: `Confirmed delivery of ${data.units} × ${variantLabel(data.variant)}`,
    newValues: { status: 'confirmed' },
  })
  return data
}

// Assignments owed by a salesperson, enriched with partner names, the full
// lifecycle timestamps (requested, accepted, assigned, delivered) and the
// actors behind each step (for admin tracking/proof). Also returns the total
// units still pending (not yet delivered).
export async function listSalespersonAssignments(salespersonId) {
  const { data: assignments, error } = await supabase
    .from('partner_assignments')
    .select('*')
    .eq('salesperson_id', salespersonId)
    .order('assigned_at', { ascending: false })
  if (error) throw error

  const reqIds = (assignments || []).map((a) => a.source_request_id).filter(Boolean)
  let reqMap = {}
  if (reqIds.length > 0) {
    const { data: reqs, error: rErr } = await supabase
      .from('partner_requests')
      .select('*')
      .in('id', reqIds)
    if (rErr) throw rErr
    reqMap = Object.fromEntries((reqs || []).map((r) => [r.id, r]))
  }

  const profiles = await fetchProfileMap(
    (assignments || []).flatMap((a) => [
      a.partner_id, a.assigned_by, a.confirmed_by,
      a.source_request_id ? reqMap[a.source_request_id]?.accepted_by : null,
    ]),
  )
  const name = (id) => (id ? profiles[id]?.full_name || '—' : '—')

  const rows = (assignments || []).map((a) => {
    const req = a.source_request_id ? reqMap[a.source_request_id] : null
    return {
      ...a,
      partner_name: profiles[a.partner_id]?.full_name || 'Partner',
      source: a.source_request_id ? 'request' : 'proactive',
      requested_at: req?.created_at || null,
      accepted_at: req?.accepted_at || null,
      accepted_by_name: req?.accepted_by ? name(req.accepted_by) : null,
      assigned_by_name: name(a.assigned_by),
      confirmed_by_name: a.confirmed_by ? name(a.confirmed_by) : null,
    }
  })
  const pendingUnits = rows
    .filter((a) => a.status === 'pending')
    .reduce((s, a) => s + (a.units || 0), 0)
  return { assignments: rows, pendingUnits }
}

// All assignments (admin tracking/proof). Each row carries the four lifecycle
// timestamps (requested, accepted, assigned, delivered) and the actors, joined
// from the source request where present.
export async function listAllAssignments() {
  const { data: assignments, error } = await supabase
    .from('partner_assignments')
    .select('*')
    .order('assigned_at', { ascending: false })
  if (error) throw error

  const reqIds = (assignments || []).map((a) => a.source_request_id).filter(Boolean)
  let reqMap = {}
  if (reqIds.length > 0) {
    const { data: reqs, error: rErr } = await supabase
      .from('partner_requests')
      .select('*')
      .in('id', reqIds)
    if (rErr) throw rErr
    reqMap = Object.fromEntries((reqs || []).map((r) => [r.id, r]))
  }

  const profiles = await fetchProfileMap(
    (assignments || []).flatMap((a) => [
      a.partner_id, a.salesperson_id, a.assigned_by, a.confirmed_by,
    ]),
  )
  const name = (id) => profiles[id]?.full_name || '—'

  return (assignments || []).map((a) => {
    const req = a.source_request_id ? reqMap[a.source_request_id] : null
    return {
      ...a,
      partner_name: name(a.partner_id),
      salesperson_name: name(a.salesperson_id),
      assigned_by_name: name(a.assigned_by),
      confirmed_by_name: a.confirmed_by ? name(a.confirmed_by) : null,
      requested_at: req?.created_at || null,
      accepted_at: req?.accepted_at || null,
      accepted_by_name: req?.accepted_by ? name(req.accepted_by) : null,
    }
  })
}

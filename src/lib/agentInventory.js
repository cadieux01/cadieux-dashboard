import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'
import { getBatchFreshnessMap } from './batches'

// ============================================================================
// TWO-TIER INVENTORY: ADMIN → AGENT → PARTNER
// ----------------------------------------------------------------------------
// Append-only ledger (logistics.agent_inventory_ledger) is the single source of
// truth for an agent's (salesperson's) stock balance and history.
//
//   available = SUM(received) − SUM(delivered) + SUM(returned)
//
// Entry types:
//   received  admin → agent       (+)   partner_id null
//   delivered agent → partner     (−)   partner_id set; mirrors a partner_assignment
//   returned  partner → agent     (+)   partner_id set; stock came back, reassignable
//
// RLS (server-side, anon client):
//   SELECT  admin/sales OR agent_id = auth.uid()
//   INSERT  admin (received/corrections); agent records own 'delivered';
//           admin/sales record 'returned'
//   No UPDATE/DELETE — corrections are new entries.
// A BEFORE INSERT trigger rejects any 'delivered' that would drive the balance
// negative, so the gate is enforced in the database, not just the UI.
//
// This ledger NEVER writes to logistics.sales, so it does not inflate the
// Overview "ASSIGNED" KPI (= SUM(sales.units_assigned)).
// ============================================================================

export function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

// Agents are the salespeople (+ admins) who can hold inventory.
export async function listAgents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .in('role', ['sales', 'admin'])
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}

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

// 'expired' is a negative consumer (Stage 5): expired-in-hand units recorded as
// unsold leave the agent's available balance, just like a delivery.
const SIGN = { received: 1, returned: 1, delivered: -1, expired: -1 }

// Roll a list of ledger rows into totals + per-variant balances.
function summarize(rows) {
  const totals = { received: 0, delivered: 0, returned: 0, expired: 0 }
  const byVariant = {
    multigrain: { received: 0, delivered: 0, returned: 0, expired: 0, available: 0 },
    plain: { received: 0, delivered: 0, returned: 0, expired: 0, available: 0 },
  }
  for (const r of rows) {
    const u = r.units || 0
    if (totals[r.entry_type] !== undefined) totals[r.entry_type] += u
    const v = byVariant[r.variant]
    if (v && v[r.entry_type] !== undefined) v[r.entry_type] += u
  }
  for (const key of Object.keys(byVariant)) {
    const v = byVariant[key]
    v.available = v.received - v.delivered + v.returned - v.expired
  }
  const available = totals.received - totals.delivered + totals.returned - totals.expired
  return { totals, byVariant, available }
}

// Raw ledger rows for an agent (RLS already scopes a non-admin to their own).
export async function listAgentLedger(agentId) {
  const { data, error } = await supabase
    .from('agent_inventory_ledger')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Full ledger view for the Units page: summary + enriched, sorted history.
export async function getAgentInventory(agentId) {
  const rows = await listAgentLedger(agentId)
  const profiles = await fetchProfileMap(
    rows.flatMap((r) => [r.partner_id, r.created_by]),
  )
  const history = rows.map((r) => ({
    ...r,
    sign: SIGN[r.entry_type] || 0,
    variant_label: variantLabel(r.variant),
    partner_name: r.partner_id ? profiles[r.partner_id]?.full_name || 'Partner' : null,
    actor_name: r.created_by ? profiles[r.created_by]?.full_name || '—' : '—',
  }))
  return { ...summarize(rows), history }
}

// Lightweight available-balance lookup for gating the agent's Assign action.
// Returns { available, byVariant } for the agent.
export async function getAgentBalance(agentId) {
  const rows = await listAgentLedger(agentId)
  const { available, byVariant } = summarize(rows)
  return { available, byVariant }
}

// Agent's in-hand stock broken down BY BATCH (FIFO, oldest first), each lot
// carrying the originating batch so the UI can show its live expiry countdown.
//
// 'received' rows carry batch_id (Stage 3 accept). Consumption ('delivered'
// net of 'returned') is not yet batch-tagged, so we deplete it FIFO against the
// oldest received lots — the standard first-in-first-out reading. Pre-batch
// 'received' rows (NULL batch_id) show as a "no batch / no expiry" lot.
// Returns an array of { variant, variant_label, units, batch|null } with
// units > 0, ordered oldest-first within each variant.
export async function getAgentHoldingsByBatch(agentId) {
  const rows = await listAgentLedger(agentId)

  const received = rows.filter((r) => r.entry_type === 'received')
  const consumed = { multigrain: 0, plain: 0 } // net delivered − returned
  // 'expired' is batch-tagged (Stage 5), so deplete it from its OWN batch lot
  // exactly rather than FIFO — keeps multi-batch expiry attribution correct.
  const expiredByBatch = {}
  for (const r of rows) {
    if (r.entry_type === 'delivered') consumed[r.variant] = (consumed[r.variant] || 0) + (r.units || 0)
    else if (r.entry_type === 'returned') consumed[r.variant] = (consumed[r.variant] || 0) - (r.units || 0)
    else if (r.entry_type === 'expired' && r.batch_id) expiredByBatch[r.batch_id] = (expiredByBatch[r.batch_id] || 0) + (r.units || 0)
  }

  const batchMap = await getBatchFreshnessMap(received.map((r) => r.batch_id))

  const holdings = []
  for (const variant of ['multigrain', 'plain']) {
    let toConsume = Math.max(0, consumed[variant] || 0)
    const lots = received
      .filter((r) => r.variant === variant)
      .map((r) => {
        const batch = r.batch_id ? batchMap[r.batch_id] || null : null
        // FIFO key: the batch's own clock-start when known, else the ledger row.
        const sortKey = batch?.created_at || r.created_at
        return { units: r.units || 0, batch, batchId: r.batch_id || null, sortKey }
      })
      .sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey))

    for (const lot of lots) {
      let remaining = lot.units
      // 1) Exact: remove units of THIS batch already recorded as expired/unsold.
      if (lot.batchId && (expiredByBatch[lot.batchId] || 0) > 0) {
        const take = Math.min(remaining, expiredByBatch[lot.batchId])
        remaining -= take
        expiredByBatch[lot.batchId] -= take
      }
      // 2) FIFO: deplete net delivered (delivered − returned) oldest-first.
      if (toConsume > 0 && remaining > 0) {
        const take = Math.min(remaining, toConsume)
        remaining -= take
        toConsume -= take
      }
      if (remaining > 0) {
        holdings.push({
          variant,
          variant_label: variantLabel(variant),
          units: remaining,
          batch: lot.batch,
        })
      }
    }
  }
  return holdings
}

// --- Writes ----------------------------------------------------------------

// Admin grants stock to an agent → 'received' (+). Does NOT touch sales.
export async function recordReceived({ agentId, variant, units, note = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('agent_inventory_ledger')
    .insert({
      agent_id: agentId,
      variant,
      entry_type: 'received',
      units,
      created_by: user?.id || null,
      note,
    })
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'agent_inventory',
    entityId: data.id,
    category: 'partner',
    description: `Assigned ${units} × ${variantLabel(variant)} to agent (received)`,
    newValues: { agent_id: agentId, variant, units, entry_type: 'received' },
  })
  return data
}

// Agent delivers their own stock to a partner. Reuses the partner_assignments
// workflow (createAssignment) for the partner-facing record, then writes the
// matching 'delivered' (−) ledger entry linked by assignment_id. The DB trigger
// blocks this if the agent's available balance is too low.
export async function deliverToPartner({
  agentId,
  partnerId,
  variant,
  units,
  sourceRequestId = null,
  note = null,
}) {
  const { data: { user } } = await supabase.auth.getUser()

  // 1) Operational delivery record (reused drafted workflow).
  const { data: assignment, error: aErr } = await supabase
    .from('partner_assignments')
    .insert({
      partner_id: partnerId,
      salesperson_id: agentId,
      variant,
      units,
      status: 'pending',
      source_request_id: sourceRequestId,
      assigned_by: user?.id || null,
    })
    .select()
    .single()
  if (aErr) throw aErr

  // 2) Inventory accounting entry (single source of truth for balance).
  const { data: ledger, error: lErr } = await supabase
    .from('agent_inventory_ledger')
    .insert({
      agent_id: agentId,
      variant,
      entry_type: 'delivered',
      units,
      partner_id: partnerId,
      assignment_id: assignment.id,
      created_by: user?.id || null,
      note,
    })
    .select()
    .single()
  if (lErr) {
    // Roll back the orphan assignment so the two stay consistent.
    await supabase.from('partner_assignments').delete().eq('id', assignment.id)
    throw lErr
  }

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'agent_inventory',
    entityId: ledger.id,
    category: 'partner',
    description: `Delivered ${units} × ${variantLabel(variant)} to partner`,
    newValues: { agent_id: agentId, partner_id: partnerId, variant, units, entry_type: 'delivered', assignment_id: assignment.id },
  })
  return { assignment, ledger }
}

// Partner returns/retracts stock back to the agent → 'returned' (+). The agent
// must reassign these. Optionally linked to the originating assignment.
export async function recordReturn({
  agentId,
  partnerId,
  variant,
  units,
  assignmentId = null,
  batchId = null,
  note = null,
}) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('agent_inventory_ledger')
    .insert({
      agent_id: agentId,
      variant,
      entry_type: 'returned',
      units,
      partner_id: partnerId,
      assignment_id: assignmentId,
      // Preserve the originating batch so the returned lot keeps its expiry
      // clock (an expired return still reads as expired — clock not reset).
      batch_id: batchId,
      created_by: user?.id || null,
      note,
    })
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'agent_inventory',
    entityId: data.id,
    category: 'partner',
    description: `Partner returned ${units} × ${variantLabel(variant)} to agent`,
    newValues: { agent_id: agentId, partner_id: partnerId, variant, units, entry_type: 'returned' },
  })
  return data
}

// --- Unsold / expired lifecycle (Stage 5, agent side) ----------------------

// The agent's recorded unsold units (their wasted-stock responsibility list).
// Enriched with the originating batch's number + expiry so the UI can mark it
// EXPIRED — the clock is NOT reset (the row keeps its original batch timeline).
export async function getAgentUnsold(agentId) {
  const { data, error } = await supabase
    .from('unsold_units')
    .select('*')
    .eq('holder_type', 'agent')
    .eq('holder_id', agentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = data || []
  const batchMap = await getBatchFreshnessMap(rows.map((r) => r.batch_id))
  return rows.map((r) => ({
    ...r,
    variant_label: variantLabel(r.variant),
    batch: r.batch_id ? batchMap[r.batch_id] || null : null,
  }))
}

// Move expired in-hand units of one batch into the agent's unsold list. The RPC
// (admin/sales gated, SECURITY DEFINER) validates the batch is expired, caps the
// count to what the agent still holds from it, consumes them from the ledger
// ('expired' −), and records the unsold row. No monetary charge.
export async function recordAgentUnsoldExpired({ agentId, batchId, units, variant }) {
  const { data, error } = await supabase.rpc('record_agent_unsold_expired', {
    p_agent: agentId,
    p_batch_id: batchId,
    p_units: units,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'agent_inventory',
    entityId: data?.id || batchId,
    category: 'partner',
    description: `Recorded ${units} × ${variantLabel(variant)} expired in hand as unsold`,
    newValues: { agent_id: agentId, batch_id: batchId, units, reason: 'expired' },
  })
  return data
}

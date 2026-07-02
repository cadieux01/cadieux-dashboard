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

// 'expired' and 'withdrawn' are negative consumers: 'expired' (Stage 5) is
// expired-in-hand units recorded as unsold; 'withdrawn' is units an admin pulled
// back from the exec when withdrawing an allotment. Both leave the agent's
// available balance, just like a delivery.
const SIGN = { received: 1, returned: 1, delivered: -1, expired: -1, withdrawn: -1 }

// Roll a list of ledger rows into totals + per-variant balances.
function summarize(rows) {
  const totals = { received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0 }
  const byVariant = {
    multigrain: { received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0, available: 0 },
    plain: { received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0, available: 0 },
  }
  for (const r of rows) {
    const u = r.units || 0
    if (totals[r.entry_type] !== undefined) totals[r.entry_type] += u
    const v = byVariant[r.variant]
    if (v && v[r.entry_type] !== undefined) v[r.entry_type] += u
  }
  for (const key of Object.keys(byVariant)) {
    const v = byVariant[key]
    v.available = v.received - v.delivered + v.returned - v.expired - v.withdrawn
  }
  const available = totals.received - totals.delivered + totals.returned - totals.expired - totals.withdrawn
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
  // 'expired' (Stage 5) and 'withdrawn' (allotment withdraw) are batch-tagged,
  // so deplete them from their OWN batch lot exactly rather than FIFO — keeps
  // multi-batch attribution correct.
  const exactByBatch = {}
  for (const r of rows) {
    if (r.entry_type === 'delivered') consumed[r.variant] = (consumed[r.variant] || 0) + (r.units || 0)
    else if (r.entry_type === 'returned') consumed[r.variant] = (consumed[r.variant] || 0) - (r.units || 0)
    else if ((r.entry_type === 'expired' || r.entry_type === 'withdrawn') && r.batch_id) exactByBatch[r.batch_id] = (exactByBatch[r.batch_id] || 0) + (r.units || 0)
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
      // 1) Exact: remove units of THIS batch already recorded as expired/unsold
      //    or withdrawn back to central.
      if (lot.batchId && (exactByBatch[lot.batchId] || 0) > 0) {
        const take = Math.min(remaining, exactByBatch[lot.batchId])
        remaining -= take
        exactByBatch[lot.batchId] -= take
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

// Agent delivers their own stock to a partner. Routed through the bounded
// SECURITY DEFINER RPC (create_partner_assignment_from_agent) which:
//   * verifies agent has enough non-expired in-hand units (raises
//     'agent_insufficient_stock' otherwise — the DB gate, not just the trigger)
//   * FIFO-picks a non-expired batch to stamp on the assignment
//   * atomically writes both the partner_assignments row AND the matching
//     agent_inventory_ledger 'delivered' (−) row
// Direct client INSERTs into partner_assignments are blocked by RLS.
export async function deliverToPartner({
  agentId,
  partnerId,
  variant,
  units,
  sourceRequestId = null,
  // note is retained in the signature for API compatibility, but the RPC
  // writes a standard note on the ledger row itself.
  // eslint-disable-next-line no-unused-vars
  note = null,
}) {
  const { data: assignment, error } = await supabase.rpc(
    'create_partner_assignment_from_agent',
    {
      p_partner: partnerId,
      p_agent: agentId,
      p_variant: variant,
      p_units: units,
      p_source_request_id: sourceRequestId,
      p_batch_id: null,
    },
  )
  if (error) {
    const msg = error.message || ''
    if (msg.startsWith('agent_insufficient_stock')) {
      const err = new Error(msg)
      err.code = 'agent_insufficient_stock'
      throw err
    }
    throw error
  }

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'agent_inventory',
    entityId: assignment.id,
    category: 'partner',
    description: `Delivered ${units} × ${variantLabel(variant)} to partner`,
    newValues: {
      agent_id: agentId, partner_id: partnerId, variant, units,
      entry_type: 'delivered', assignment_id: assignment.id, batch_id: assignment.batch_id,
    },
  })
  return { assignment, ledger: null }
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

// Admin retract → CENTRAL. The two SECURITY DEFINER RPCs below restore the
// units to the originating batch (keeping FIFO + expiry clock; stock_pool
// re-syncs via its trigger) and are admin-gated server-side. Only unsold units
// are moved; sold/delivered units are never clawed back.

// Rule 3b: admin pulls a PARTNER's unsold units (one sales row) back to central
// stock. Atomically bumps the sales row's retracted counters AND restores the
// batch — no agent ledger write (units leave the chain → agent total drops).
export async function retractSaleToCentral({ saleId, variant, units, reason = null, notes = null }) {
  const { data, error } = await supabase.rpc('retract_sale_to_central', {
    p_sale_id: saleId,
    p_variant: variant,
    p_units: units,
    p_reason: reason,
    p_notes: notes,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'sale',
    entityId: saleId,
    category: 'partner',
    description: `Admin retracted ${units} × ${variantLabel(variant)} from partner to central stock (${reason || 'unsold'})`,
    newValues: { sale_id: saleId, variant, units, destination: 'central', reason },
  })
  return data
}

// Rule 2: admin pulls an AGENT's in-hand units (one batch lot) back to central
// stock. Restores the batch + writes a 'withdrawn' (−) agent ledger row.
export async function retractAgentToCentral({ agentId, batchId, variant, units, reason = null, notes = null }) {
  const { data, error } = await supabase.rpc('retract_agent_to_central', {
    p_agent: agentId,
    p_batch_id: batchId,
    p_variant: variant,
    p_units: units,
    p_reason: reason,
    p_notes: notes,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'agent_inventory',
    entityId: data?.id || agentId,
    category: 'partner',
    description: `Admin retracted ${units} × ${variantLabel(variant)} from agent to central stock (${reason || 'unsold'})`,
    newValues: { agent_id: agentId, batch_id: batchId, variant, units, destination: 'central', reason },
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

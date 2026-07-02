import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'

// ============================================================================
// PARTNER-SIDE EXPIRY → UNSOLD (Stage 7, final). Mirror of agentInventory's
// unsold lifecycle, but for partners.
//
// A partner receives batch-stamped units two ways:
//   • sales rows (trainer_id = partner, multigrain/plain_assigned > 0,
//     batch_id from the assign_sale_fifo handoff)
//   • partner_assignments (partner_id = partner, batch_id from the agent
//     deliver / accepted-request path)
// The carried batch clock NEVER resets, so the partner sees a live countdown
// and, once expired, admin/sales record the leftover into unsold_units
// (holder_type = 'partner'). Tracking only — no monetary charge.
//
// Partners CANNOT read logistics.central_stock_batches directly (admin/sales
// only), so all three reads/writes go through SECURITY DEFINER RPCs. Partners
// have no inventory ledger, so recording does NOT write a ledger row — the
// holdings RPC subtracts already-recorded unsold per batch instead.
// ============================================================================

export function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

// Shape a flat RPC batch row into the { batch } nested form the UI expects.
function toBatch(r) {
  return r.batch_id
    ? { id: r.batch_id, batch_number: r.batch_number, expiry_at: r.expiry_at, created_at: r.batch_created_at }
    : null
}

// Partner's in-hand stock broken down BY BATCH (FIFO oldest-first), each lot
// carrying the originating batch so the UI can show its live expiry countdown.
// Returns [{ variant, variant_label, units, batch|null, received_at }].
export async function getPartnerHoldingsByBatch(partnerId) {
  const { data, error } = await supabase.rpc('get_partner_holdings_by_batch', {
    p_partner: partnerId,
  })
  if (error) throw error
  return (data || []).map((r) => ({
    variant: r.variant,
    variant_label: variantLabel(r.variant),
    units: r.units || 0,
    received_at: r.received_at,
    batch: toBatch(r),
  }))
}

// The partner's recorded unsold units (their wasted-stock responsibility list).
// Enriched with the originating batch so the UI can mark it EXPIRED — the clock
// is NOT reset (the row keeps its original batch timeline).
export async function getPartnerUnsold(partnerId) {
  const { data, error } = await supabase.rpc('get_partner_unsold', {
    p_partner: partnerId,
  })
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    variant: r.variant,
    variant_label: variantLabel(r.variant),
    units: r.units || 0,
    reason: r.reason,
    note: r.note,
    created_at: r.created_at,
    batch: r.batch_id
      ? { id: r.batch_id, batch_number: r.batch_number, expiry_at: r.expiry_at }
      : null,
  }))
}

// Move expired in-hand units of one batch into the partner's unsold list. The
// RPC (admin/sales gated, SECURITY DEFINER) validates the batch is expired,
// caps the count to what the partner still holds from it, and records the
// unsold row (holder_type = 'partner'). No ledger row, no monetary charge.
export async function recordPartnerUnsoldExpired({ partnerId, batchId, units, variant }) {
  const { data, error } = await supabase.rpc('record_partner_unsold_expired', {
    p_partner: partnerId,
    p_batch_id: batchId,
    p_units: units,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'partner_inventory',
    entityId: data?.id || batchId,
    category: 'partner',
    description: `Recorded ${units} × ${variantLabel(variant)} expired in partner hand as unsold`,
    newValues: { partner_id: partnerId, batch_id: batchId, units, reason: 'expired' },
  })
  return data
}

// Partner unsold totals per variant — lets the partner dashboard discount its
// available balance by formally-recorded wasted stock. Additive: 0 today.
export async function getPartnerUnsoldByVariant(partnerId) {
  const rows = await getPartnerUnsold(partnerId)
  const byVariant = { multigrain: 0, plain: 0 }
  for (const r of rows) {
    if (byVariant[r.variant] !== undefined) byVariant[r.variant] += r.units || 0
  }
  return byVariant
}

// Phase 3 (SEAL LEAK #1 companion): partner's variant-scoped in-hand aggregate
// across sales rows + partner_assignments. Same formula the atomic retract RPC
// uses to enforce the cap, so UI display and server enforcement agree.
export async function getPartnerVariantAvailable(partnerId, variant) {
  const { data, error } = await supabase.rpc('partner_variant_available', {
    p_partner: partnerId,
    p_variant: variant,
  })
  if (error) throw error
  return Number(data) || 0
}

// Phase 3 (SEAL LEAK #1): atomic partner-side retract. FIFO walks sources
// (sales + partner_assignments) oldest-first, decrements each, and credits the
// originating agent's ledger as 'returned' with the source batch_id preserved.
// Refuses if p_units exceeds the partner's current variant-scoped holding
// (partner_insufficient_stock).
export async function retractFromPartner({ partnerId, variant, units, reason = null, notes = null }) {
  const { data, error } = await supabase.rpc('retract_from_partner', {
    p_partner: partnerId,
    p_variant: variant,
    p_units: units,
    p_reason: reason,
    p_notes: notes,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'partner_inventory',
    entityId: partnerId,
    category: 'partner',
    description: `Retracted ${units} × ${variantLabel(variant)} from partner (return to agent)`,
    newValues: { partner_id: partnerId, variant, units, reason, notes, destination: 'agent' },
  })
  return Number(data) || units
}

// Phase 4 (SEAL LEAK #3): atomic bounded partner sale recording. FIFO walks
// the partner's own sources (sales + partner_assignments) oldest-first and
// either bumps units_sold on an existing sales row or converts a
// partner_assignment into a real sales row (PA drained by v_take + new sales
// row with u_a=u_s=v_take). Refuses if requested units exceed the partner's
// in-hand aggregate (partner_insufficient_stock).
//
// Callable by the partner themselves OR admin/sales. No more direct INSERTs
// into logistics.sales from the client — the partner INSERT RLS policy was
// dropped in this phase.
export async function recordPartnerSale({
  partnerId,
  variant,
  units,
  unitPrice = null,
  buyerName = null,
  buyerContact = null,
  pictureUrl = null,
  qrCodeUrl = null,
  customerNotes = null,
}) {
  const { data, error } = await supabase.rpc('record_partner_sale', {
    p_partner: partnerId,
    p_variant: variant,
    p_units: units,
    p_unit_price: unitPrice,
    p_buyer_name: buyerName,
    p_buyer_contact: buyerContact,
    p_picture_url: pictureUrl,
    p_qr_code_url: qrCodeUrl,
    p_customer_notes: customerNotes,
    p_agent_override: null,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'sale',
    entityId: data?.last_sale_id || partnerId,
    category: 'partner',
    description: `Recorded ${units} × ${variantLabel(variant)} sale for partner${buyerName ? ` (buyer: ${buyerName})` : ''}`,
    newValues: {
      partner_id: partnerId,
      variant,
      units,
      unit_price: unitPrice,
      buyer_name: buyerName,
      buyer_contact: buyerContact,
      customer_notes: customerNotes,
    },
  })
  return data
}

// Phase 4 (Change 4): admin/sales records a sale on behalf of a partner. Thin
// wrapper over recordPartnerSale that stamps the operating agent as attribution
// on any PA→sale conversion rows. Same partner-in-hand cap.
export async function recordAgentSaleForPartner({
  agentId,
  partnerId,
  variant,
  units,
  unitPrice = null,
  buyerName = null,
  buyerContact = null,
  pictureUrl = null,
  qrCodeUrl = null,
  customerNotes = null,
}) {
  const { data, error } = await supabase.rpc('record_agent_sale_for_partner', {
    p_agent: agentId,
    p_partner: partnerId,
    p_variant: variant,
    p_units: units,
    p_unit_price: unitPrice,
    p_buyer_name: buyerName,
    p_buyer_contact: buyerContact,
    p_picture_url: pictureUrl,
    p_qr_code_url: qrCodeUrl,
    p_customer_notes: customerNotes,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'sale',
    entityId: data?.last_sale_id || partnerId,
    category: 'partner',
    description: `Agent-recorded sale for partner: ${units} × ${variantLabel(variant)}${buyerName ? ` (buyer: ${buyerName})` : ''}`,
    newValues: {
      agent_id: agentId,
      partner_id: partnerId,
      variant,
      units,
      unit_price: unitPrice,
      buyer_name: buyerName,
      buyer_contact: buyerContact,
      customer_notes: customerNotes,
    },
  })
  return data
}

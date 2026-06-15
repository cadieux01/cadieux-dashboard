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

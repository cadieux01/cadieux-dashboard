import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'

// ============================================================================
// CENTRAL STOCK BATCHES (Stage 2) — admin data layer
// ----------------------------------------------------------------------------
// shelf_life_settings   admin-editable shelf life (days) per variant.
// central_stock_batches central production batches. created_at = clock start;
//                       expiry_at = created_at + shelf life (DB trigger).
// central_stock_batches_v  the same rows + live derived status / is_expired /
//                       seconds_left, FIFO-ordered (oldest first).
//
// All mutations go through SECURITY DEFINER admin-only RPCs:
//   create_central_batch(variant, quantity, created_at?)
//   edit_central_batch(batch_id, quantity?, created_at?)
//   update_shelf_life(variant, days)
//
// This stage does NOT touch stock_pool / allotments — the two systems coexist
// until Stage 3 reconciles them.
// ============================================================================

const VARIANT_KEYS = ['multigrain', 'plain']

function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

// --- Shelf life ------------------------------------------------------------

// Returns { multigrain: days, plain: days } (defaults if a row is missing).
export async function getShelfLife() {
  const { data, error } = await supabase
    .from('shelf_life_settings')
    .select('variant, shelf_life_days')
  if (error) throw error
  const out = { multigrain: 3, plain: 6 }
  for (const row of data || []) {
    if (out[row.variant] !== undefined) out[row.variant] = row.shelf_life_days
  }
  return out
}

export async function updateShelfLife({ variant, days }) {
  const { data, error } = await supabase.rpc('update_shelf_life', {
    p_variant: variant,
    p_days: days,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'shelf_life',
    entityId: null,
    category: 'partner',
    description: `Set ${variantLabel(variant)} shelf life to ${days} day(s)`,
    newValues: { variant, shelf_life_days: days },
  })
  return data
}

// --- Batches ---------------------------------------------------------------

// All batches via the live view (FIFO: oldest first), enriched with a display
// label. Each row carries expiry_at + seconds_left + status + is_expired.
export async function listBatches() {
  const { data, error } = await supabase
    .from('central_stock_batches_v')
    .select('*')
  if (error) throw error
  return (data || []).map((b) => ({ ...b, variant_label: variantLabel(b.variant) }))
}

export async function createBatch({ variant, quantity, createdAt = null }) {
  const { data, error } = await supabase.rpc('create_central_batch', {
    p_variant: variant,
    p_quantity: quantity,
    p_created_at: createdAt,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'stock_batch',
    entityId: data?.id || null,
    category: 'partner',
    description: `Created batch of ${quantity} × ${variantLabel(variant)}`,
    newValues: { variant, quantity, created_at: data?.created_at },
  })
  return data
}

// quantity / createdAt may each be null to leave that field unchanged.
export async function editBatch({ batchId, quantity = null, createdAt = null }) {
  const { data, error } = await supabase.rpc('edit_central_batch', {
    p_batch_id: batchId,
    p_quantity: quantity,
    p_created_at: createdAt,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'stock_batch',
    entityId: batchId,
    category: 'partner',
    description: `Edited batch #${data?.batch_number ?? ''}`,
    newValues: { quantity: data?.quantity, created_at: data?.created_at },
  })
  return data
}

export { VARIANT_KEYS }

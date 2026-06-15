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

// --- Batch freshness helpers (shared by the agent Units / Allotment tabs) ---

// Look up a few freshness fields for a set of batch ids straight from the base
// table (sales can read it via RLS). We compute the countdown client-side from
// expiry_at + a ticking `now`, so this is fetched rarely, not per-second.
// Returns { [batchId]: { id, batch_number, variant, created_at, expiry_at } }.
export async function getBatchFreshnessMap(batchIds) {
  const unique = [...new Set((batchIds || []).filter(Boolean))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase
    .from('central_stock_batches')
    .select('id, batch_number, variant, created_at, expiry_at')
    .in('id', unique)
  if (error) {
    console.warn('Batch freshness lookup failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((b) => [b.id, b]))
}

// Milliseconds left until a batch expires, given a ticking `nowMs`. null when
// the batch has no expiry (e.g. pre-batch / NULL batch_id).
export function batchMsLeft(expiryAt, nowMs) {
  if (!expiryAt) return null
  return new Date(expiryAt).getTime() - nowMs
}

// Live countdown to expiry, ticking down to the SECOND:
//   "2d 3h 14m 22s" / "3h 14m 22s" / "14m 22s" / "22s" / "Expired".
// null when there is no expiry (NULL batch_id). Consumers tick a `now` state
// every 1s so the seconds visibly decrement.
export function fmtBatchLeft(ms) {
  if (ms == null) return null
  if (ms <= 0) return 'Expired'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m ${sec}s`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export { VARIANT_KEYS }

import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'

// ============================================================================
// ALLOT: CENTRAL STOCK POOL → EXEC (sales agent)
// ----------------------------------------------------------------------------
// stock_pool  one row per variant; total_stock is the authoritative central
//             quantity an admin holds before any allotment.
// allotments  admin allots units from the pool to an exec. Status:
//               pending   awaiting the exec's response (still reserved)
//               accepted  exec took delivery → a 'received' row is written to
//                         agent_inventory_ledger, crediting their balance
//               rejected  returned to the pool (no ledger write)
//
//   central_available(variant) = total_stock − SUM(units WHERE status IN
//                                 ('pending','accepted'))
//
// An allot_guard() BEFORE INSERT trigger rejects an allotment that would drive
// central_available negative, so over-allotment is blocked in the database.
//
// accept_allotment / reject_allotment are SECURITY DEFINER RPCs: the exec owns
// the response (exec_id = auth.uid()) and accepting atomically writes the
// 'received' ledger entry, which the per-statement ledger RLS (admin-only
// 'received') would otherwise forbid.
//
// This flow NEVER writes to logistics.sales, so it does not inflate the
// Overview "ASSIGNED" KPI (= SUM(sales.units_assigned)).
// ============================================================================

function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

const VARIANT_KEYS = ['multigrain', 'plain']

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

// --- Central pool ----------------------------------------------------------

// Per-variant stock breakdown (DISPLAY-ONLY; nothing here changes what
// central_available or allot_guard enforce). Returns:
//   {
//     multigrain|plain: {
//       total,      // Σ quantity_remaining across ALL batches, incl. expired
//       active,     // Σ quantity_remaining of NON-EXPIRED batches (= stock_pool.total_stock,
//                   //   kept in sync by the sync_stock_pool_after_batch_change trigger)
//       expired,    // total − active (units in expired batches; still counted in `total`)
//       pending,    // Σ units of allotments with status='pending' (reserved from active)
//       available,  // logistics.central_available(v) → max(0, active − pending)
//     }
//   }
// `total` used to mean "active" (from stock_pool.total_stock); it now includes
// expired stock so the admin can see the full picture. The only field the Allot
// page reads is `available`, so no existing behaviour changes.
export async function getStockPool() {
  // Active per variant (kept in sync by the batch-change trigger).
  const { data: pool, error: pErr } = await supabase
    .from('stock_pool')
    .select('variant, total_stock')
  if (pErr) throw pErr

  // Total (incl. expired): sum quantity_remaining across ALL batches — expired
  // batches remain counted here. Nothing is cleaned up or hidden.
  const { data: allBatches, error: bErr } = await supabase
    .from('central_stock_batches')
    .select('variant, quantity_remaining')
  if (bErr) throw bErr

  // Pending allotments reserving units from active (used to explain why
  // Available < Active). Accepted/rejected/withdrawn are not counted here —
  // central_available itself only subtracts 'pending'.
  const { data: pendingRows, error: alErr } = await supabase
    .from('allotments')
    .select('variant, units')
    .eq('status', 'pending')
  if (alErr) throw alErr

  const active = Object.fromEntries(VARIANT_KEYS.map((v) => [v, 0]))
  for (const row of pool || []) {
    if (active[row.variant] !== undefined) active[row.variant] = row.total_stock || 0
  }

  const total = Object.fromEntries(VARIANT_KEYS.map((v) => [v, 0]))
  for (const row of allBatches || []) {
    if (total[row.variant] !== undefined) total[row.variant] += row.quantity_remaining || 0
  }

  const pending = Object.fromEntries(VARIANT_KEYS.map((v) => [v, 0]))
  for (const row of pendingRows || []) {
    if (pending[row.variant] !== undefined) pending[row.variant] += row.units || 0
  }

  const out = {}
  for (const v of VARIANT_KEYS) {
    const { data: avail, error: aErr } = await supabase.rpc('central_available', { p_variant: v })
    if (aErr) throw aErr
    out[v] = {
      total: total[v],
      active: active[v],
      expired: Math.max(0, total[v] - active[v]),
      pending: pending[v],
      available: avail ?? 0,
    }
  }
  return out
}

// --- Allotments ------------------------------------------------------------

// FIFO batch pick for an allotment: the OLDEST non-expired batch of this variant
// whose UNRESERVED remaining covers the units. Unreserved = quantity_remaining −
// Σ(pending allotments already stamped on that batch), because a pending
// allotment carries a batch_id but only draws the batch down on accept. Returns
// a batch id, or null when no batch qualifies (allot still proceeds, carrying no
// clock — backward compatible).
async function pickFifoBatchId(variant, units) {
  const { data: batches, error: bErr } = await supabase
    .from('central_stock_batches')
    .select('id, quantity_remaining, expiry_at, created_at, batch_number')
    .eq('variant', variant)
    .order('created_at', { ascending: true })
    .order('batch_number', { ascending: true })
  if (bErr || !batches?.length) return null

  const { data: pend, error: pErr } = await supabase
    .from('allotments')
    .select('batch_id, units')
    .eq('variant', variant)
    .eq('status', 'pending')
    .not('batch_id', 'is', null)
  const reserved = {}
  if (!pErr) {
    for (const r of pend || []) reserved[r.batch_id] = (reserved[r.batch_id] || 0) + (r.units || 0)
  }

  const nowMs = Date.now()
  for (const b of batches) {
    if (b.expiry_at && new Date(b.expiry_at).getTime() <= nowMs) continue // skip expired
    const unreserved = (b.quantity_remaining || 0) - (reserved[b.id] || 0)
    if (unreserved >= units) return b.id
  }
  return null
}

// Admin allots units from the pool to an exec. The DB guard blocks over-allot.
// We FIFO-stamp the oldest non-expired batch so the clock carries on accept.
export async function allot({ execId, variant, units, note = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  const batchId = await pickFifoBatchId(variant, units)
  const { data, error } = await supabase
    .from('allotments')
    .insert({
      exec_id: execId,
      variant,
      units,
      status: 'pending',
      allotted_by: user?.id || null,
      batch_id: batchId,
      note,
    })
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'CREATE',
    entityType: 'allotment',
    entityId: data.id,
    category: 'partner',
    description: `Allotted ${units} × ${variantLabel(variant)} to exec`,
    newValues: { exec_id: execId, variant, units, status: 'pending' },
  })
  return data
}

function enrich(rows, profiles) {
  return (rows || []).map((r) => ({
    ...r,
    variant_label: variantLabel(r.variant),
    exec_name: r.exec_id ? profiles[r.exec_id]?.full_name || 'Exec' : '—',
    allotted_by_name: r.allotted_by ? profiles[r.allotted_by]?.full_name || '—' : '—',
  }))
}

// Admin view: every allotment, newest first (RLS lets admin read all).
export async function listAllAllotments() {
  const { data, error } = await supabase
    .from('allotments')
    .select('*')
    .order('allotted_at', { ascending: false })
  if (error) throw error
  const profiles = await fetchProfileMap(
    (data || []).flatMap((r) => [r.exec_id, r.allotted_by]),
  )
  return enrich(data, profiles)
}

// Exec view: their own allotments, newest first (RLS scopes to exec_id).
export async function listExecAllotments(execId) {
  const { data, error } = await supabase
    .from('allotments')
    .select('*')
    .eq('exec_id', execId)
    .order('allotted_at', { ascending: false })
  if (error) throw error
  const profiles = await fetchProfileMap(
    (data || []).flatMap((r) => [r.exec_id, r.allotted_by]),
  )
  return enrich(data, profiles)
}

// Exec accepts a pending allotment → credits their ledger ('received').
export async function acceptAllotment(allotmentId) {
  const { error } = await supabase.rpc('accept_allotment', { p_allotment_id: allotmentId })
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'allotment',
    entityId: allotmentId,
    category: 'partner',
    description: 'Accepted allotment (credited to inventory)',
    newValues: { status: 'accepted' },
  })
}

// Exec rejects a pending allotment → units return to the central pool.
export async function rejectAllotment(allotmentId) {
  const { error } = await supabase.rpc('reject_allotment', { p_allotment_id: allotmentId })
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'allotment',
    entityId: allotmentId,
    category: 'partner',
    description: 'Rejected allotment (returned to central pool)',
    newValues: { status: 'rejected' },
  })
}

// Admin withdraws an allotment. Pending → voided (units free back to central).
// Accepted → the exec's REMAINING UNSOLD units from this batch are pulled back
// to the same batch (FIFO, never clawing back sold/delivered units); a negative
// 'withdrawn' ledger row drops the exec's balance. All atomic in the RPC.
export async function withdrawAllotment(allotmentId) {
  const { error } = await supabase.rpc('withdraw_allotment', { p_allotment_id: allotmentId })
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'allotment',
    entityId: allotmentId,
    category: 'partner',
    description: 'Withdrew allotment (unsold units returned to central)',
    newValues: { status: 'withdrawn' },
  })
}

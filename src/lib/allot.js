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

// Pool totals + currently-available (total − reserved by pending/accepted).
// Returns { multigrain: { total, available }, plain: { total, available } }.
export async function getStockPool() {
  const { data: pool, error: pErr } = await supabase
    .from('stock_pool')
    .select('variant, total_stock')
  if (pErr) throw pErr

  const totals = Object.fromEntries(VARIANT_KEYS.map((v) => [v, 0]))
  for (const row of pool || []) {
    if (totals[row.variant] !== undefined) totals[row.variant] = row.total_stock || 0
  }

  const out = {}
  for (const v of VARIANT_KEYS) {
    const { data: avail, error: aErr } = await supabase.rpc('central_available', { p_variant: v })
    if (aErr) throw aErr
    out[v] = { total: totals[v], available: avail ?? 0 }
  }
  return out
}

// Admin sets the authoritative central total for a variant (absolute value).
export async function setStockTotal({ variant, total }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('stock_pool')
    .upsert(
      { variant, total_stock: total, updated_at: new Date().toISOString(), updated_by: user?.id || null },
      { onConflict: 'variant' },
    )
    .select()
    .single()
  if (error) throw error

  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'stock_pool',
    entityId: null,
    category: 'partner',
    description: `Set central stock for ${variantLabel(variant)} to ${total}`,
    newValues: { variant, total_stock: total },
  })
  return data
}

// --- Allotments ------------------------------------------------------------

// Admin allots units from the pool to an exec. The DB guard blocks over-allot.
export async function allot({ execId, variant, units, note = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('allotments')
    .insert({
      exec_id: execId,
      variant,
      units,
      status: 'pending',
      allotted_by: user?.id || null,
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

import { supabase } from './supabase'
import { VARIANTS } from './demoData'
import { getBatchFreshnessMap } from './batches'

// ============================================================================
// unsold.js — ADMIN-side data layer for the Unsold dashboard (Stage 6).
//
// unsold_units tracks wasted/expired stock across the whole operation
// (holder_type 'agent' | 'partner'). RLS already lets admin/sales read EVERY
// row (select = admin/sales OR holder_id = auth.uid()), so an admin sees all
// holders without any special RPC. Read-only aggregation — no monetary charge.
//
// Each row is enriched with the holder's name (logistics.profiles), the
// recorder's name, and the originating batch's number + expiry (these units
// are already expired, so we show the expiry DATE, not a live countdown).
// ============================================================================

export function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

// Every unsold row, newest first, enriched for display.
export async function getAllUnsold() {
  const { data, error } = await supabase
    .from('unsold_units')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = data || []

  // Resolve holder + recorder names from logistics.profiles in one round-trip.
  const profileIds = [
    ...new Set(rows.flatMap((r) => [r.holder_id, r.recorded_by]).filter(Boolean)),
  ]
  let profiles = {}
  if (profileIds.length) {
    const { data: pdata, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role')
      .in('id', profileIds)
    if (pErr) console.warn('Unsold profile lookup failed:', pErr.message)
    else profiles = Object.fromEntries((pdata || []).map((p) => [p.id, p]))
  }

  const batchMap = await getBatchFreshnessMap(rows.map((r) => r.batch_id))

  return rows.map((r) => ({
    ...r,
    variant_label: variantLabel(r.variant),
    holder_name: r.holder_id
      ? profiles[r.holder_id]?.full_name || (r.holder_type === 'partner' ? 'Partner' : 'Agent')
      : '—',
    holder_contact: r.holder_id ? profiles[r.holder_id]?.phone || '' : '',
    recorder_name: r.recorded_by ? profiles[r.recorded_by]?.full_name || '—' : '—',
    batch: r.batch_id ? batchMap[r.batch_id] || null : null,
  }))
}

import { supabase } from './supabase'
import { getAgentHoldingsByBatch } from './agentInventory'

// ============================================================================
// Batch holders — who CURRENTLY holds unsold units traceable to each batch.
// ----------------------------------------------------------------------------
//   • agents   — in-hand stock (agent_inventory_ledger, FIFO, net of handoffs),
//                attributed to the originating batch_id.
//   • partners — units still unsold on a sales row carrying that batch_id
//                (units_assigned − units_sold − retracted_units).
// Sold / retracted / closed units are excluded — only live holdings count.
//
// Self-contained (own fetches) so both the Batches page and the Assignment page
// derive the same "assigned to" list. RLS note: an admin reads every agent's
// ledger; a non-admin sales user only reads their own (other agents resolve to
// no in-hand holdings) but still sees all partner-held rows.
//
// Returns { [batchId]: [{ id, name, role:'agent'|'partner', variant,
//                         variant_label, units }] }, units-desc within a batch.
// ============================================================================

function saleVariant(s) {
  const mg = s?.multigrain_assigned || 0
  const pl = s?.plain_assigned || 0
  if (mg > 0 && pl === 0) return { variant: 'multigrain', variant_label: 'Multi-Grain' }
  if (pl > 0 && mg === 0) return { variant: 'plain', variant_label: 'Plain' }
  if (s?.product_variant) {
    const v = String(s.product_variant).toLowerCase()
    if (v.includes('multi')) return { variant: 'multigrain', variant_label: 'Multi-Grain' }
    if (v.includes('plain')) return { variant: 'plain', variant_label: 'Plain' }
  }
  return { variant: null, variant_label: '' }
}

export async function getBatchHolders() {
  const byBatch = {}
  const add = (batchId, entry) => {
    if (!batchId || (entry.units || 0) <= 0) return
    if (!byBatch[batchId]) byBatch[batchId] = []
    byBatch[batchId].push(entry)
  }

  // 1) Agents holding in-hand units (every active sales rep).
  const { data: agents } = await supabase
    .from('profiles')
    .select('id, full_name, email, status')
    .eq('role', 'sales')
  const activeAgents = (agents || []).filter((a) => (a.status || 'active') === 'active')
  await Promise.all(
    activeAgents.map(async (a) => {
      let holdings = []
      try {
        holdings = await getAgentHoldingsByBatch(a.id)
      } catch {
        holdings = []
      }
      for (const h of holdings) {
        add(h.batch?.id, {
          id: a.id,
          name: a.full_name || a.email || 'Agent',
          role: 'agent',
          variant: h.variant,
          variant_label: h.variant_label,
          units: h.units || 0,
        })
      }
    }),
  )

  // 2) Partners holding unsold units (sales rows carrying a batch_id).
  const { data: sales } = await supabase
    .from('sales')
    .select(`
      id, batch_id, units_assigned, units_sold, retracted_units,
      multigrain_assigned, plain_assigned, product_variant,
      trainers:profiles ( id, name:full_name, email )
    `)
  for (const s of sales || []) {
    if (!s.batch_id) continue
    const remaining = Math.max(
      0,
      (s.units_assigned || 0) - (s.units_sold || 0) - (s.retracted_units || 0),
    )
    if (remaining <= 0) continue
    const { variant, variant_label } = saleVariant(s)
    add(s.batch_id, {
      id: s.trainers?.id || s.id,
      name: s.trainers?.name || s.trainers?.email || 'Partner',
      role: 'partner',
      variant,
      variant_label,
      units: remaining,
    })
  }

  // Merge repeated (role · name · variant) entries within a batch, then order
  // each batch's holders by units (largest first).
  const merged = {}
  for (const [batchId, list] of Object.entries(byBatch)) {
    const m = new Map()
    for (const e of list) {
      const key = `${e.role}::${e.name}::${e.variant || ''}`
      if (!m.has(key)) m.set(key, { ...e })
      else m.get(key).units += e.units
    }
    merged[batchId] = Array.from(m.values()).sort((a, b) => b.units - a.units)
  }
  return merged
}

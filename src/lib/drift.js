import { supabase } from './supabase'
import { VARIANTS } from './demoData'

// ============================================================================
// drift.js — READ-ONLY reconciliation view of the agent → partner stock chain.
//
// PHASE 1 of the agent-stock-integrity project: makes existing phantom units
// VISIBLE so the admin can see WHERE the ledger and partner-side credits
// disagree BEFORE any enforcement is added (Phase 2 seals the leaks).
//
// NOTHING WRITTEN. No RPCs, no triggers, no RLS changes. Pure SELECTs against
// tables the admin already reads via existing policies:
//   - logistics.agent_inventory_ledger   ledger truth (agent side)
//   - logistics.partner_assignments      partner-side credit (workflow path)
//   - logistics.sales                    partner-side credit (assignment shape)
//                                        + partner self-sales (sold shape)
//   - logistics.profiles                 for names + phones
//
// Reconciliation model, per (agent × partner × variant):
//   ledger_delivered  = Σ agent_inventory_ledger.units
//                       where entry_type='delivered', agent_id=A, partner_id=P,
//                             variant=V
//   partner_credited  = Σ partner_assignments.units
//                       where salesperson_id=A, partner_id=P, variant=V,
//                             status IN ('pending','confirmed')
//                     + Σ sales.<v>_assigned
//                       where trainer_id=P, agent_id=A, <v>_assigned>0
//   drift             = partner_credited - ledger_delivered
//     > 0  PHANTOM   partner holds units the ledger never released → leak #1
//     < 0  ORPHAN    agent shipped units nothing on the partner side records
//     = 0  RECONCILED
//
// System-wide orphan lists (unattributable to a specific agent, so they show as
// their own leak signatures):
//   - unattributed_pa   partner_assignments with salesperson_id NULL
//                         → no agent to reconcile against
//   - self_inserted_sales  sales rows where trainer_id = created_by
//                          (partner self-sell path, agent_id typically NULL)
//   - unbatched_sales   any sales row with batch_id NULL (Stage-4+ contract:
//                       every unit should carry a batch clock; leak #2/#3)
// ============================================================================

const VARIANT_KEYS = ['multigrain', 'plain']

export function variantLabel(key) {
  return VARIANTS[key]?.short || key
}

async function fetchAllRows(from, select, orderCol = null) {
  const q = supabase.from(from).select(select)
  if (orderCol) q.order(orderCol, { ascending: false })
  const { data, error } = await q
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
    console.warn('drift profile lookup failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((p) => [p.id, p]))
}

// Sales rows come in two shapes on the same table:
//   assignment shape  multigrain_assigned/plain_assigned > 0, units_sold usually
//                     equals sum of the two OR 0; product_variant NULL;
//                     purchase_date NULL for pure-assignment rows.
//   sold shape        product_variant set + purchase_date set (partner self-sale
//                     path in PartnerDashboard). units_sold carries the count.
// A row can be BOTH (an assign_sale_fifo row credits mg/pl_assigned AND sets
// units_sold=total for the "Assign Unit" path). We split by looking at the
// individual counters, not the row.
function classifySale(row) {
  const mgA = row.multigrain_assigned || 0
  const plA = row.plain_assigned || 0
  const soldRow = !!row.product_variant && !!row.purchase_date
  return {
    mgAssigned: mgA,
    plAssigned: plA,
    // The "sold" leg — only counted if this row has the sold-shape markers.
    soldVariant: soldRow
      ? (row.product_variant.toLowerCase().includes('multi') ? 'multigrain' : 'plain')
      : null,
    soldUnits: soldRow ? (row.units_sold || 0) : 0,
  }
}

// Aggregate a numeric into a nested map: bag[a][b][v] += n.
function addPath(bag, a, b, v, n) {
  if (!bag[a]) bag[a] = {}
  if (!bag[a][b]) bag[a][b] = { multigrain: 0, plain: 0 }
  if (bag[a][b][v] !== undefined) bag[a][b][v] += n
}

// Main entry point — one round of SELECTs, aggregation, and enrichment.
// Admin-only surface; RLS already grants SELECT to all four tables for admin.
export async function getDriftReport() {
  const [ledger, assignments, sales] = await Promise.all([
    fetchAllRows(
      'agent_inventory_ledger',
      'id, agent_id, variant, entry_type, units, partner_id, batch_id, assignment_id, created_at',
      'created_at',
    ),
    fetchAllRows(
      'partner_assignments',
      'id, partner_id, salesperson_id, variant, units, status, batch_id, source_request_id, assigned_by, created_at',
      'created_at',
    ),
    fetchAllRows(
      'sales',
      'id, trainer_id, agent_id, product_variant, units_assigned, units_sold, multigrain_assigned, plain_assigned, multigrain_retracted, plain_retracted, retracted_units, batch_id, date_of_assignment, purchase_date, created_at',
      'created_at',
    ),
  ])

  // Resolve every profile we might display in one round-trip.
  const profileIds = new Set()
  for (const r of ledger) {
    if (r.agent_id) profileIds.add(r.agent_id)
    if (r.partner_id) profileIds.add(r.partner_id)
  }
  for (const r of assignments) {
    if (r.partner_id) profileIds.add(r.partner_id)
    if (r.salesperson_id) profileIds.add(r.salesperson_id)
    if (r.assigned_by) profileIds.add(r.assigned_by)
  }
  for (const r of sales) {
    if (r.trainer_id) profileIds.add(r.trainer_id)
    if (r.agent_id) profileIds.add(r.agent_id)
  }
  const profiles = await fetchProfileMap([...profileIds])
  const nameOf = (id) => (id ? profiles[id]?.full_name || '—' : '—')
  const phoneOf = (id) => (id ? profiles[id]?.phone || '' : '')
  const roleOf = (id) => (id ? profiles[id]?.role || '' : '')

  // --- Per-agent ledger totals -------------------------------------------
  // Structured for direct card rendering: totals + per-variant + in-hand.
  const agentLedger = {}
  const ensureAgent = (id) => {
    if (!agentLedger[id]) {
      agentLedger[id] = {
        agent_id: id,
        name: nameOf(id),
        contact: phoneOf(id),
        role: roleOf(id),
        totals: {
          received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0,
        },
        byVariant: {
          multigrain: { received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0, in_hand: 0 },
          plain: { received: 0, delivered: 0, returned: 0, expired: 0, withdrawn: 0, in_hand: 0 },
        },
        in_hand: 0,
      }
    }
    return agentLedger[id]
  }
  for (const r of ledger) {
    if (!r.agent_id) continue
    const a = ensureAgent(r.agent_id)
    const u = r.units || 0
    if (a.totals[r.entry_type] !== undefined) a.totals[r.entry_type] += u
    const v = a.byVariant[r.variant]
    if (v && v[r.entry_type] !== undefined) v[r.entry_type] += u
  }
  for (const a of Object.values(agentLedger)) {
    for (const v of VARIANT_KEYS) {
      const b = a.byVariant[v]
      b.in_hand = b.received - b.delivered + b.returned - b.expired - b.withdrawn
      a.in_hand += b.in_hand
    }
  }

  // --- Ledger-delivered per (agent × partner × variant) ------------------
  const ledgerDelivered = {} // ledgerDelivered[agent][partner][variant] = units
  for (const r of ledger) {
    if (r.entry_type !== 'delivered' || !r.agent_id || !r.partner_id) continue
    addPath(ledgerDelivered, r.agent_id, r.partner_id, r.variant, r.units || 0)
  }

  // --- Partner-side credited per (agent × partner × variant) -------------
  // Path A: partner_assignments (pending|confirmed) that name a salesperson.
  const partnerCredited = {}
  const unattributedPA = [] // salesperson_id NULL → can't map to an agent
  for (const r of assignments) {
    if (!['pending', 'confirmed'].includes(r.status)) continue
    const u = r.units || 0
    if (u <= 0) continue
    if (!r.salesperson_id || !r.partner_id) {
      unattributedPA.push({
        id: r.id,
        partner_id: r.partner_id,
        partner_name: nameOf(r.partner_id),
        salesperson_id: r.salesperson_id,
        variant: r.variant,
        variant_label: variantLabel(r.variant),
        units: u,
        status: r.status,
        assigned_by: r.assigned_by,
        assigned_by_name: nameOf(r.assigned_by),
        created_at: r.created_at,
      })
      continue
    }
    addPath(partnerCredited, r.salesperson_id, r.partner_id, r.variant, u)
  }
  // Path B: sales rows carrying mg/pl_assigned with an agent_id attribution.
  const salesUnattributedAssigned = [] // has assigned units but agent_id NULL
  for (const r of sales) {
    const c = classifySale(r)
    if (c.mgAssigned === 0 && c.plAssigned === 0) continue
    if (!r.agent_id || !r.trainer_id) {
      salesUnattributedAssigned.push({
        id: r.id,
        trainer_id: r.trainer_id,
        partner_name: nameOf(r.trainer_id),
        agent_id: r.agent_id,
        multigrain_assigned: c.mgAssigned,
        plain_assigned: c.plAssigned,
        date_of_assignment: r.date_of_assignment,
        created_at: r.created_at,
        batch_id: r.batch_id,
      })
      continue
    }
    if (c.mgAssigned > 0) addPath(partnerCredited, r.agent_id, r.trainer_id, 'multigrain', c.mgAssigned)
    if (c.plAssigned > 0) addPath(partnerCredited, r.agent_id, r.trainer_id, 'plain', c.plAssigned)
  }

  // --- Drift rows: union of keys from both bags ---------------------------
  const driftRows = []
  const totalsByLeak = {
    phantom_multigrain: 0,
    phantom_plain: 0,
    orphan_multigrain: 0,
    orphan_plain: 0,
  }
  const agents = new Set([...Object.keys(ledgerDelivered), ...Object.keys(partnerCredited)])
  for (const a of agents) {
    const partners = new Set([
      ...Object.keys(ledgerDelivered[a] || {}),
      ...Object.keys(partnerCredited[a] || {}),
    ])
    for (const p of partners) {
      for (const v of VARIANT_KEYS) {
        const del = (ledgerDelivered[a]?.[p]?.[v]) || 0
        const cred = (partnerCredited[a]?.[p]?.[v]) || 0
        const drift = cred - del
        if (del === 0 && cred === 0) continue
        driftRows.push({
          key: `${a}::${p}::${v}`,
          agent_id: a,
          agent_name: nameOf(a),
          agent_role: roleOf(a),
          partner_id: p,
          partner_name: nameOf(p),
          partner_contact: phoneOf(p),
          variant: v,
          variant_label: variantLabel(v),
          ledger_delivered: del,
          partner_credited: cred,
          drift,
          status: drift > 0 ? 'phantom' : drift < 0 ? 'orphan' : 'reconciled',
        })
        if (drift > 0) totalsByLeak[`phantom_${v}`] += drift
        else if (drift < 0) totalsByLeak[`orphan_${v}`] += -drift
      }
    }
  }
  // Sort: worst phantom first, then reconciled, so the eye lands on drift.
  driftRows.sort((x, y) => {
    if (x.drift !== y.drift) return y.drift - x.drift
    return (y.partner_credited + y.ledger_delivered) - (x.partner_credited + x.ledger_delivered)
  })

  // --- Orphan lists (rows worth eyeballing directly) ----------------------
  // Sales rows with batch_id NULL — Stage-4+ contract violation. Every unit
  // shipping now should carry a batch clock; NULL means the write path bypassed
  // batch attribution (partner self-inserts, legacy assign paths).
  const unbatchedSales = sales
    .filter((r) => !r.batch_id)
    .map((r) => {
      const c = classifySale(r)
      return {
        id: r.id,
        trainer_id: r.trainer_id,
        partner_name: nameOf(r.trainer_id),
        agent_id: r.agent_id,
        agent_name: nameOf(r.agent_id),
        multigrain_assigned: c.mgAssigned,
        plain_assigned: c.plAssigned,
        product_variant: r.product_variant,
        units_sold: r.units_sold || 0,
        sold_variant: c.soldVariant,
        date_of_assignment: r.date_of_assignment,
        purchase_date: r.purchase_date,
        created_at: r.created_at,
      }
    })

  // Partner self-inserted sales — the PartnerDashboard quick-sale path
  // (trainer_id = self, agent_id NULL, batch_id NULL). Signature: sold-shape row
  // with no agent attribution and no batch clock. Every one of these is a leak.
  const partnerSelfSales = sales
    .filter((r) => {
      const c = classifySale(r)
      const isSold = c.soldVariant !== null
      return isSold && !r.agent_id && !r.batch_id
    })
    .map((r) => {
      const c = classifySale(r)
      return {
        id: r.id,
        trainer_id: r.trainer_id,
        partner_name: nameOf(r.trainer_id),
        variant: c.soldVariant,
        variant_label: variantLabel(c.soldVariant),
        units_sold: r.units_sold || 0,
        purchase_date: r.purchase_date,
        created_at: r.created_at,
      }
    })

  // Partner_assignments with NO matching ledger 'delivered' row (leak #1).
  // Simple match key: same (salesperson_id, partner_id, variant, units) —
  // that's how deliverToPartner wires the two. This is a HEURISTIC because
  // multiple identical deliveries can coexist, so we bucket-consume instead of
  // per-row match.
  const ledgerBucket = {} // key → available units
  for (const r of ledger) {
    if (r.entry_type !== 'delivered' || !r.agent_id || !r.partner_id) continue
    const k = `${r.agent_id}|${r.partner_id}|${r.variant}`
    ledgerBucket[k] = (ledgerBucket[k] || 0) + (r.units || 0)
  }
  const unlinkedAssignments = []
  for (const r of assignments) {
    if (!['pending', 'confirmed'].includes(r.status)) continue
    const u = r.units || 0
    if (u <= 0 || !r.salesperson_id || !r.partner_id) continue
    const k = `${r.salesperson_id}|${r.partner_id}|${r.variant}`
    const have = ledgerBucket[k] || 0
    if (have >= u) {
      ledgerBucket[k] = have - u
    } else {
      // Partially or entirely unbacked — the excess is the phantom.
      const phantom = u - have
      ledgerBucket[k] = 0
      unlinkedAssignments.push({
        id: r.id,
        partner_id: r.partner_id,
        partner_name: nameOf(r.partner_id),
        salesperson_id: r.salesperson_id,
        salesperson_name: nameOf(r.salesperson_id),
        variant: r.variant,
        variant_label: variantLabel(r.variant),
        units: u,
        phantom_units: phantom,
        status: r.status,
        batch_id: r.batch_id,
        assigned_by: r.assigned_by,
        assigned_by_name: nameOf(r.assigned_by),
        created_at: r.created_at,
      })
    }
  }

  // --- System-wide summary -----------------------------------------------
  const summary = {
    phantom_units: totalsByLeak.phantom_multigrain + totalsByLeak.phantom_plain,
    orphan_units: totalsByLeak.orphan_multigrain + totalsByLeak.orphan_plain,
    phantom_by_variant: {
      multigrain: totalsByLeak.phantom_multigrain,
      plain: totalsByLeak.phantom_plain,
    },
    orphan_by_variant: {
      multigrain: totalsByLeak.orphan_multigrain,
      plain: totalsByLeak.orphan_plain,
    },
    by_leak: {
      // Leak #1 signature: partner_assignments with no matching ledger delivery.
      leak1_unlinked_assignments: unlinkedAssignments.length,
      leak1_phantom_units: unlinkedAssignments.reduce((s, r) => s + r.phantom_units, 0),
      // Leak #2/#3 signature: any sale row with no batch clock.
      leak23_unbatched_sales: unbatchedSales.length,
      // Leak #3 sub-signature: partner self-inserted sold rows (no agent, no batch).
      leak3_partner_self_sales: partnerSelfSales.length,
      leak3_partner_self_units: partnerSelfSales.reduce((s, r) => s + r.units_sold, 0),
      // Aux: partner_assignments with no agent attribution at all.
      unattributed_partner_assignments: unattributedPA.length,
      unattributed_partner_assignment_units: unattributedPA.reduce((s, r) => s + r.units, 0),
      // Aux: sales rows w/ mg/pl_assigned but no agent_id (older assign paths).
      unattributed_sales_assigned: salesUnattributedAssigned.length,
    },
  }

  // Agents ordered by biggest reconciled+delivered footprint first so busy
  // agents surface at the top.
  const agentList = Object.values(agentLedger).sort(
    (x, y) => (y.totals.received + y.totals.delivered) - (x.totals.received + x.totals.delivered),
  )

  return {
    agents: agentList,
    driftRows,
    unbatchedSales,
    partnerSelfSales,
    unlinkedAssignments,
    unattributedPA,
    salesUnattributedAssigned,
    summary,
  }
}

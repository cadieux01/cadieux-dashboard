import { supabase } from './supabase'
import { logAuditEvent } from './audit'
import { VARIANTS } from './demoData'

// ============================================================================
// PARTNER CREDIT / PAYMENT TRACKING — data-access layer
// ----------------------------------------------------------------------------
// A credit-tracked assignment is a logistics.sales row written by
// assign_sale_fifo, identified by `payment_status IS NOT NULL`
// ('pending' | 'awaiting_verification' | 'paid'). amount_owed/amount_gross/
// margin_percent are snapshots taken at assign time.
//
// All state changes go through SECURITY DEFINER, role-gated RPCs:
//   set_partner_margin (admin), partner_request_mark_paid (partner),
//   verify_payment / reject_payment (admin/sales). Proof images live in the
//   private `payment-proofs` storage bucket (RLS: partner own folder,
//   admin/sales read all), viewed via short-lived signed URLs.
// ============================================================================

const PROOF_BUCKET = 'payment-proofs'

export function variantLabelFromSale(sale) {
  if (!sale) return '—'
  if (sale.product_variant && VARIANTS[sale.product_variant]) return VARIANTS[sale.product_variant].short
  const byName = Object.values(VARIANTS).find((v) => v.name === sale.product_variant)
  if (byName) return byName.short
  if ((sale.multigrain_assigned || 0) > 0 && (sale.plain_assigned || 0) > 0) return 'Mixed'
  if ((sale.multigrain_assigned || 0) > 0) return VARIANTS.multigrain.short
  if ((sale.plain_assigned || 0) > 0) return VARIANTS.plain.short
  return '—'
}

// --- Margin -----------------------------------------------------------------

// Resolve a sale row to a variant key ('multigrain' | 'plain' | null=mixed).
export function variantKeyFromSale(sale) {
  if (!sale) return null
  if (sale.product_variant && VARIANTS[sale.product_variant]) return sale.product_variant
  const byName = Object.values(VARIANTS).find((v) => v.name === sale.product_variant)
  if (byName) return byName.key
  const mg = sale.multigrain_assigned || 0
  const pl = sale.plain_assigned || 0
  if (mg > 0 && pl === 0) return 'multigrain'
  if (pl > 0 && mg === 0) return 'plain'
  return null
}

// Admin-only (server-enforced). Pass null to clear. 0..100.
export async function setPartnerMargin(partnerId, margin) {
  const value = margin === '' || margin == null ? null : Number(margin)
  const { data, error } = await supabase.rpc('set_partner_margin', {
    p_partner_id: partnerId,
    p_margin: value,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'user',
    entityId: partnerId,
    category: 'partner',
    description: `Set partner margin to ${value == null ? 'unset' : value + '%'}`,
    newValues: { margin_percent: value },
  })
  return data
}

// Admin-only (server-enforced). Per-variant margins + payout cycle length.
// Pass null on any field to clear it.
export async function setPartnerMargins(partnerId, { multigrain, plain, payoutDays } = {}) {
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const mg = num(multigrain)
  const pl = num(plain)
  const days = num(payoutDays)
  const { data, error } = await supabase.rpc('set_partner_margins', {
    p_partner_id: partnerId,
    p_margin_multigrain: mg,
    p_margin_plain: pl,
    p_payout_days: days == null ? null : Math.round(days),
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'user',
    entityId: partnerId,
    category: 'partner',
    description: `Set partner margins — MG ${mg == null ? 'unset' : mg + '%'}, Plain ${pl == null ? 'unset' : pl + '%'}, payout ${days == null ? 'unset' : days + 'd'}`,
    newValues: { margin_percent_multigrain: mg, margin_percent_plain: pl, payout_days: days },
  })
  return data
}

// --- Credit assignment lists ------------------------------------------------

// Credit-tracked assignment rows. Scope by partner (partner portal / partner
// profile) or by agent (salesperson view); omit both for all (admin). RLS still
// applies — a partner only ever sees their own rows.
export async function listCreditAssignments({ partnerId = null, agentId = null } = {}) {
  let query = supabase
    .from('sales')
    .select('*')
    .not('payment_status', 'is', null)
    .order('date_of_assignment', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (partnerId) query = query.eq('trainer_id', partnerId)
  if (agentId) query = query.eq('agent_id', agentId)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// Roll a set of credit assignments into payment totals.
export function summarizePayments(rows) {
  const t = {
    grossTotal: 0,
    owedPending: 0,        // owed on 'pending' assignments
    owedAwaiting: 0,       // owed on 'awaiting_verification' assignments
    owedPaid: 0,           // owed that has been settled ('paid')
    countPending: 0,
    countAwaiting: 0,
    countPaid: 0,
  }
  for (const r of rows || []) {
    const owed = Number(r.amount_owed) || 0
    t.grossTotal += Number(r.amount_gross) || 0
    if (r.payment_status === 'pending') { t.owedPending += owed; t.countPending += 1 }
    else if (r.payment_status === 'awaiting_verification') { t.owedAwaiting += owed; t.countAwaiting += 1 }
    else if (r.payment_status === 'paid') { t.owedPaid += owed; t.countPaid += 1 }
  }
  t.owedOutstanding = t.owedPending + t.owedAwaiting
  return t
}

// --- Verification queue (admin/sales) ---------------------------------------

// Open payment-confirmation requests awaiting verification, enriched with the
// assignment + partner name. RLS returns all rows to admin/sales.
export async function listPaymentVerifications() {
  const { data: confs, error } = await supabase
    .from('payment_confirmations')
    .select('*')
    .eq('status', 'awaiting_verification')
    .order('requested_at', { ascending: true })
  if (error) throw error
  if (!confs || confs.length === 0) return []

  const saleIds = [...new Set(confs.map((c) => c.sale_id))]
  const partnerIds = [...new Set(confs.map((c) => c.partner_id))]

  const [{ data: sales }, { data: profiles }] = await Promise.all([
    supabase.from('sales').select('*').in('id', saleIds),
    supabase.from('profiles').select('id, full_name, phone, phone_number').in('id', partnerIds),
  ])
  const saleById = Object.fromEntries((sales || []).map((s) => [s.id, s]))
  const profById = Object.fromEntries((profiles || []).map((p) => [p.id, p]))

  return confs.map((c) => {
    const sale = saleById[c.sale_id] || null
    const prof = profById[c.partner_id] || null
    return {
      ...c,
      sale,
      partner_name: prof?.full_name || 'Partner',
      partner_phone: prof?.phone || prof?.phone_number || '',
      variant_label: variantLabelFromSale(sale),
      units: sale?.units_assigned || 0,
    }
  })
}

// --- Partner: upload proof + request mark-paid ------------------------------

// Upload a proof file to the partner's own folder. Returns the storage path.
export async function uploadPaymentProof(partnerId, file) {
  const ext = (file.name?.split('.').pop() || 'dat').toLowerCase()
  const path = `${partnerId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw error
  return path
}

// Partner requests verification of a payment (own pending assignment), with an
// optional uploaded proof path. Flips the assignment to 'awaiting_verification'.
export async function requestMarkPaid(saleId, proofPath = null) {
  const { data, error } = await supabase.rpc('partner_request_mark_paid', {
    p_sale_id: saleId,
    p_proof_path: proofPath,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'sale',
    entityId: saleId,
    category: 'sale',
    description: 'Partner submitted payment proof for verification',
    newValues: { payment_status: 'awaiting_verification' },
  })
  return data
}

// --- Admin/sales: verify or reject ------------------------------------------

export async function verifyPayment(saleId) {
  const { data, error } = await supabase.rpc('verify_payment', { p_sale_id: saleId })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'sale',
    entityId: saleId,
    category: 'sale',
    description: 'Verified partner payment',
    newValues: { payment_status: 'paid' },
  })
  return data
}

export async function rejectPayment(saleId, reason = null) {
  const { data, error } = await supabase.rpc('reject_payment', {
    p_sale_id: saleId,
    p_reason: reason,
  })
  if (error) throw error
  await logAuditEvent({
    actionType: 'UPDATE',
    entityType: 'sale',
    entityId: saleId,
    category: 'sale',
    description: `Rejected partner payment${reason ? ': ' + reason : ''}`,
    newValues: { payment_status: 'pending', reject_reason: reason || null },
  })
  return data
}

// --- Earnings / payout calculation ------------------------------------------

// Margins for a profile row, per variant (falls back to legacy single value).
function marginsOf(prof) {
  const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0))
  const mg = prof?.margin_percent_multigrain ?? prof?.margin_percent
  const pl = prof?.margin_percent_plain ?? prof?.margin_percent
  return {
    multigrain: prof?.margin_percent_multigrain == null && prof?.margin_percent == null ? null : clamp(mg),
    plain: prof?.margin_percent_plain == null && prof?.margin_percent == null ? null : clamp(pl),
    payoutDays: prof?.payout_days ?? null,
  }
}

function emptyVariantSplit() {
  return {
    multigrain: { units: 0, gross: 0, earned: 0, owed: 0 },
    plain: { units: 0, gross: 0, earned: 0, owed: 0 },
  }
}

// Calculate earnings from ACTUAL sale records (units_sold rows) in a period.
// "units sold" = sales.units_sold by purchase_date, per variant. Gross =
// units × MRP; earned (partner cut) = gross × variant%/100; owed (company) =
// gross × (100−variant%)/100. Scope to one partner (own portal) or omit for
// all partners (admin/sales aggregate). RLS still applies.
export async function calculateEarnings({ partnerId = null, fromDate = null, toDate = null } = {}) {
  let query = supabase
    .from('sales')
    .select('id, trainer_id, units_sold, multigrain_assigned, plain_assigned, product_variant, purchase_date')
    .gt('units_sold', 0)
  if (partnerId) query = query.eq('trainer_id', partnerId)
  if (fromDate) query = query.gte('purchase_date', fromDate)
  if (toDate) query = query.lte('purchase_date', toDate)
  const { data: rows, error } = await query
  if (error) throw error

  const partnerIds = [...new Set((rows || []).map((r) => r.trainer_id).filter(Boolean))]
  let profById = {}
  if (partnerIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, phone, phone_number, margin_percent, margin_percent_multigrain, margin_percent_plain, payout_days')
      .in('id', partnerIds)
    profById = Object.fromEntries((profs || []).map((p) => [p.id, p]))
  }

  const perPartner = {}
  const totals = { gross: 0, earned: 0, owed: 0, units: 0, byVariant: emptyVariantSplit() }

  for (const r of rows || []) {
    const key = variantKeyFromSale(r)
    if (key !== 'multigrain' && key !== 'plain') continue // skip mixed/unknown
    const units = Number(r.units_sold) || 0
    if (units <= 0) continue
    const prof = profById[r.trainer_id] || null
    const m = marginsOf(prof)
    const marginPct = m[key] == null ? 0 : m[key]
    const mrp = VARIANTS[key].price
    const gross = units * mrp
    const earned = Math.round(gross * marginPct) / 100
    const owed = Math.round(gross * (100 - marginPct)) / 100

    if (!perPartner[r.trainer_id]) {
      perPartner[r.trainer_id] = {
        id: r.trainer_id,
        name: prof?.full_name || 'Partner',
        phone: prof?.phone || prof?.phone_number || '',
        margins: m,
        gross: 0, earned: 0, owed: 0, units: 0,
        byVariant: emptyVariantSplit(),
      }
    }
    const p = perPartner[r.trainer_id]
    p.gross += gross; p.earned += earned; p.owed += owed; p.units += units
    p.byVariant[key].units += units; p.byVariant[key].gross += gross
    p.byVariant[key].earned += earned; p.byVariant[key].owed += owed

    totals.gross += gross; totals.earned += earned; totals.owed += owed; totals.units += units
    totals.byVariant[key].units += units; totals.byVariant[key].gross += gross
    totals.byVariant[key].earned += earned; totals.byVariant[key].owed += owed
  }

  const partners = Object.values(perPartner).sort((a, b) => b.gross - a.gross)
  return { totals, partners }
}

// --- Proof viewing ----------------------------------------------------------

// Short-lived signed URL for a stored proof (private bucket). 60s default.
export async function getProofSignedUrl(path, expiresIn = 60) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, expiresIn)
  if (error) {
    console.warn('Proof signed URL failed:', error.message)
    return null
  }
  return data?.signedUrl || null
}

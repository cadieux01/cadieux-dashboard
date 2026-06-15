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

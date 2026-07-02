import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShoppingCart, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import FormField from '../components/FormField'
import UnitWheel from '../components/UnitWheel'
import RefreshButton from '../components/RefreshButton'
import useRefreshable from '../lib/useRefreshable'
import { logAuditEvent } from '../lib/audit'
import {
  getPartnerVariantAvailable,
  recordAgentSaleForPartner,
} from '../lib/partnerInventory'

// ============================================================================
// Phase 4 (Change 4): Agent (or admin) records a sale ON BEHALF of a partner.
//
// THREE-BOX CASCADING FLOW (Raja's spec):
//   Box 1  SELECT PARTNER — lists ALL active partners, each option shows the
//          partner's current holdings summary ("Jat — MG 4 · PL 2", or
//          "— no units"). Selecting a partner populates Box 2.
//   Box 2  SELECT VARIANT — only variants the partner actually holds appear
//          (with unit count). Auto-selects if the partner holds exactly one.
//          Empty state ("This partner holds no units") + Box 3 disabled when
//          the partner holds nothing.
//   Box 3  SELECT UNITS  — capped at the partner's real available for the
//          selected variant. Resets whenever partner or variant changes.
//
// DATA: per-partner holdings come from the Phase-3 helper
// `partner_variant_available(p_partner, p_variant)` — the exact same RPC the
// atomic record_partner_sale / retract_from_partner guards use. Both admin +
// sales see all partners (per Raja's decision); record_agent_sale_for_partner
// itself already permits either caller for any partner.
//
// Nothing here changes the RPC or the stock logic. The `partner_insufficient_stock`
// bound remains the authoritative enforcement — this UI is belt-and-suspenders.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

const VARIANTS = {
  multigrain: { name: 'Multi-Grain High Protein Bread', short: 'Multi-Grain', price: 149 },
  plain: { name: 'Plain High Protein Bread', short: 'Plain', price: 109 },
}

const VARIANT_KEYS = ['multigrain', 'plain']

function emptyForm() {
  return {
    partner_id: '',
    variant: '',
    units: 0,
    buyer_name: '',
    buyer_contact: '',
    customer_notes: '',
  }
}

async function listActivePartners() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, status')
    .eq('role', 'partner')
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data || []).filter((p) => (p.status || 'active') === 'active')
}

// Fetch one partner's per-variant holdings via the Phase-3 partner-available
// RPC. Kept in one place so Box 1's dropdown summaries + Box 3's cap always
// agree byte-for-byte with the server's atomic cap.
async function fetchHoldingsForPartner(partnerId) {
  const [mg, pl] = await Promise.all([
    getPartnerVariantAvailable(partnerId, 'multigrain'),
    getPartnerVariantAvailable(partnerId, 'plain'),
  ])
  return { multigrain: mg || 0, plain: pl || 0 }
}

function summariseHoldings(h) {
  if (!h) return '…'
  const total = (h.multigrain || 0) + (h.plain || 0)
  if (total <= 0) return '— no units'
  return `MG ${h.multigrain} · PL ${h.plain}`
}

export default function SellForPartner() {
  const { profile, isDemo } = useAuth()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  // Per-partner holdings map { [partnerId]: { multigrain, plain } }. Fetched
  // once on mount for the Box-1 dropdown summaries; the SELECTED partner is
  // additionally refreshed on select + on the 30s poll so the Box-3 cap is
  // always live vs. concurrent sales/retracts elsewhere.
  const [holdingsByPartner, setHoldingsByPartner] = useState({})
  const [holdingsLoading, setHoldingsLoading] = useState(false)
  const [availLoading, setAvailLoading] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [errMsg, setErrMsg] = useState(null)

  const loadPartners = useCallback(async () => {
    if (isDemo) {
      setPartners([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const list = await listActivePartners()
      setPartners(list)
    } catch (e) {
      console.error('SellForPartner: failed to list partners', e)
      setPartners([])
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  // Batch-load holdings for every partner in the dropdown. For a small partner
  // roster (typically <10) this is a handful of parallel RPCs and lets Box 1
  // show real numbers on FIRST render, not after each partner is picked.
  const loadAllHoldings = useCallback(async (partnerList) => {
    if (!partnerList || partnerList.length === 0) return
    setHoldingsLoading(true)
    try {
      const entries = await Promise.all(
        partnerList.map(async (p) => {
          try {
            return [p.id, await fetchHoldingsForPartner(p.id)]
          } catch (e) {
            console.warn(`SellForPartner: holdings load failed for ${p.id}`, e.message)
            return [p.id, { multigrain: 0, plain: 0 }]
          }
        }),
      )
      setHoldingsByPartner(Object.fromEntries(entries))
    } finally {
      setHoldingsLoading(false)
    }
  }, [])

  const refreshOnePartner = useCallback(async (partnerId) => {
    if (!partnerId) return
    setAvailLoading(true)
    try {
      const h = await fetchHoldingsForPartner(partnerId)
      setHoldingsByPartner((prev) => ({ ...prev, [partnerId]: h }))
    } catch (e) {
      console.error('SellForPartner: refresh availability failed', e)
    } finally {
      setAvailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPartners()
  }, [loadPartners])

  useEffect(() => {
    if (!loading && partners.length > 0) loadAllHoldings(partners)
  }, [loading, partners, loadAllHoldings])

  // Refresh the selected partner's holdings on selection change so the Box 3
  // cap is guaranteed current (initial batch may have been minutes ago).
  useEffect(() => {
    if (form.partner_id) refreshOnePartner(form.partner_id)
  }, [form.partner_id, refreshOnePartner])

  // 30s poll of the selected partner (focus/visibility included via hook)
  // keeps the cap live against concurrent sales/retracts elsewhere.
  useRefreshable(
    () => (form.partner_id ? refreshOnePartner(form.partner_id) : Promise.resolve()),
    { auto: !!form.partner_id, intervalMs: 30000 },
  )

  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === form.partner_id) || null,
    [partners, form.partner_id],
  )

  const selectedHoldings = form.partner_id ? holdingsByPartner[form.partner_id] : null

  // Only variants the partner ACTUALLY holds appear in Box 2. Auto-select the
  // sole held variant when there's exactly one so the flow moves in one tap.
  const heldVariants = useMemo(() => {
    if (!selectedHoldings) return []
    return VARIANT_KEYS.filter((v) => (selectedHoldings[v] || 0) > 0)
  }, [selectedHoldings])

  useEffect(() => {
    // Auto-select the sole held variant; else drop back to '' so Box 2 always
    // reflects real held-only options.
    if (!form.partner_id) {
      if (form.variant !== '') setForm((f) => ({ ...f, variant: '', units: 0 }))
      return
    }
    if (heldVariants.length === 1 && form.variant !== heldVariants[0]) {
      setForm((f) => ({ ...f, variant: heldVariants[0], units: 0 }))
    } else if (heldVariants.length === 0 && form.variant !== '') {
      setForm((f) => ({ ...f, variant: '', units: 0 }))
    } else if (form.variant && !heldVariants.includes(form.variant)) {
      // Previously-picked variant is no longer held → reset.
      setForm((f) => ({ ...f, variant: '', units: 0 }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.partner_id, heldVariants.join(',')])

  const cap = form.variant && selectedHoldings ? selectedHoldings[form.variant] : 0
  const maxUnits = Number.isFinite(cap) ? Math.max(0, cap) : 0

  const canSubmit =
    !!form.partner_id &&
    !!form.variant &&
    form.units > 0 &&
    form.units <= maxUnits &&
    !submitting &&
    !isDemo

  const onChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setErrMsg(null)
  }

  const onPartnerChange = (partnerId) => {
    // New partner → reset the cascade (variant + units) so Box 2/3 don't carry
    // stale selections from the previous partner's holdings.
    setForm((f) => ({ ...f, partner_id: partnerId, variant: '', units: 0 }))
    setErrMsg(null)
  }

  const onVariantChange = (variantKey) => {
    // Reset units when switching variant so the cap always applies to the
    // right pool (the wheel's max prop is variant-scoped).
    setForm((f) => ({ ...f, variant: variantKey, units: 0 }))
    setErrMsg(null)
  }

  const onSubmit = async (e) => {
    e?.preventDefault?.()
    setErrMsg(null)
    if (!canSubmit) return
    if (!profile?.id) {
      setErrMsg('Not signed in')
      return
    }
    setSubmitting(true)
    try {
      const variantDef = VARIANTS[form.variant]
      const receipt = await recordAgentSaleForPartner({
        agentId: profile.id,
        partnerId: form.partner_id,
        variant: form.variant,
        units: form.units,
        unitPrice: variantDef.price,
        buyerName: form.buyer_name.trim() || null,
        buyerContact: form.buyer_contact.trim() || null,
        customerNotes: form.customer_notes.trim() || null,
      })

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'sale',
        entityId: receipt?.last_sale_id || form.partner_id,
        category: 'partner',
        description: `Agent recorded ${form.units} × ${variantDef.short} sale for ${selectedPartner?.full_name || 'partner'}`,
        newValues: {
          partner_id: form.partner_id,
          agent_id: profile.id,
          variant: form.variant,
          units: form.units,
        },
      })

      setToast(
        `Recorded ${form.units} × ${variantDef.short} sale for ${selectedPartner?.full_name || 'partner'}`,
      )
      setTimeout(() => setToast(null), 3000)

      // Reset units + buyer info; keep partner + variant selected so the agent
      // can log another sale for the same partner without picking again.
      setForm((f) => ({
        ...f,
        units: 0,
        buyer_name: '',
        buyer_contact: '',
        customer_notes: '',
      }))
      await refreshOnePartner(form.partner_id)
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('partner_insufficient_stock')) {
        setErrMsg('Partner does not have enough stock in hand — refresh and try a smaller number.')
      } else if (err?.code === '42501' || msg.includes('Not authorized')) {
        setErrMsg('Not authorized. Only admin/sales can record a sale on behalf of a partner.')
      } else {
        setErrMsg(`Failed to record sale: ${msg}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isDemo) {
    return (
      <div className="dashboard-page">
        <h1 className="dashboard-title flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> Sell for Partner
        </h1>
        <div className={CARD}>
          <p className="text-slate-400">This flow is not available in demo mode.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="dashboard-title flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" /> Sell for Partner
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Record a sale from the partner&apos;s in-hand units. Draws down real assigned stock
            (bounded by the partner&apos;s aggregate) — no phantom rows can be created.
          </p>
        </div>
        <RefreshButton onClick={() => loadAllHoldings(partners)} />
      </div>

      <form onSubmit={onSubmit} className={CARD}>
        {/* ---------------------------------------------------------------- */}
        {/* BOX 1 — SELECT PARTNER                                            */}
        {/* All partners; each option shows the real holdings summary from    */}
        {/* partner_variant_available (Phase-3 RPC). Selecting cascades.      */}
        {/* ---------------------------------------------------------------- */}
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                Step 1
              </p>
              <h2 className="text-sm font-semibold text-slate-100">Select partner</h2>
            </div>
            <p className="text-[11px] text-slate-500">
              {holdingsLoading ? 'Loading holdings…' : 'Numbers show real in-hand units'}
            </p>
          </header>
          <FormField label="Partner" required>
            <select
              className="dashboard-select"
              value={form.partner_id}
              onChange={(e) => onPartnerChange(e.target.value)}
              disabled={loading}
              required
            >
              <option value="">
                {loading ? 'Loading partners…' : 'Choose a partner'}
              </option>
              {partners.map((p) => {
                const summary = summariseHoldings(holdingsByPartner[p.id])
                return (
                  <option key={p.id} value={p.id}>
                    {p.full_name || 'Unnamed'} — {summary}
                  </option>
                )
              })}
            </select>
          </FormField>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* BOX 2 — SELECT VARIANT                                            */}
        {/* Only variants this partner actually holds. Auto-selects if only  */}
        {/* one is held. Empty state when they hold nothing.                  */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                Step 2
              </p>
              <h2 className="text-sm font-semibold text-slate-100">Select variant</h2>
            </div>
            <p className="text-[11px] text-slate-500">
              {selectedPartner
                ? availLoading
                  ? 'Refreshing…'
                  : `From ${selectedPartner.full_name || 'partner'}'s in-hand only`
                : 'Pick a partner first'}
            </p>
          </header>

          {!form.partner_id ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-950/30 px-3 py-4 text-center text-sm text-slate-500">
              Pick a partner in Step 1 to see their held variants.
            </div>
          ) : heldVariants.length === 0 ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-4 text-center text-sm text-amber-300">
              This partner holds no units. Nothing to sell.
            </div>
          ) : (
            <FormField label="Variant" required>
              <select
                className="dashboard-select"
                value={form.variant}
                onChange={(e) => onVariantChange(e.target.value)}
                required
              >
                {heldVariants.length > 1 && (
                  <option value="">Choose a variant</option>
                )}
                {heldVariants.map((v) => (
                  <option key={v} value={v}>
                    {VARIANTS[v].short} ({selectedHoldings?.[v] || 0} available)
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* BOX 3 — SELECT UNITS                                              */}
        {/* Capped at partner_variant_available for the (partner, variant).   */}
        {/* Server-side bound still enforces partner_insufficient_stock.      */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                Step 3
              </p>
              <h2 className="text-sm font-semibold text-slate-100">Select units</h2>
            </div>
            <p className="text-[11px] text-slate-500">
              {form.partner_id && form.variant
                ? `${maxUnits} available`
                : 'Complete Steps 1 & 2'}
            </p>
          </header>

          {!form.partner_id || !form.variant ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-950/30 px-3 py-4 text-center text-sm text-slate-500">
              {!form.partner_id
                ? 'Pick a partner in Step 1.'
                : heldVariants.length === 0
                ? 'Partner holds no units.'
                : 'Pick a variant in Step 2.'}
            </div>
          ) : maxUnits <= 0 ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-4 text-center text-sm text-slate-500">
              Partner has 0 units in hand for {VARIANTS[form.variant].short}.
            </div>
          ) : (
            <FormField label={`Units to record as sold (max ${maxUnits})`} required>
              <UnitWheel
                value={form.units}
                onChange={(v) => onChange('units', v)}
                min={0}
                max={maxUnits}
                hint="Server enforces the cap"
              />
            </FormField>
          )}
        </section>

        {/* Buyer / notes — optional metadata for the sale. */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Buyer name (optional)">
            <input
              className="dashboard-input"
              type="text"
              value={form.buyer_name}
              onChange={(e) => onChange('buyer_name', e.target.value)}
              placeholder="Walk-in"
              maxLength={120}
            />
          </FormField>
          <FormField label="Buyer contact (optional)">
            <input
              className="dashboard-input"
              type="text"
              value={form.buyer_contact}
              onChange={(e) => onChange('buyer_contact', e.target.value)}
              placeholder="Phone or note"
              maxLength={120}
            />
          </FormField>
        </div>

        <div className="mt-4">
          <FormField label="Notes (optional)">
            <textarea
              className="dashboard-input min-h-[72px]"
              value={form.customer_notes}
              onChange={(e) => onChange('customer_notes', e.target.value)}
              placeholder="Anything worth remembering for this sale"
              maxLength={500}
            />
          </FormField>
        </div>

        {errMsg && (
          <div className="mt-4 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
            {errMsg}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Attributed to{' '}
            <span className="font-semibold text-slate-300">
              {profile?.full_name || 'you'}
            </span>{' '}
            (agent_id stamped on any converted rows)
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-[#fbf3d4] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Recording…
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" /> Record sale for partner
              </>
            )}
          </button>
        </div>
      </form>

      {toast && (
        <div className="fixed bottom-24 right-4 z-[60] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] shadow-lg ring-1 ring-emerald-400/40 md:bottom-16">
          {toast}
        </div>
      )}
    </div>
  )
}

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
// The partner's variant-scoped in-hand aggregate is fetched server-side via
// partner_variant_available (Phase 3 helper), the input is capped at that
// number, and submit calls record_agent_sale_for_partner (which then delegates
// to record_partner_sale with agent attribution). Partner-in-hand cap is
// enforced authoritatively server-side; the UI display is advisory.
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

const VARIANTS = {
  multigrain: { name: 'Multi-Grain High Protein Bread', short: 'Multi-Grain', price: 149 },
  plain: { name: 'Plain High Protein Bread', short: 'Plain', price: 109 },
}

function emptyForm() {
  return {
    partner_id: '',
    variant: 'multigrain',
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

export default function SellForPartner() {
  const { profile, isDemo } = useAuth()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [availability, setAvailability] = useState({ multigrain: null, plain: null })
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

  const loadAvailability = useCallback(async (partnerId) => {
    if (!partnerId) {
      setAvailability({ multigrain: null, plain: null })
      return
    }
    setAvailLoading(true)
    try {
      const [mg, pl] = await Promise.all([
        getPartnerVariantAvailable(partnerId, 'multigrain'),
        getPartnerVariantAvailable(partnerId, 'plain'),
      ])
      setAvailability({ multigrain: mg, plain: pl })
    } catch (e) {
      console.error('SellForPartner: availability lookup failed', e)
      setAvailability({ multigrain: 0, plain: 0 })
    } finally {
      setAvailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPartners()
  }, [loadPartners])

  useEffect(() => {
    loadAvailability(form.partner_id)
  }, [form.partner_id, loadAvailability])

  // Auto-refresh availability so a concurrent sale/retract elsewhere is
  // reflected quickly (30s poll + focus/visibility, matching sibling pages).
  useRefreshable(
    () => (form.partner_id ? loadAvailability(form.partner_id) : Promise.resolve()),
    { auto: !!form.partner_id, intervalMs: 30000 }
  )

  const cap = form.variant === 'multigrain' ? availability.multigrain : availability.plain
  const maxUnits = Number.isFinite(cap) ? Math.max(0, cap) : 0
  const canSubmit =
    !!form.partner_id && form.units > 0 && form.units <= maxUnits && !submitting && !isDemo

  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === form.partner_id),
    [partners, form.partner_id]
  )

  const onChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
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
        `Recorded ${form.units} × ${variantDef.short} sale for ${selectedPartner?.full_name || 'partner'}`
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
      await loadAvailability(form.partner_id)
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
            Record a sale from the partner's in-hand units. Draws down real assigned stock
            (bounded by the partner's aggregate) — no phantom rows can be created.
          </p>
        </div>
        <RefreshButton onClick={() => form.partner_id && loadAvailability(form.partner_id)} />
      </div>

      <form onSubmit={onSubmit} className={CARD}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Partner" required>
            <select
              className="dashboard-select"
              value={form.partner_id}
              onChange={(e) => onChange('partner_id', e.target.value)}
              disabled={loading}
              required
            >
              <option value="">
                {loading ? 'Loading partners…' : 'Choose a partner'}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || 'Unnamed'} {p.phone ? `· ${p.phone}` : ''}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Variant" required>
            <div className="flex gap-2">
              {Object.entries(VARIANTS).map(([key, v]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onVariantChange(key)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    form.variant === key
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {v.short}
                </button>
              ))}
            </div>
          </FormField>
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Partner's in-hand for {VARIANTS[form.variant].short}:</span>
            <span className="font-mono font-bold text-emerald-400">
              {!form.partner_id
                ? '—'
                : availLoading
                ? 'Loading…'
                : `${maxUnits} units available`}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Aggregate across the partner's sales rows and pending/confirmed shipments. Server
            enforces this cap on submit.
          </p>
        </div>

        <div className="mt-4">
          <FormField label={`Units to record as sold (max ${maxUnits})`} required>
            {maxUnits > 0 ? (
              <UnitWheel
                value={form.units}
                onChange={(v) => onChange('units', v)}
                min={0}
                max={maxUnits}
                hint="Server enforces the cap"
              />
            ) : (
              <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-4 text-center text-sm text-slate-500">
                {form.partner_id
                  ? 'Partner has 0 units in hand for this variant.'
                  : 'Pick a partner to see availability.'}
              </div>
            )}
          </FormField>
        </div>

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
            Attributed to <span className="font-semibold text-slate-300">{profile?.full_name || 'you'}</span>{' '}
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

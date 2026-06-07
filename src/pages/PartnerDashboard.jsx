import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, UserPlus, ShoppingCart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import UnitWheel from '../components/UnitWheel'
import KPICard from '../components/KPICard'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { demoBlock, demoPartnerSales } from '../lib/demoData'
import { listMyAssignments, listMyRequests } from '../lib/partnerWorkflow'
import {
  SHELF_LIFE,
  shelfDay,
  daysLeft as shelfDaysLeft,
  shelfPercentUsed,
  getAssignmentStatus,
  isLastDay,
} from '../lib/shelfLife'

const QUICK_SALE_DEFAULTS = { mg_units: 0, plain_units: 0, customer_name: '', customer_phone: '' }

const VARIANTS = {
  multigrain: { name: 'Multi-Grain High Protein Bread', short: 'Multigrain', price: 149 },
  plain: { name: 'Plain High Protein Bread', short: 'Plain', price: 109 },
}

// A fresh, empty "Add Customer" form. Supports selecting BOTH variants on one
// entry: mg_selected/pl_selected toggle the chips, mg_units/pl_units hold each
// variant's count. On submit we write one sales row per selected variant
// (see handleSaveCustomer) so existing per-variant reporting stays correct.
const emptyCustomerForm = () => ({
  buyer_name: '',
  buyer_contact: '',
  mg_selected: false,
  pl_selected: false,
  mg_units: '',
  pl_units: '',
  purchase_date: new Date().toISOString().split('T')[0],
  notes: '',
  picture_file: null,
})

// Resolve a stored variant (by key or by saved name) back to its definition.
const variantFromSale = (sale) => {
  if (!sale) return null
  if (sale.product_variant && VARIANTS[sale.product_variant]) return VARIANTS[sale.product_variant]
  const byName = Object.values(VARIANTS).find((v) => v.name === sale.product_variant)
  if (byName) return byName
  return null
}

// Per-sale revenue: prefer the unit price stored at time of sale, fall back to
// the variant's current price, and finally to 0 for legacy rows.
const saleRevenue = (sale) => {
  const units = sale.units_sold || 0
  const price = sale.unit_price ?? variantFromSale(sale)?.price ?? 0
  return units * price
}

export default function PartnerDashboard() {
  const { profile, isDemo, refreshProfile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState([])
  const [assignments, setAssignments] = useState([])
  const [requests, setRequests] = useState([])
  const [trainerId, setTrainerId] = useState(null)
  const initialLoadDoneRef = useRef(false)
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false)
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState(null)
  const [editingSaleId, setEditingSaleId] = useState(null)
  const [customerFormData, setCustomerFormData] = useState(emptyCustomerForm())
  const [formErrors, setFormErrors] = useState({})
  const [isDateEditable, setIsDateEditable] = useState(false)
  const [isFabExpanded, setIsFabExpanded] = useState(false)
  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false)
  const [quickSaleData, setQuickSaleData] = useState(QUICK_SALE_DEFAULTS)
  const [quickToast, setQuickToast] = useState(null)
  // Live Home: auto-refetch on focus/visibility + a short poll so an accepted
  // request or a changed assignment status from an agent shows up on its own,
  // without a manual reload (Supabase realtime is not enabled on the logistics
  // tables, so we poll). Also re-reads the profile each tick for live name/phone.
  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(
    () => fetchTrainerAndSales(),
    { auto: true, intervalMs: 8000 },
  )

  const mgUnits = parseInt(customerFormData.mg_units) || 0
  const plUnits = parseInt(customerFormData.pl_units) || 0
  const previewRevenue =
    (customerFormData.mg_selected ? mgUnits * VARIANTS.multigrain.price : 0) +
    (customerFormData.pl_selected ? plUnits * VARIANTS.plain.price : 0)

  const quickMgUnits = parseInt(quickSaleData.mg_units) || 0
  const quickPlUnits = parseInt(quickSaleData.plain_units) || 0
  const quickTotal = quickMgUnits * VARIANTS.multigrain.price + quickPlUnits * VARIANTS.plain.price
  const quickPhone = quickSaleData.customer_phone.trim()
  const quickPhoneValid = !quickPhone || /^\d{10}$/.test(quickPhone)

  const closeQuickSale = () => {
    setIsQuickSaleOpen(false)
    setQuickSaleData(QUICK_SALE_DEFAULTS)
  }

  const validateCustomerForm = () => {
    const errors = {}
    if (customerFormData.buyer_name.trim().length < 2) {
      errors.buyer_name = 'Name must be at least 2 characters.'
    }
    const contact = customerFormData.buyer_contact.trim()
    if (contact && !/^\d{10}$/.test(contact)) {
      errors.buyer_contact = 'Enter a valid 10-digit number.'
    }
    if (!customerFormData.mg_selected && !customerFormData.pl_selected) {
      errors.variants = 'Please select at least one product variant.'
    }
    if (customerFormData.mg_selected && mgUnits < 1) {
      errors.mg_units = 'Enter Multigrain units (at least 1).'
    }
    if (customerFormData.pl_selected && plUnits < 1) {
      errors.pl_units = 'Enter Plain units (at least 1).'
    }
    return errors
  }

  const isCustomerFormValid =
    customerFormData.buyer_name.trim().length >= 2 &&
    (customerFormData.mg_selected || customerFormData.pl_selected) &&
    (!customerFormData.mg_selected || mgUnits >= 1) &&
    (!customerFormData.pl_selected || plUnits >= 1) &&
    (!customerFormData.buyer_contact.trim() || /^\d{10}$/.test(customerFormData.buyer_contact.trim()))

  useEffect(() => {
    fetchTrainerAndSales()
  }, [profile])

  const fetchTrainerAndSales = async () => {
    if (isDemo) {
      setTrainerId('demo-partner-id')
      setSales(demoPartnerSales())
      setAssignments([])
      setRequests([])
      initialLoadDoneRef.current = true
      setLoading(false)
      return
    }
    try {
      // Only the very first load shows the full-page spinner; background polls
      // refresh silently (the RefreshButton/status indicator covers those).
      if (!initialLoadDoneRef.current) setLoading(true)
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !profile) return

      // sales.trainer_id now points to profiles.id (partner id)
      setTrainerId(user.id)
      await fetchSales(user.id)
      await fetchPartnerOrders(user.id)
      // Keep the partner's own name/phone live too (Change 3 behaviour).
      await refreshProfile()
    } catch (error) {
      console.error('Error fetching trainer and sales:', error)
    } finally {
      initialLoadDoneRef.current = true
      setLoading(false)
    }
  }

  // Stock delivered to this partner (partner_assignments) + their open orders
  // (partner_requests). Agent deliveries write partner_assignments, not sales,
  // so available stock must include them.
  const fetchPartnerOrders = async (tid) => {
    try {
      const [asg, reqs] = await Promise.all([
        listMyAssignments(tid),
        listMyRequests(tid),
      ])
      setAssignments(asg)
      setRequests(reqs)
    } catch (error) {
      console.error('Error fetching partner orders:', error)
    }
  }

  const fetchSales = async (tid) => {
    try {
      const { data: salesData, error } = await supabase
        .from('sales')
        .select('*')
        .eq('trainer_id', tid)
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      setSales(salesData || [])
    } catch (error) {
      console.error('Error fetching sales:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveCustomer = async () => {
    if (isDemo) return demoBlock()

    const errors = validateCustomerForm()
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !profile) {
        alert('User session expired. Please refresh the page.')
        return
      }

      const currentTrainerId = trainerId || user.id
      setTrainerId(currentTrainerId)

      // Selected variants → one line item each (units + its own price). The
      // partner can pick Multigrain, Plain, or BOTH on a single entry.
      const lines = []
      if (customerFormData.mg_selected && mgUnits > 0) {
        lines.push({ variant: VARIANTS.multigrain, units: mgUnits })
      }
      if (customerFormData.pl_selected && plUnits > 0) {
        lines.push({ variant: VARIANTS.plain, units: plUnits })
      }
      if (lines.length === 0) return
      const totalRevenue = lines.reduce((s, l) => s + l.units * l.variant.price, 0)

      // Upload picture if provided (shared across the variant rows)
      let pictureUrl = null
      if (customerFormData.picture_file) {
        const fileExt = customerFormData.picture_file.name.split('.').pop()
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `customer-pictures/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('customer-pictures')
          .upload(filePath, customerFormData.picture_file)

        if (uploadError) {
          console.error('Error uploading picture:', uploadError)
          alert('Failed to upload picture. Please try again.')
          return
        }

        const { data: urlData } = supabase.storage
          .from('customer-pictures')
          .getPublicUrl(filePath)

        pictureUrl = urlData?.publicUrl
      }

      // Fields shared by every row (buyer + optional metadata).
      const basePayload = {
        buyer_name: customerFormData.buyer_name,
        buyer_contact: customerFormData.buyer_contact,
      }
      if (customerFormData.purchase_date) {
        basePayload.purchase_date = customerFormData.purchase_date
      }
      if (customerFormData.notes) {
        basePayload.customer_notes = customerFormData.notes
      }
      if (pictureUrl) {
        basePayload.picture_url = pictureUrl
      }

      if (editingSaleId) {
        // Editing is a single-row update — edit mode is single-variant (the
        // chips enforce one selection), so update that one sale row in place.
        const line = lines[0]
        const oldSale = sales.find(s => s.id === editingSaleId)

        const updatePayload = {
          ...basePayload,
          units_sold: line.units,
          product_variant: line.variant.name,
          unit_price: line.variant.price,
        }

        const { error } = await supabase
          .from('sales')
          .update(updatePayload)
          .eq('id', editingSaleId)

        if (error) {
          console.error('Update error:', error)
          throw error
        }

        // Audit log: sale updated
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'sale',
          entityId: editingSaleId,
          description: `Updated customer sale: ${customerFormData.buyer_name || 'Unknown'} | ${line.variant.name} | ${line.units} units | ₹${line.units * line.variant.price}`,
          oldValues: oldSale ? {
            buyer_name: oldSale.buyer_name,
            buyer_contact: oldSale.buyer_contact,
            units_sold: oldSale.units_sold,
            purchase_date: oldSale.purchase_date,
            customer_notes: oldSale.customer_notes,
          } : null,
          newValues: updatePayload,
        })
      } else {
        // Create new sale — one row per selected variant (mirrors Quick Sale),
        // so existing per-variant Sold/Left + revenue reporting stays correct.
        if (!currentTrainerId) {
          alert('Partner profile not found. Please contact admin.')
          return
        }

        const today = new Date().toISOString().split('T')[0]
        const rows = lines.map((l) => ({
          ...basePayload,
          trainer_id: currentTrainerId,
          units_sold: l.units,
          units_assigned: l.units,
          product_variant: l.variant.name,
          unit_price: l.variant.price,
          date_of_assignment: customerFormData.purchase_date || today,
        }))

        const { error, data } = await supabase
          .from('sales')
          .insert(rows)
          .select()

        if (error) {
          console.error('Insert error:', error)
          console.error('Trainer ID:', currentTrainerId)
          console.error('Profile:', profile)
          console.error('Payload:', rows)

          // Provide more helpful error message
          if (error.message && error.message.includes('customer_notes')) {
            throw new Error('Database schema missing required columns. Please contact admin to run the database migration script.')
          }
          if (error.code === '42501' || error.message.includes('permission') || error.message.includes('policy')) {
            throw new Error('Permission denied. Please ensure your partner profile is configured correctly. Contact admin if issue persists.')
          }
          throw error
        }

        // Audit log: sale created
        await logAuditEvent({
          actionType: 'CREATE',
          entityType: 'sale',
          entityId: data?.[0]?.id || null,
          description: `Created customer sale: ${customerFormData.buyer_name || 'Unknown'} | ${lines.map((l) => `${l.units}×${l.variant.short}`).join(' + ')} | ₹${totalRevenue}`,
          newValues: { rows },
        })
      }

      // Reset form and refresh
      setCustomerFormData(emptyCustomerForm())
      setEditingSaleId(null)
      setIsDateEditable(false)
      setIsCustomerModalOpen(false)
      await fetchSales(currentTrainerId)
    } catch (error) {
      console.error('Error saving customer:', error)
      alert(`Failed to save customer: ${error.message || 'Please try again.'}`)
    }
  }

  // Quick Sale: one insert per variant that has units > 0. No picture/contact;
  // customer name optional. Stock guard happens client-side from `summary`.
  const handleSaveQuickSale = async () => {
    if (isDemo) return demoBlock()
    if (quickMgUnits <= 0 && quickPlUnits <= 0) return
    if (quickMgUnits > summary.variants.multigrain.left) return
    if (quickPlUnits > summary.variants.plain.left) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !profile) {
        alert('User session expired. Please refresh the page.')
        return
      }
      const tid = trainerId || user.id
      setTrainerId(tid)

      const buyerName = quickSaleData.customer_name.trim() || null
      const buyerContact = quickSaleData.customer_phone.trim() || null
      const today = new Date().toISOString().split('T')[0]

      const rows = []
      if (quickMgUnits > 0) {
        rows.push({
          trainer_id: tid,
          buyer_name: buyerName,
          buyer_contact: buyerContact,
          units_sold: quickMgUnits,
          units_assigned: quickMgUnits,
          product_variant: VARIANTS.multigrain.name,
          unit_price: VARIANTS.multigrain.price,
          purchase_date: today,
          date_of_assignment: today,
        })
      }
      if (quickPlUnits > 0) {
        rows.push({
          trainer_id: tid,
          buyer_name: buyerName,
          buyer_contact: buyerContact,
          units_sold: quickPlUnits,
          units_assigned: quickPlUnits,
          product_variant: VARIANTS.plain.name,
          unit_price: VARIANTS.plain.price,
          purchase_date: today,
          date_of_assignment: today,
        })
      }

      const { data, error } = await supabase.from('sales').insert(rows).select()
      if (error) throw error

      await logAuditEvent({
        actionType: 'CREATE',
        entityType: 'sale',
        entityId: data?.[0]?.id || null,
        description: `Quick sale: ${buyerName || 'walk-in'} | ${quickMgUnits} MG + ${quickPlUnits} Plain | ₹${quickTotal}`,
        newValues: { rows },
      })

      closeQuickSale()
      setQuickToast(`Sale recorded: ₹${quickTotal.toLocaleString()}`)
      setTimeout(() => setQuickToast(null), 2500)
      await fetchSales(tid)
    } catch (error) {
      console.error('Error saving quick sale:', error)
      alert(`Failed to record sale: ${error.message || 'Please try again.'}`)
    }
  }

  const handleEditSale = (sale) => {
    setEditingSaleId(sale.id)
    const variantKey =
      sale.product_variant && VARIANTS[sale.product_variant]
        ? sale.product_variant
        : Object.keys(VARIANTS).find((k) => VARIANTS[k].name === sale.product_variant) || ''
    const units = sale.units_sold?.toString() || ''
    setCustomerFormData({
      ...emptyCustomerForm(),
      buyer_name: sale.buyer_name || '',
      buyer_contact: sale.buyer_contact || '',
      mg_selected: variantKey === 'multigrain',
      pl_selected: variantKey === 'plain',
      mg_units: variantKey === 'multigrain' ? units : '',
      pl_units: variantKey === 'plain' ? units : '',
      purchase_date: sale.purchase_date || new Date().toISOString().split('T')[0],
      notes: sale.customer_notes || '',
    })
    setFormErrors({})
    setIsDateEditable(false)
    setIsCustomerModalOpen(true)
  }

  const handleDeleteSale = async () => {
    if (isDemo) return demoBlock()
    if (!editingSaleId) return

    if (!confirm('Are you sure you want to delete this customer sale? This action cannot be undone.')) {
      return
    }

    try {
      // Get sale data before deletion for audit
      const deletedSale = sales.find(s => s.id === editingSaleId)

      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('id', editingSaleId)

      if (error) {
        console.error('Delete error:', error)
        throw error
      }

      // Audit log: sale deleted
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'sale',
        entityId: editingSaleId,
        description: `Deleted customer sale: ${deletedSale?.buyer_name || 'Unknown'} | ${deletedSale?.units_sold || 0} units`,
        oldValues: deletedSale ? {
          buyer_name: deletedSale.buyer_name,
          buyer_contact: deletedSale.buyer_contact,
          units_sold: deletedSale.units_sold,
          purchase_date: deletedSale.purchase_date,
          customer_notes: deletedSale.customer_notes,
        } : null,
      })

      // Reset form and close modal
      setCustomerFormData(emptyCustomerForm())
      setEditingSaleId(null)
      setIsDateEditable(false)
      setIsCustomerModalOpen(false)

      // Refresh sales list
      if (trainerId) {
        await fetchSales(trainerId)
      }
    } catch (error) {
      console.error('Error deleting sale:', error)
      alert(`Failed to delete customer sale: ${error.message || 'Please try again.'}`)
    }
  }

  const handleShowQR = (sale) => {
    if (sale.qr_code_url) {
      setQrImageUrl(sale.qr_code_url)
      setIsQRModalOpen(true)
    } else {
      alert('QR code not available for this sale')
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB')
        return
      }
      setCustomerFormData({ ...customerFormData, picture_file: file })
    }
  }

  const isSaleComplete = (sale) => {
    return sale.picture_url && sale.units_sold > 0
  }

  const summary = useMemo(() => {
    const variants = {
      multigrain: { assigned: 0, sold: 0, revenue: 0 },
      plain: { assigned: 0, sold: 0, revenue: 0 },
    }
    let totalUnits = 0
    let totalRevenue = 0

    for (const sale of sales) {
      const units = sale.units_sold || 0
      totalUnits += units
      totalRevenue += saleRevenue(sale)

      variants.multigrain.assigned += sale.multigrain_assigned || 0
      variants.plain.assigned += sale.plain_assigned || 0

      const v = variantFromSale(sale)
      const bucket = v?.name === VARIANTS.plain.name ? variants.plain : variants.multigrain
      bucket.sold += units
      bucket.revenue += saleRevenue(sale)
    }

    // Stock delivered to this partner through the agent/admin workflow
    // (partner_assignments: agent delivery, proactive assign, or an accepted
    // request) is credited PER VARIANT here too — so the Multi-Grain/Plain
    // Assigned & Left cards (and day-cards below) reflect it, exactly like the
    // big "Available Units" number already does. This never writes to sales, so
    // the admin Overview ASSIGNED KPI is left untouched (by design).
    for (const a of assignments) {
      if (a.status !== 'pending' && a.status !== 'confirmed') continue
      const bucket = a.variant === 'plain' ? variants.plain : variants.multigrain
      bucket.assigned += a.units || 0
    }

    variants.multigrain.left = Math.max(0, variants.multigrain.assigned - variants.multigrain.sold)
    variants.plain.left = Math.max(0, variants.plain.assigned - variants.plain.sold)

    const completedSales = sales.filter((sale) => isSaleComplete(sale)).length

    // Per-variant shelf-life tracking. We assume FIFO selling, so the oldest
    // assignment date with stock still on the shelf is the batch most at risk.
    const assignDateOf = (sale) =>
      sale.date_of_assignment || sale.purchase_date || (sale.created_at ? sale.created_at.slice(0, 10) : null)

    const oldestAssignDate = { multigrain: null, plain: null }
    const noteOldest = (key, d) => {
      if (!d) return
      if (!oldestAssignDate[key] || d < oldestAssignDate[key]) oldestAssignDate[key] = d
    }
    for (const sale of sales) {
      const d = assignDateOf(sale)
      if (!d) continue
      if ((sale.multigrain_assigned || 0) > 0) noteOldest('multigrain', d)
      if ((sale.plain_assigned || 0) > 0) noteOldest('plain', d)
    }
    // Workflow deliveries count toward the at-risk oldest batch too.
    for (const a of assignments) {
      if (a.status !== 'pending' && a.status !== 'confirmed') continue
      if ((a.units || 0) <= 0) continue
      const d = (a.confirmed_at || a.assigned_at || a.created_at || '')?.slice(0, 10) || null
      noteOldest(a.variant === 'plain' ? 'plain' : 'multigrain', d)
    }

    const now = new Date()
    const shelfFor = (key) => {
      const left = variants[key].left
      const date = oldestAssignDate[key]
      if (left <= 0 || !date) return null
      const status = getAssignmentStatus(key, date, now)
      return {
        date,
        left,
        total: SHELF_LIFE[key].days,
        day: shelfDay(key, date, now),
        daysLeft: shelfDaysLeft(key, date, now),
        pctUsed: shelfPercentUsed(key, date, now),
        status,
        // Units at risk = remaining stock once the oldest batch hits its last
        // day or has already expired.
        expiringUnits: status === 'expired' || isLastDay(key, date, now) ? left : 0,
      }
    }

    return {
      totalUnits,
      totalRevenue,
      completedSales,
      variants,
      shelf: { multigrain: shelfFor('multigrain'), plain: shelfFor('plain') },
    }
  }, [sales, assignments])

  // Caps for the Add/Edit Customer wheels: the partner can't sell more than is
  // available for that variant. In edit mode the sale being edited already
  // counts as "sold" (so it's excluded from .left); add its own units back so
  // the wheel can still show — and not clamp down — the value being edited.
  const editingSale = editingSaleId ? sales.find((s) => s.id === editingSaleId) : null
  const editVariantKey = editingSale
    ? editingSale.product_variant && VARIANTS[editingSale.product_variant]
      ? editingSale.product_variant
      : Object.keys(VARIANTS).find((k) => VARIANTS[k].name === editingSale.product_variant) || ''
    : ''
  const editUnits = editingSale ? editingSale.units_sold || 0 : 0
  const mgLeft = summary.variants.multigrain.left + (editVariantKey === 'multigrain' ? editUnits : 0)
  const plLeft = summary.variants.plain.left + (editVariantKey === 'plain' ? editUnits : 0)

  // Available = everything delivered to the partner minus everything sold.
  // summary.variants[*].assigned already folds in both delivery sources — the
  // legacy sales *_assigned rows AND partner_assignments (agent delivery /
  // proactive assign / accepted request) — so we derive the headline number
  // straight from the per-variant cards. This keeps the big number and the
  // cards in lock-step (no double counting).
  const availableUnits = useMemo(
    () =>
      Math.max(
        0,
        summary.variants.multigrain.left + summary.variants.plain.left,
      ),
    [summary],
  )

  // Active/open orders = the partner's requests not yet fully delivered
  // (displayStatus is 'pending' | 'accepted' | 'delivered').
  const activeOrders = useMemo(
    () => requests.filter((r) => r.displayStatus !== 'delivered').length,
    [requests],
  )

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <>
      <div className="dashboard-page pb-24 sm:pb-8">
        <div className="relative z-10 mb-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="dashboard-kicker">Partner</span>
              <h1 className="dashboard-title mt-2">Sales</h1>
            </div>
            <RefreshButton onRefresh={refresh} loading={refreshing} />
          </div>
          <div className="dashboard-panel flex items-center justify-between gap-4 rounded-2xl px-4 py-3 xl:max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Done</p>
            <p className="text-sm font-semibold text-slate-300">
              {summary.completedSales > 0
                ? `${summary.completedSales} done`
                : 'None yet'}
            </p>
          </div>
        </div>

        {/* Headline figures — what the partner most needs at a glance */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div
            className="rounded-2xl border p-5 shadow-sm"
            style={{ backgroundColor: '#024628', borderColor: '#024628' }}
          >
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: '#FBF3D4' }}
            >
              Available Units
            </p>
            <p
              className="mt-1 font-display text-5xl font-extrabold leading-none sm:text-6xl"
              style={{ color: '#FBF3D4' }}
            >
              {availableUnits.toLocaleString()}
            </p>
            <p className="mt-2 text-xs" style={{ color: 'rgba(251,243,212,0.75)' }}>
              to sell right now
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Active Orders
            </p>
            <p className="mt-1 font-display text-5xl font-extrabold leading-none text-slate-100 sm:text-6xl">
              {activeOrders.toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-slate-400">open right now</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
          {/* Per-variant stock cards */}
          <div className="dashboard-panel rounded-xl p-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#024628' }} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Multi-Grain</p>
            </div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Assigned</span>
                <span className="font-semibold text-slate-100">{summary.variants.multigrain.assigned.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Sold</span>
                <span className="font-semibold text-emerald-300">{summary.variants.multigrain.sold.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Left</span>
                <span className="font-semibold text-slate-100">{summary.variants.multigrain.left.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="dashboard-panel rounded-xl p-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#FBF3D4' }} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">Plain</p>
            </div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Assigned</span>
                <span className="font-semibold text-slate-100">{summary.variants.plain.assigned.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Sold</span>
                <span className="font-semibold text-emerald-300">{summary.variants.plain.sold.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Left</span>
                <span className="font-semibold text-slate-100">{summary.variants.plain.left.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <KPICard
            title="Total Sold"
            value={summary.totalUnits.toLocaleString()}
            subtitle="Units"
            color="emerald"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 13l4 4L19 7" />
              </svg>
            }
          />
          <KPICard
            title="Revenue"
            value={`₹${summary.totalRevenue.toLocaleString()}`}
            subtitle="By variant"
            color="purple"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2m7-4a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        {/* Shelf-life day tracking — oldest open stock per variant */}
        {(summary.shelf.multigrain || summary.shelf.plain) && (
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { key: 'multigrain', label: 'Multi-Grain', dot: '#024628', info: summary.shelf.multigrain },
              { key: 'plain',      label: 'Plain',       dot: '#FBF3D4', info: summary.shelf.plain },
            ].filter((v) => v.info).map((v) => {
              const { info } = v
              const barColor =
                info.status === 'active' ? 'bg-emerald-400'
                : info.status === 'expiring_soon' ? 'bg-amber-400'
                : 'bg-rose-400'
              const dayColor =
                info.status === 'active' ? 'text-emerald-600'
                : info.status === 'expiring_soon' ? 'text-amber-600'
                : 'text-rose-600'
              return (
                <div key={v.key} className="dashboard-panel rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v.dot }} />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{v.label} stock</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">
                      {info.status === 'expired' ? 'Shelf life over' : `${info.daysLeft} day${info.daysLeft !== 1 ? 's' : ''} left`}
                    </span>
                  </div>

                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div>
                      <span className={`text-2xl font-extrabold leading-none ${dayColor}`}>Day {info.day}</span>
                      <span className="ml-1 text-sm font-semibold text-slate-500">of {info.total}</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-100">{info.left} left</span>
                  </div>

                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      <span>Shelf used</span>
                      <span>{Math.round(info.pctUsed)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F0EBE3]">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${info.pctUsed}%` }} />
                    </div>
                  </div>

                  {info.expiringUnits > 0 && (
                    <div className="mt-2 rounded-[10px] border border-[#DC2626]/40 bg-[#DC2626]/10 px-2.5 py-1.5 text-xs font-semibold text-[#b91c1c]">
                      ⚠️ {info.expiringUnits} {v.label} unit{info.expiringUnits !== 1 ? 's' : ''} expiring today — sell or return
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Sales History Table */}
        <div className="dashboard-panel overflow-hidden rounded-[32px]">
          <div className="border-b border-[#E8E0D4] px-4 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">List</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-slate-100">Sales</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="dashboard-table w-full">
              <thead>
                <tr className="border-b border-[#E8E0D4]">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Customer
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Contact
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Product
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Units
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Revenue
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Date
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E0D4]">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 sm:px-6 py-8 text-center text-slate-400">
                      No sales records found. Tap the + button to add a customer or record a quick sale.
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => {
                    const complete = isSaleComplete(sale)
                    const revenue = saleRevenue(sale)
                    const variant = variantFromSale(sale)
                    return (
                      <tr
                        key={sale.id}
                        className={`${complete ? 'bg-emerald-400/4' : 'bg-rose-400/4'}`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm sm:text-base font-medium text-slate-100">
                            {sale.buyer_name || 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-xs sm:text-sm text-slate-300 break-all">
                            {sale.buyer_contact || 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs sm:text-sm text-slate-200">
                            {variant?.name || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm sm:text-base text-slate-100 font-medium">
                            {sale.units_sold || 0}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm sm:text-base font-mono text-emerald-400 font-semibold">
                            ₹{revenue.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-xs sm:text-sm text-slate-300">
                            {sale.purchase_date
                              ? formatDateDDMMYY(sale.purchase_date)
                              : sale.created_at
                                ? formatDateDDMMYY(sale.created_at)
                                : 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex flex-col sm:flex-row gap-2">
                            {sale.qr_code_url && (
                              <button
                                onClick={() => handleShowQR(sale)}
                                className="inline-flex items-center justify-center rounded-full border border-indigo-300/18 bg-indigo-400/12 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-400/18 sm:text-sm"
                              >
                                QR
                              </button>
                            )}
                            <button
                              onClick={() => handleEditSale(sale)}
                              className="inline-flex items-center justify-center rounded-full border border-[#E8E0D4] bg-[#ECE5DA] px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-[#ECE5DA] sm:text-sm"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
      </div>

      {/* Expandable FAB: tap to reveal "New Customer" + "Quick Sale" */}
      {isFabExpanded && (
        <button
          type="button"
          aria-label="Close action menu"
          onClick={() => setIsFabExpanded(false)}
          className="fixed inset-0 z-30 cursor-default bg-[rgba(2,70,40,0.3)] backdrop-blur-[2px]"
        />
      )}
      <div className="fixed bottom-[68px] right-4 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6">
        {isFabExpanded && (
          <>
            <button
              onClick={() => {
                setIsFabExpanded(false)
                setEditingSaleId(null)
                setCustomerFormData(emptyCustomerForm())
                setFormErrors({})
                setIsDateEditable(false)
                setIsCustomerModalOpen(true)
              }}
              className="flex animate-[fab-rise_180ms_ease-out] items-center gap-2 rounded-full border border-[#013a21] bg-[#024628] py-2 pl-3 pr-4 text-sm font-semibold text-[#fbf3d4] shadow-lg ring-1 ring-black/20 transition hover:bg-[#035c36]"
            >
              <UserPlus size={16} className="text-emerald-300" />
              New Customer
            </button>
            <button
              onClick={() => {
                setIsFabExpanded(false)
                setQuickSaleData(QUICK_SALE_DEFAULTS)
                setIsQuickSaleOpen(true)
              }}
              className="flex animate-[fab-rise_220ms_ease-out] items-center gap-2 rounded-full border border-[#013a21] bg-[#024628] py-2 pl-3 pr-4 text-sm font-semibold text-[#fbf3d4] shadow-lg ring-1 ring-black/20 transition hover:bg-[#035c36]"
            >
              <ShoppingCart size={16} className="text-amber-200" />
              Quick Sale
            </button>
          </>
        )}
        <button
          onClick={() => setIsFabExpanded((v) => !v)}
          className="dashboard-fab flex items-center justify-center rounded-full text-[#fbf3d4] transition-all hover:-translate-y-0.5"
          aria-label={isFabExpanded ? 'Close action menu' : 'Open action menu'}
          aria-expanded={isFabExpanded}
        >
          {isFabExpanded ? <X size={22} /> : <Plus size={22} />}
        </button>
      </div>

      {/* Quick Sale success toast */}
      {quickToast && (
        <div className="fixed bottom-[140px] right-4 z-50 rounded-lg bg-emerald-500/95 px-4 py-2.5 text-sm font-semibold text-[#fbf3d4] shadow-lg lg:bottom-24">
          {quickToast}
        </div>
      )}

      {/* Customer Onboarding Modal */}
      <Modal
        isOpen={isCustomerModalOpen}
        onClose={() => {
          setIsCustomerModalOpen(false)
          setEditingSaleId(null)
          setCustomerFormData(emptyCustomerForm())
          setFormErrors({})
          setIsDateEditable(false)
        }}
        title={editingSaleId ? 'Edit Customer Sale' : 'Add New Customer'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveCustomer()
          }}
          className="space-y-4"
        >
          <FormField
            label="Customer Name"
            value={customerFormData.buyer_name}
            onChange={(value) => setCustomerFormData({ ...customerFormData, buyer_name: value })}
            placeholder="Enter customer name"
            required
            error={formErrors.buyer_name}
          />

          <FormField
            label="Customer Number"
            type="tel"
            value={customerFormData.buyer_contact}
            onChange={(value) => setCustomerFormData({ ...customerFormData, buyer_contact: value })}
            placeholder="Enter customer phone number (optional)"
            error={formErrors.buyer_contact}
          />

          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Product Variant <span className="text-rose-300">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'multigrain', sel: 'mg_selected' },
                { key: 'plain', sel: 'pl_selected' },
              ].map(({ key, sel }) => {
                const variant = VARIANTS[key]
                const active = customerFormData[sel]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setCustomerFormData((prev) =>
                        editingSaleId
                          ? {
                              ...prev,
                              mg_selected: key === 'multigrain',
                              pl_selected: key === 'plain',
                            }
                          : { ...prev, [sel]: !prev[sel] },
                      )
                    }
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? 'border-[#024628] bg-[#024628] text-[#fbf3d4] shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-[#024628]'
                    }`}
                  >
                    <div className="text-sm font-semibold">{variant.short}</div>
                    <div className={`text-xs ${active ? 'text-[#fbf3d4]/80' : 'text-slate-500'}`}>
                      ₹{variant.price}/unit
                    </div>
                  </button>
                )
              })}
            </div>
            {formErrors.variants && (
              <p className="mt-1.5 text-xs text-rose-400">{formErrors.variants}</p>
            )}
          </div>

          {customerFormData.mg_selected && (
            <div className="mb-4">
              <UnitWheel
                label="Multigrain units"
                value={mgUnits}
                max={mgLeft}
                onChange={(n) => setCustomerFormData({ ...customerFormData, mg_units: n })}
                hint={`Avail: ${mgLeft}`}
              />
              {formErrors.mg_units && (
                <p className="mt-1.5 text-xs text-rose-400">{formErrors.mg_units}</p>
              )}
            </div>
          )}

          {customerFormData.pl_selected && (
            <div className="mb-4">
              <UnitWheel
                label="Plain units"
                value={plUnits}
                max={plLeft}
                onChange={(n) => setCustomerFormData({ ...customerFormData, pl_units: n })}
                hint={`Avail: ${plLeft}`}
              />
              {formErrors.pl_units && (
                <p className="mt-1.5 text-xs text-rose-400">{formErrors.pl_units}</p>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Revenue
            </label>
            <div className="dashboard-input flex items-center text-lg font-semibold text-slate-400 cursor-not-allowed opacity-70">
              ₹{previewRevenue.toLocaleString()}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {customerFormData.mg_selected || customerFormData.pl_selected
                ? [
                    customerFormData.mg_selected
                      ? `${mgUnits} × ₹${VARIANTS.multigrain.price}`
                      : null,
                    customerFormData.pl_selected
                      ? `${plUnits} × ₹${VARIANTS.plain.price}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') + ' (auto-calculated)'
                : 'Select a variant and units to calculate revenue'}
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Purchase Date
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customerFormData.purchase_date}
                onChange={(e) => setCustomerFormData({ ...customerFormData, purchase_date: e.target.value })}
                disabled={!isDateEditable}
                className="dashboard-input flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setIsDateEditable(!isDateEditable)}
                className="dashboard-button dashboard-button-secondary px-3 py-2 text-sm"
              >
                {isDateEditable ? 'Lock' : 'Edit'}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Upload Picture
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="dashboard-input w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-indigo-400/14 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-200"
            />
            {customerFormData.picture_file && (
              <p className="mt-2 text-xs text-slate-400">
                Selected: {customerFormData.picture_file.name}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Show QR
            </label>
            <button
              type="button"
              onClick={() => {
                // For now, just show a placeholder. In production, generate QR code
                alert('QR code generation feature coming soon')
              }}
              className="dashboard-button dashboard-button-secondary w-full"
            >
              Show QR Code
            </button>
          </div>

          <FormField
            label="Notes"
            type="textarea"
            value={customerFormData.notes}
            onChange={(value) => setCustomerFormData({ ...customerFormData, notes: value })}
            placeholder="Add any notes about this customer..."
          />

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {editingSaleId && (
              <button
                type="button"
                onClick={handleDeleteSale}
                className="dashboard-button flex-1 border border-rose-300/18 bg-rose-400/12 text-rose-100"
              >
                Delete
              </button>
            )}
            <button
              type="submit"
              disabled={!isCustomerFormValid}
              className={`dashboard-button dashboard-button-primary disabled:cursor-not-allowed disabled:opacity-50 ${editingSaleId ? 'flex-1' : 'w-full'}`}
            >
              {editingSaleId ? 'Done' : 'Save Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Quick Sale Modal */}
      <Modal isOpen={isQuickSaleOpen} onClose={closeQuickSale} title="Quick Sale">
        {(() => {
          const mgLeft = summary.variants.multigrain.left
          const plLeft = summary.variants.plain.left
          const mgOver = quickMgUnits > mgLeft
          const plOver = quickPlUnits > plLeft
          const valid = (quickMgUnits > 0 || quickPlUnits > 0) && !mgOver && !plOver && quickPhoneValid

          return (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSaveQuickSale()
              }}
              className="space-y-4"
            >
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Your Stock
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="dashboard-panel rounded-xl p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#024628' }} />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                        Multi-Grain
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      ₹149 · Avail: <span className="font-semibold text-slate-100">{mgLeft}</span>
                    </p>
                    <div className="mt-3">
                      <UnitWheel
                        value={quickMgUnits}
                        max={mgLeft}
                        onChange={(n) => setQuickSaleData({ ...quickSaleData, mg_units: n })}
                      />
                    </div>
                  </div>
                  <div className="dashboard-panel rounded-xl p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#FBF3D4' }} />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">Plain</p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      ₹109 · Avail: <span className="font-semibold text-slate-100">{plLeft}</span>
                    </p>
                    <div className="mt-3">
                      <UnitWheel
                        value={quickPlUnits}
                        max={plLeft}
                        onChange={(n) => setQuickSaleData({ ...quickSaleData, plain_units: n })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <FormField
                label="Customer Name"
                value={quickSaleData.customer_name}
                onChange={(value) => setQuickSaleData({ ...quickSaleData, customer_name: value })}
                placeholder="Optional"
              />

              <FormField
                label="Customer Phone"
                value={quickSaleData.customer_phone}
                onChange={(value) =>
                  setQuickSaleData({ ...quickSaleData, customer_phone: value.replace(/\D/g, '').slice(0, 10) })
                }
                placeholder="Optional"
                error={!quickPhoneValid ? 'Enter a valid 10-digit number.' : undefined}
              />

              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-emerald-200">Total</span>
                  <span className="font-mono text-base font-semibold text-emerald-100">
                    ₹{quickTotal.toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  ({quickMgUnits || 0} × ₹149) + ({quickPlUnits || 0} × ₹109) — auto-calculated
                </p>
              </div>

              <button
                type="submit"
                disabled={!valid}
                className="dashboard-button dashboard-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit Sale
              </button>
            </form>
          )
        })()}
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={isQRModalOpen}
        onClose={() => {
          setIsQRModalOpen(false)
          setQrImageUrl(null)
        }}
        title="QR Code"
      >
        {qrImageUrl && (
          <div className="flex justify-center">
            <img src={qrImageUrl} alt="QR Code" className="max-w-full h-auto rounded-lg" />
          </div>
        )}
      </Modal>
    </>
  )
}

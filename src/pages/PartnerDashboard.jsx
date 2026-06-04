import { useEffect, useMemo, useState } from 'react'
import { Plus, X, UserPlus, ShoppingCart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import KPICard from '../components/KPICard'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'
import { demoBlock, demoPartnerSales } from '../lib/demoData'

const QUICK_SALE_DEFAULTS = { mg_units: 0, plain_units: 0, customer_name: '', customer_phone: '' }

// Mobile-friendly stepper for the Quick Sale unit counts. The buttons are the
// only way to change the value, so a partner can never enter more than the
// available stock. When nothing is available the control is disabled.
function QuantityStepper({ value, available, onChange }) {
  if (available <= 0) {
    return <p className="py-2 text-center text-sm font-medium text-slate-500">0 available</p>
  }
  const atMin = value <= 0
  const atMax = value >= available
  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full border text-2xl leading-none text-slate-200 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30'
  const btnEnabled = 'border-slate-700 hover:border-emerald-500 hover:bg-emerald-500/10'
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={atMin}
        className={`${btn} ${atMin ? 'border-slate-800' : btnEnabled}`}
      >
        −
      </button>
      <span
        className={`min-w-[2ch] text-center text-[28px] font-bold tabular-nums ${
          value > 0 ? 'text-emerald-400' : 'text-slate-500'
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(available, value + 1))}
        disabled={atMax}
        className={`${btn} ${atMax ? 'border-slate-800' : btnEnabled}`}
      >
        +
      </button>
    </div>
  )
}

const VARIANTS = {
  multigrain: { name: 'Multi-Grain High Protein Bread', price: 149 },
  plain: { name: 'Plain High Protein Bread', price: 109 },
}

const VARIANT_OPTIONS = [
  { value: 'multigrain', label: 'Multi-Grain High Protein Bread — ₹149' },
  { value: 'plain', label: 'Plain High Protein Bread — ₹109' },
]

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
  const { profile, isDemo } = useAuth()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState([])
  const [trainerId, setTrainerId] = useState(null)
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false)
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState(null)
  const [editingSaleId, setEditingSaleId] = useState(null)
  const [customerFormData, setCustomerFormData] = useState({
    buyer_name: '',
    buyer_contact: '',
    product_variant: '',
    units_purchased: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: '',
    picture_file: null,
  })
  const [formErrors, setFormErrors] = useState({})
  const [isDateEditable, setIsDateEditable] = useState(false)
  const [isFabExpanded, setIsFabExpanded] = useState(false)
  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false)
  const [quickSaleData, setQuickSaleData] = useState(QUICK_SALE_DEFAULTS)
  const [quickToast, setQuickToast] = useState(null)
  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchTrainerAndSales())

  const selectedVariant = VARIANTS[customerFormData.product_variant] || null
  const previewUnits = parseInt(customerFormData.units_purchased) || 0
  const previewRevenue = selectedVariant ? selectedVariant.price * previewUnits : 0

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
    if (!customerFormData.product_variant) {
      errors.product_variant = 'Please select a product variant.'
    }
    if (previewUnits < 1) {
      errors.units_purchased = 'Units must be at least 1.'
    }
    return errors
  }

  const isCustomerFormValid =
    customerFormData.buyer_name.trim().length >= 2 &&
    !!customerFormData.product_variant &&
    previewUnits >= 1 &&
    (!customerFormData.buyer_contact.trim() || /^\d{10}$/.test(customerFormData.buyer_contact.trim()))

  useEffect(() => {
    fetchTrainerAndSales()
  }, [profile])

  const fetchTrainerAndSales = async () => {
    if (isDemo) {
      setTrainerId('demo-partner-id')
      setSales(demoPartnerSales())
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !profile) return

      // sales.trainer_id now points to profiles.id (partner id)
      setTrainerId(user.id)
      await fetchSales(user.id)
    } catch (error) {
      console.error('Error fetching trainer and sales:', error)
      setLoading(false)
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

      const unitsPurchased = parseInt(customerFormData.units_purchased) || 0
      const variant = VARIANTS[customerFormData.product_variant]
      const unitPrice = variant?.price || 0
      const revenue = unitPrice * unitsPurchased

      // Upload picture if provided
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

      // Prepare update/insert payload - only include fields that exist
      const salePayload = {
        buyer_name: customerFormData.buyer_name,
        buyer_contact: customerFormData.buyer_contact,
        units_sold: unitsPurchased,
        product_variant: variant?.name || null,
        unit_price: unitPrice,
      }

      // Add optional fields if they have values
      if (customerFormData.purchase_date) {
        salePayload.purchase_date = customerFormData.purchase_date
      }
      if (customerFormData.notes) {
        salePayload.customer_notes = customerFormData.notes
      }
      if (pictureUrl) {
        salePayload.picture_url = pictureUrl
      }

      if (editingSaleId) {
        // Get old values for audit
        const oldSale = sales.find(s => s.id === editingSaleId)

        // Update existing sale
        const { error } = await supabase
          .from('sales')
          .update(salePayload)
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
          description: `Updated customer sale: ${customerFormData.buyer_name || 'Unknown'} | ${variant?.name || 'N/A'} | ${unitsPurchased} units | ₹${revenue}`,
          oldValues: oldSale ? {
            buyer_name: oldSale.buyer_name,
            buyer_contact: oldSale.buyer_contact,
            units_sold: oldSale.units_sold,
            purchase_date: oldSale.purchase_date,
            customer_notes: oldSale.customer_notes,
          } : null,
          newValues: salePayload,
        })
      } else {
        // Create new sale
        if (!currentTrainerId) {
          alert('Partner profile not found. Please contact admin.')
          return
        }

        const insertPayload = {
          ...salePayload,
          trainer_id: currentTrainerId,
          units_assigned: unitsPurchased,
          date_of_assignment: customerFormData.purchase_date || new Date().toISOString().split('T')[0],
        }

        const { error, data } = await supabase
          .from('sales')
          .insert(insertPayload)
          .select()

        if (error) {
          console.error('Insert error:', error)
          console.error('Trainer ID:', currentTrainerId)
          console.error('Profile:', profile)
          console.error('Payload:', insertPayload)

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
          description: `Created customer sale: ${customerFormData.buyer_name || 'Unknown'} | ${variant?.name || 'N/A'} | ${unitsPurchased} units | ₹${revenue}`,
          newValues: insertPayload,
        })
      }

      // Reset form and refresh
      setCustomerFormData({
        buyer_name: '',
        buyer_contact: '',
        product_variant: '',
        units_purchased: '',
        purchase_date: new Date().toISOString().split('T')[0],
        notes: '',
        picture_file: null,
      })
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
    setCustomerFormData({
      buyer_name: sale.buyer_name || '',
      buyer_contact: sale.buyer_contact || '',
      product_variant: variantKey,
      units_purchased: sale.units_sold?.toString() || '',
      purchase_date: sale.purchase_date || new Date().toISOString().split('T')[0],
      notes: sale.customer_notes || '',
      picture_file: null,
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
      setCustomerFormData({
        buyer_name: '',
        buyer_contact: '',
        product_variant: '',
        units_purchased: '',
        purchase_date: new Date().toISOString().split('T')[0],
        notes: '',
        picture_file: null,
      })
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

    variants.multigrain.left = Math.max(0, variants.multigrain.assigned - variants.multigrain.sold)
    variants.plain.left = Math.max(0, variants.plain.assigned - variants.plain.sold)

    const completedSales = sales.filter((sale) => isSaleComplete(sale)).length

    return {
      totalUnits,
      totalRevenue,
      completedSales,
      variants,
    }
  }, [sales])

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
                                className="inline-flex items-center justify-center rounded-full border border-indigo-300/18 bg-indigo-400/12 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-400/18 sm:text-sm"
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
                setCustomerFormData({
                  buyer_name: '',
                  buyer_contact: '',
                  product_variant: '',
                  units_purchased: '',
                  purchase_date: new Date().toISOString().split('T')[0],
                  notes: '',
                  picture_file: null,
                })
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
          setCustomerFormData({
            buyer_name: '',
            buyer_contact: '',
            product_variant: '',
            units_purchased: '',
            purchase_date: new Date().toISOString().split('T')[0],
            notes: '',
            picture_file: null,
          })
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

          <FormField
            label="Product Variant"
            type="select"
            value={customerFormData.product_variant}
            onChange={(value) => setCustomerFormData({ ...customerFormData, product_variant: value })}
            options={VARIANT_OPTIONS}
            required
            error={formErrors.product_variant}
          />

          <FormField
            label="Units Purchased"
            type="number"
            value={customerFormData.units_purchased}
            onChange={(value) => setCustomerFormData({ ...customerFormData, units_purchased: value })}
            placeholder="Enter units purchased"
            required
            minLength={1}
            error={formErrors.units_purchased}
          />

          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Revenue
            </label>
            <div className="dashboard-input flex items-center text-lg font-semibold text-slate-400 cursor-not-allowed opacity-70">
              ₹{previewRevenue.toLocaleString()}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {selectedVariant
                ? `${previewUnits || 0} × ₹${selectedVariant.price} (auto-calculated)`
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
              className="dashboard-input w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-indigo-400/14 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-100"
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
                      <QuantityStepper
                        value={quickMgUnits}
                        available={mgLeft}
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
                      <QuantityStepper
                        value={quickPlUnits}
                        available={plLeft}
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

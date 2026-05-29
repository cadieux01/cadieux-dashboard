import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import KPICard from '../components/KPICard'
import { logAuditEvent } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'

const UNIT_PRICE = 100

export default function PartnerDashboard() {
  const { profile } = useAuth()
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
    units_purchased: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: '',
    picture_file: null,
  })
  const [isDateEditable, setIsDateEditable] = useState(false)

  useEffect(() => {
    fetchTrainerAndSales()
  }, [profile])

  const fetchTrainerAndSales = async () => {
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
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !profile) {
        alert('User session expired. Please refresh the page.')
        return
      }

      const currentTrainerId = trainerId || user.id
      setTrainerId(currentTrainerId)

      const unitsPurchased = parseInt(customerFormData.units_purchased) || 0
      if (unitsPurchased <= 0) {
        alert('Please enter valid units purchased')
        return
      }

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
          description: `Updated customer sale: ${customerFormData.buyer_name || 'Unknown'} | Changed to: ${unitsPurchased} units sold`,
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
          description: `Created customer sale: ${customerFormData.buyer_name || 'Unknown'} | ${unitsPurchased} units`,
          newValues: insertPayload,
        })
      }

      // Reset form and refresh
      setCustomerFormData({
        buyer_name: '',
        buyer_contact: '',
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

  const handleEditSale = (sale) => {
    setEditingSaleId(sale.id)
    setCustomerFormData({
      buyer_name: sale.buyer_name || '',
      buyer_contact: sale.buyer_contact || '',
      units_purchased: sale.units_sold?.toString() || '',
      purchase_date: sale.purchase_date || new Date().toISOString().split('T')[0],
      notes: sale.customer_notes || '',
      picture_file: null,
    })
    setIsDateEditable(false)
    setIsCustomerModalOpen(true)
  }

  const handleDeleteSale = async () => {
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
    const totalUnits = sales.reduce((sum, sale) => sum + (sale.units_sold || 0), 0)
    const totalRevenue = totalUnits * UNIT_PRICE
    const completedSales = sales.filter((sale) => isSaleComplete(sale)).length

    return {
      totalUnits,
      totalRevenue,
      completedSales,
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
        <div className="relative z-10 mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <span className="dashboard-kicker">Partner</span>
            <h1 className="dashboard-title mt-4">Sales</h1>
          </div>
          <div className="dashboard-panel rounded-[32px] p-5 sm:p-6 xl:max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Done</p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {summary.completedSales > 0
                ? `${summary.completedSales} done.`
                : 'None yet.'}
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard
            title="Customers"
            value={sales.length.toLocaleString()}
            subtitle="Entries"
            color="indigo"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <KPICard
            title="Sold"
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
            subtitle="₹100/unit"
            color="purple"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2m7-4a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <KPICard
            title="Done"
            value={summary.completedSales.toLocaleString()}
            subtitle="With proof"
            color="amber"
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        {/* Sales History Table */}
        <div className="dashboard-panel overflow-hidden rounded-[32px]">
          <div className="border-b border-white/8 px-4 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">List</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">Sales</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="dashboard-table w-full">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Customer
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Contact
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Units
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Revenue
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Date
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-4 sm:px-6 py-8 text-center text-slate-400">
                      No sales records found. Click the + button to add a customer.
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => {
                    const complete = isSaleComplete(sale)
                    const revenue = (sale.units_sold || 0) * UNIT_PRICE
                    return (
                      <tr
                        key={sale.id}
                        className={`${complete ? 'bg-emerald-400/4' : 'bg-rose-400/4'}`}
                      >
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <div className="text-sm sm:text-base font-medium text-white">
                            {sale.buyer_name || 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <div className="text-xs sm:text-sm text-slate-300 break-all">
                            {sale.buyer_contact || 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <div className="text-sm sm:text-base text-white font-medium">
                            {sale.units_sold || 0}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <div className="text-sm sm:text-base font-mono text-emerald-400 font-semibold">
                            ₹{revenue.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <div className="text-xs sm:text-sm text-slate-300">
                            {sale.purchase_date
                              ? formatDateDDMMYY(sale.purchase_date)
                              : sale.created_at
                                ? formatDateDDMMYY(sale.created_at)
                                : 'N/A'}
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 whitespace-nowrap">
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
                              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/[0.08] sm:text-sm"
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
      </div>

      {/* Floating + Button */}
        <button
          onClick={() => {
            setEditingSaleId(null)
            setCustomerFormData({
            buyer_name: '',
            buyer_contact: '',
            units_purchased: '',
            purchase_date: new Date().toISOString().split('T')[0],
            notes: '',
            picture_file: null,
          })
            setIsDateEditable(false)
            setIsCustomerModalOpen(true)
          }}
        className="dashboard-fab fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white transition-all hover:-translate-y-1 sm:bottom-8 sm:right-8 sm:h-16 sm:w-16"
        aria-label="Add Customer"
      >
        <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Customer Onboarding Modal */}
      <Modal
        isOpen={isCustomerModalOpen}
        onClose={() => {
          setIsCustomerModalOpen(false)
          setEditingSaleId(null)
          setCustomerFormData({
            buyer_name: '',
            buyer_contact: '',
            units_purchased: '',
            purchase_date: new Date().toISOString().split('T')[0],
            notes: '',
            picture_file: null,
          })
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
          />

          <FormField
            label="Customer Number"
            type="tel"
            value={customerFormData.buyer_contact}
            onChange={(value) => setCustomerFormData({ ...customerFormData, buyer_contact: value })}
            placeholder="Enter customer phone number"
            required
          />

          <FormField
            label="Units Purchased"
            type="number"
            value={customerFormData.units_purchased}
            onChange={(value) => setCustomerFormData({ ...customerFormData, units_purchased: value })}
            placeholder="Enter units purchased"
            required
          />

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Revenue
            </label>
            <div className="dashboard-input flex items-center text-lg font-semibold text-emerald-200">
              ₹{((parseInt(customerFormData.units_purchased) || 0) * UNIT_PRICE).toLocaleString()}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Purchase Date
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customerFormData.purchase_date}
                onChange={(e) => setCustomerFormData({ ...customerFormData, purchase_date: e.target.value })}
                disabled={!isDateEditable}
                className="dashboard-input flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                required
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
              className={`dashboard-button dashboard-button-primary ${editingSaleId ? 'flex-1' : 'w-full'}`}
            >
              {editingSaleId ? 'Done' : 'Save Customer'}
            </button>
          </div>
        </form>
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

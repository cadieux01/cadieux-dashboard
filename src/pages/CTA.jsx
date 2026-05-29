import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import { formatDateDDMMYY } from '../lib/date'

export default function CTA() {
  const [alerts, setAlerts] = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [partnerFilter, setPartnerFilter] = useState('all')
  const [colorFilter, setColorFilter] = useState('all')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })

  useEffect(() => {
    fetchData()
  }, [])

  const formatPhoneNumber = (contact) => {
    if (!contact) return null
    // Remove all non-digit characters except + for international numbers
    return contact.replace(/[^\d+]/g, '')
  }

  const handleCallPartner = (contact) => {
    const phoneNumber = formatPhoneNumber(contact)
    if (!phoneNumber) {
      alert('No contact number available for this partner')
      return
    }
    window.location.href = `tel:${phoneNumber}`
  }

  const fetchData = async () => {
    try {
      // Fetch sales with partner info and date_of_assignment
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select(`
          *,
          trainers:profiles (
            id,
            name:full_name,
            contact:phone_number,
            email
          )
        `)
        .order('date_of_assignment', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })

      if (salesError) throw salesError

      // Transform sales data to alerts format
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const alertsData = (salesData || [])
        .filter(sale => {
          // Only show active sales with remaining unsold units
          const unsoldUnits = (sale.units_assigned || 0) - (sale.units_sold || 0) - (sale.retracted_units || 0)
          if (!(unsoldUnits > 0 && sale.date_of_assignment)) return false
          
          // Only show cards within 7 days from date of assignment
          const assignmentDate = new Date(sale.date_of_assignment)
          assignmentDate.setHours(0, 0, 0, 0)
          const diffTime = today - assignmentDate
          const daysSinceAssignment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
          
          // Filter to only show cards within 7 days (including today = 0, up to 7 days)
          return daysSinceAssignment >= 0 && daysSinceAssignment <= 7
        })
        .map(sale => {
          const assignmentDate = new Date(sale.date_of_assignment)
          assignmentDate.setHours(0, 0, 0, 0)
          const diffTime = today - assignmentDate
          const daysSinceAssignment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
          const trainerName = sale.trainers?.name || sale.trainers?.email || sale.trainers?.contact || (sale.trainer_id ? `Partner (${sale.trainer_id.slice(0, 8)})` : 'N/A')
          const trainerContact = sale.trainers?.contact || sale.trainers?.email || ''
          
          return {
            sale_id: sale.id,
            trainer_id: sale.trainer_id,
            trainer_name: trainerName,
            trainer_contact: trainerContact,
            buyer_name: sale.buyer_name,
            units_assigned: sale.units_assigned || 0,
            units_sold: sale.units_sold || 0,
            retracted_units: sale.retracted_units || 0,
            unsold_units: (sale.units_assigned || 0) - (sale.units_sold || 0) - (sale.retracted_units || 0),
            date_of_assignment: sale.date_of_assignment,
            days_since_assignment: daysSinceAssignment,
          }
        })

      // Fetch partners for filter
      const { data: partnersData, error: partnersError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'partner')
        .order('full_name', { ascending: true, nullsFirst: false })

      if (partnersError) throw partnersError

      setAlerts(alertsData)
      setPartners((partnersData || []).map((partner) => ({
        id: partner.id,
        name: partner.full_name || partner.email || 'N/A',
      })))
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Calculate alert status based on days since assignment
  // Green: within 2 days of assignment (including assignment day: 0, 1, 2)
  // Red: post 2 days (3+ days since assignment)
  const getAlertStatus = (daysSinceAssignment) => {
    if (daysSinceAssignment <= 2) return 'green' // Within 2 days (including assignment day)
    return 'red' // Post 2 days (warning)
  }

  // Filter alerts
  const filteredAlerts = alerts.filter((alert) => {
    // Partner filter
    if (partnerFilter !== 'all' && alert.trainer_id !== partnerFilter) return false

    // Color filter
    const status = getAlertStatus(alert.days_since_assignment)
    if (colorFilter !== 'all' && status !== colorFilter) return false

    // Date range filter
    if (dateRange.start && new Date(alert.date_of_assignment) < new Date(dateRange.start)) return false
    if (dateRange.end && new Date(alert.date_of_assignment) > new Date(dateRange.end)) return false

    return true
  })

  // Calculate KPIs
  const redAlerts = alerts.filter(a => getAlertStatus(a.days_since_assignment) === 'red').length
  const greenAlerts = alerts.filter(a => getAlertStatus(a.days_since_assignment) === 'green').length
  const activeSales = alerts.length
  const totalUnsold = alerts.reduce((sum, a) => sum + (a.unsold_units || 0), 0)

  const getStatusStyles = (status) => {
    switch (status) {
      case 'red':
        return {
          bg: 'border-[#844156]/45 bg-[linear-gradient(135deg,rgba(113,35,58,0.36),rgba(37,12,23,0.78))]',
          badge: 'bg-[#d77a94]',
          text: 'text-[#ffd9e3]',
        }
      default: // green
        return {
          bg: 'border-[#63bf99]/45 bg-[linear-gradient(135deg,rgba(46,118,89,0.34),rgba(11,36,28,0.78))]',
          badge: 'bg-[#7fe0b7]',
          text: 'text-[#e0fff2]',
        }
    }
  }

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="relative z-10 mb-8">
        <div>
          <h1 className="dashboard-title">CTA</h1>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Active"
          value={activeSales}
          color="indigo"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m3 6V7m3 10v-4m5 8H4a2 2 0 01-2-2V5a2 2 0 012-2h16a2 2 0 012 2v14a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <KPICard
          title="Safe"
          value={greenAlerts}
          color="emerald"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="Unsafe"
          value={redAlerts}
          color="rose"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="Unsold"
          value={totalUnsold.toLocaleString()}
          color="indigo"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
      </div>

      {/* Filters */}
      <div className="dashboard-panel mb-6 rounded-[30px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Partner Filter */}
          <select
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
            className="dashboard-select min-w-[180px]"
          >
            <option value="all">All</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>

          {/* Color Filter */}
          <select
            value={colorFilter}
            onChange={(e) => setColorFilter(e.target.value)}
            className="dashboard-select min-w-[180px]"
          >
            <option value="all">All</option>
            <option value="green">Safe</option>
            <option value="red">Unsafe</option>
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">From:</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="dashboard-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">To:</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="dashboard-input"
            />
          </div>

          {/* Clear Filters */}
          {(partnerFilter !== 'all' || colorFilter !== 'all' || dateRange.start || dateRange.end) && (
              <button
                onClick={() => {
                  setPartnerFilter('all')
                  setColorFilter('all')
                  setDateRange({ start: '', end: '' })
                }}
                className="dashboard-button dashboard-button-secondary px-4 py-2 text-sm"
              >
                Clear
              </button>
            )}
          </div>
      </div>

      {/* Alerts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAlerts.length === 0 ? (
          <div className="dashboard-panel col-span-full rounded-[30px] p-12 text-center">
            <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-500">No alerts matching your filters</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const status = getAlertStatus(alert.days_since_assignment)
            const styles = getStatusStyles(status)
            
            return (
              <div
                key={alert.sale_id}
                onClick={() => handleCallPartner(alert.trainer_contact)}
                className={`${styles.bg} cursor-pointer rounded-[28px] border p-5 shadow-[0_24px_50px_rgba(2,6,23,0.28)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1`}
              >
                {/* Traffic Light Indicator */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-3 w-3 ${styles.badge} rounded-full shadow-lg`}></div>
                    <span className={`text-sm font-semibold uppercase tracking-wide ${styles.text}`}>
                      {status === 'red' ? 'Unsafe' : 'Safe'}
                    </span>
                  </div>
                  <span className="rounded-full border border-white/8 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-slate-300">
                    {alert.days_since_assignment === 0 ? 'Today' : alert.days_since_assignment > 0 ? `${alert.days_since_assignment}d ago` : `${Math.abs(alert.days_since_assignment)}d ahead`}
                  </span>
                </div>

                {/* Partner Info */}
                <div className="mb-4">
                  <p className="font-semibold text-white text-lg">{alert.trainer_name}</p>
                  <p className="text-sm text-slate-400">{alert.trainer_contact}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="dashboard-subpanel rounded-[20px] p-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Assigned</p>
                    <p className="text-xl font-bold text-white">{alert.units_assigned}</p>
                  </div>
                  <div className="dashboard-subpanel rounded-[20px] p-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Unsold</p>
                    <p className={`text-xl font-bold ${styles.text}`}>{alert.unsold_units}</p>
                  </div>
                </div>

                {/* Date */}
                <div className="flex items-center justify-between border-t border-white/8 pt-3">
                  <span className="text-sm text-slate-400">Date</span>
                  <span className={`text-sm font-medium ${styles.text}`}>
                    {formatDateDDMMYY(alert.date_of_assignment)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

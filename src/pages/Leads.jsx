import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import AlertBanner from '../components/AlertBanner'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import UnitWheel from '../components/UnitWheel'
import RefreshButton from '../components/RefreshButton'
import RefreshStatus from '../components/RefreshStatus'
import useRefreshable from '../lib/useRefreshable'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import { getBatchFreshnessMap, batchMsLeft, fmtBatchLeft } from '../lib/batches'
import { getAgentBalance } from '../lib/agentInventory'
import { verifyPayment, getProofSignedUrl } from '../lib/payments'
import { formatDateDDMMYY, formatDateTimeDDMMYY } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import { demoBlock, demoLeads, demoLeadSales, demoLeadTrainers, VARIANTS } from '../lib/demoData'

function currentTimeHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function extractTimeHHMM(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return currentTimeHHMM()
  const d = value ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return currentTimeHHMM()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function extractDateYMD(value) {
  if (!value) return new Date().toISOString().split('T')[0]
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.split('T')[0]
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0]
}

// Combine a YYYY-MM-DD date and an HH:MM time into a full ISO timestamp so
// shelf-life can be counted from the exact assignment moment.
function combineDateTime(dateStr, timeStr) {
  const date = dateStr || new Date().toISOString().split('T')[0]
  const time = /^\d{2}:\d{2}$/.test(timeStr || '') ? timeStr : '00:00'
  const dt = new Date(`${date}T${time}`)
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString()
}

// Unit entry — iOS-style scroll-wheel picker (UnitWheel). Thin wrapper that
// keeps the original prop signature so every call site is unchanged.
function NumberStepper({ label, hint, value, onChange, min = 0, max = 100 }) {
  return (
    <UnitWheel
      label={label}
      hint={hint}
      value={parseInt(value) || 0}
      onChange={onChange}
      min={min}
      max={max}
    />
  )
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'new', label: 'New' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
]

export default function Leads() {
  const { isDemo, user, isAdmin, profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [agentBalance, setAgentBalance] = useState(null)
  const [proofMap, setProofMap] = useState({})
  const [verifyingId, setVerifyingId] = useState(null)
  const [sales, setSales] = useState([])
  const [trainers, setTrainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [salesSearchQuery, setSalesSearchQuery] = useState('')
  const [salesTrainerFilter, setSalesTrainerFilter] = useState('all')
  const [salesStateFilter, setSalesStateFilter] = useState('all')
  const [salesSortField, setSalesSortField] = useState('units_sold')
  const [salesSortDirection, setSalesSortDirection] = useState('desc')
  const [customersPage, setCustomersPage] = useState(1)
  const [customersItemsPerPage, setCustomersItemsPerPage] = useState(10)
  const [salesPage, setSalesPage] = useState(1)
  const [salesItemsPerPage, setSalesItemsPerPage] = useState(10)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isAddSaleModalOpen, setIsAddSaleModalOpen] = useState(false)
  const [isAddTrainerModalOpen, setIsAddTrainerModalOpen] = useState(false)
  const [isAddSaleEntryModalOpen, setIsAddSaleEntryModalOpen] = useState(false)
  const [isAddRetractModalOpen, setIsAddRetractModalOpen] = useState(false)
  const [editingLeadId, setEditingLeadId] = useState(null)
  const [editingSaleId, setEditingSaleId] = useState(null)
  const [editingSaleData, setEditingSaleData] = useState(null) // Store original sale data for audit
  const [editingLeadData, setEditingLeadData] = useState(null) // Store original lead data for audit
  const [editingTrainerId, setEditingTrainerId] = useState(null)
  const [editingTrainerData, setEditingTrainerData] = useState(null) // Store original trainer data for audit
  const [saleEntryFormData, setSaleEntryFormData] = useState({
    trainer_id: '',
    sale_id: '',
    units: '',
  })
  const [retractFormData, setRetractFormData] = useState({
    trainer_id: '',
    sale_id: '',
    units: '',
    variant: 'multigrain',
    reason: 'damaged',
    notes: '',
  })
  const [leadFormData, setLeadFormData] = useState({
    trainer_id: '',
    trainer_contact: '',
    buyer_name: '',
    buyer_contact: '',
    status: 'new',
  })
  const [saleFormData, setSaleFormData] = useState({
    trainer_id: '',
    multigrain_assigned: '',
    plain_assigned: '',
    units_sold: '',
    date_of_assignment: new Date().toISOString().split('T')[0],
    time_of_assignment: currentTimeHHMM(),
    retracted_units: '',
    payment_method: 'credit',
  })
  const [isDateEditable, setIsDateEditable] = useState(false)
  const [batchMap, setBatchMap] = useState({})
  const [now, setNow] = useState(Date.now())
  const [trainerFormData, setTrainerFormData] = useState({
    name: '',
    contact: '',
    notes: '',
    joining_date: new Date().toISOString().split('T')[0],
  })

  // Tick `now` every second so the batch countdowns on Active Sales update
  // live, client-side only (no DB calls).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const trainerById = useMemo(() => {
    const lookup = {}
    for (const trainer of trainers) {
      if (trainer?.id) {
        lookup[trainer.id] = trainer
      }
    }
    return lookup
  }, [trainers])

  const getPartnerName = (record) => {
    const joinedTrainer = record?.trainers
    const fallbackTrainer = record?.trainer_id ? trainerById[record.trainer_id] : null

    const displayName = joinedTrainer?.name || joinedTrainer?.email || fallbackTrainer?.name
    if (displayName) return displayName
    if (joinedTrainer?.contact || fallbackTrainer?.contact) return joinedTrainer?.contact || fallbackTrainer?.contact
    if (record?.trainer_id) return `Partner (${record.trainer_id.slice(0, 8)})`
    return 'N/A'
  }

  const getPartnerContact = (record) => {
    const joinedTrainer = record?.trainers
    const fallbackTrainer = record?.trainer_id ? trainerById[record.trainer_id] : null
    return joinedTrainer?.contact || fallbackTrainer?.contact || joinedTrainer?.email || fallbackTrainer?.email || ''
  }

  const { refresh, refreshing, lastUpdated, pullDistance } = useRefreshable(() => fetchData())

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    if (isDemo) {
      setLeads(demoLeads())
      setSales(demoLeadSales())
      setTrainers(demoLeadTrainers())
      setLoading(false)
      return
    }
    try {
      // Fetch leads with trainer info
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select(`
          *,
          trainers:profiles (
            id,
            name:full_name,
            contact:phone_number,
            email
          )
        `)
        .order('created_at', { ascending: false })

      if (leadsError) throw leadsError

      // Fetch sales with trainer info
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
        .order('date_of_assignment', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (salesError) throw salesError

      // Fetch partners for filter/forms (kept in trainer-shaped object for UI compatibility).
      // Removed (soft-deleted) partners are excluded so you can't assign new
      // stock to them; their past sales still render from the sales rows.
      const { data: partnersData, error: trainersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at, status, margin_percent, margin_percent_multigrain, margin_percent_plain')
        .eq('role', 'partner')
        .order('full_name', { ascending: true, nullsFirst: false })

      if (trainersError) throw trainersError

      const normalizedPartners = (partnersData || [])
        .filter((partner) => partner.status !== 'deleted' && partner.status !== 'inactive')
        .map((partner) => ({
        id: partner.id,
        name: partner.full_name || partner.email || 'N/A',
        contact: partner.phone_number || '',
        email: partner.email || '',
        notes: partner.notes || '',
        created_at: partner.created_at,
        margin_percent: partner.margin_percent,
        margin_percent_multigrain: partner.margin_percent_multigrain,
        margin_percent_plain: partner.margin_percent_plain,
      }))

      setLeads(leadsData || [])
      setSales(salesData || [])
      setTrainers(normalizedPartners)

      // Freshness for any batch-stamped assignments so Active Sales can show a
      // live countdown. Legacy rows (NULL batch_id) simply have no entry.
      try {
        const map = await getBatchFreshnessMap((salesData || []).map((r) => r.batch_id))
        setBatchMap(map)
      } catch (e) {
        console.warn('getBatchFreshnessMap failed:', e.message)
      }

      // Logged-in agent's in-hand stock balance (admin → agent → partner ledger).
      try {
        if (user?.id) setAgentBalance(await getAgentBalance(user.id))
      } catch (e) {
        console.warn('getAgentBalance failed:', e.message)
      }

      // Payment proofs for credit assignments awaiting verification, so the agent
      // can view the partner's proof and verify (pending/awaiting → paid).
      try {
        const creditSaleIds = (salesData || [])
          .filter((s) => s.payment_status === 'awaiting_verification')
          .map((s) => s.id)
        if (creditSaleIds.length) {
          const { data: confs } = await supabase
            .from('payment_confirmations')
            .select('sale_id, proof_file_path, status, requested_at')
            .in('sale_id', creditSaleIds)
            .order('requested_at', { ascending: false })
          const map = {}
          for (const c of confs || []) {
            if (!map[c.sale_id]) map[c.sale_id] = c // newest first → keep latest
          }
          setProofMap(map)
        } else {
          setProofMap({})
        }
      } catch (e) {
        console.warn('payment_confirmations fetch failed:', e.message)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter leads
  const filteredLeads = leads.filter((lead) => {
    // Status filter
    if (statusFilter !== 'all' && lead.status !== statusFilter) return false

    // Trainer filter
    if (trainerFilter !== 'all' && lead.trainer_id !== trainerFilter) return false

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesTrainer = getPartnerName(lead).toLowerCase().includes(query)
      const matchesBuyer = lead.buyer_name?.toLowerCase().includes(query)
      const matchesContact = lead.buyer_contact?.toLowerCase().includes(query)
      if (!matchesTrainer && !matchesBuyer && !matchesContact) return false
    }

    return true
  })

  // Calculate KPIs
  const totalLeads = leads.length
  const newLeads = leads.filter(l => l.status === 'new').length
  const convertedLeads = leads.filter(l => l.status === 'converted').length
  const lostLeads = leads.filter(l => l.status === 'lost').length
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0

  const handleEditLead = (lead) => {
    setEditingLeadId(lead.id)
    setEditingLeadData(lead) // Store original data for audit
    setLeadFormData({
      trainer_id: lead.trainer_id || '',
      trainer_contact: lead.trainer_contact || lead.trainers?.contact || '',
      buyer_name: lead.buyer_name || '',
      buyer_contact: lead.buyer_contact || '',
      status: lead.status || 'new',
    })
    setIsAddModalOpen(true)
  }

  const handleDeleteLead = async (id) => {
    if (isDemo) return demoBlock()
    if (!confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
      return
    }

    try {
      // Get lead data before deletion for audit
      const lead = leads.find(l => l.id === id)

      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id)

      if (error) throw error

      // Log audit event for delete
      const oldLeadDelVals = lead ? {
        buyer_name: lead.buyer_name,
        buyer_contact: lead.buyer_contact,
        status: lead.status,
        trainer_id: lead.trainer_id,
      } : null
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'lead',
        entityId: id,
        description: createAuditDescription('DELETE', 'lead', {
          buyer_name: lead?.buyer_name,
        }, null, oldLeadDelVals, null),
        oldValues: oldLeadDelVals,
      })

      await fetchData()
    } catch (error) {
      console.error('Error deleting lead:', error)
      alert('Error deleting lead: ' + error.message)
    }
  }

  const handleSaveLead = async () => {
    if (isDemo) return demoBlock()
    // Partner is optional — a customer logged by an agent goes to admin with no
    // partner linkage (trainer_id stays null). Only the buyer name is required.
    if (!leadFormData.buyer_name?.trim()) {
      alert('Please enter customer name')
      return
    }

    try {
      if (editingLeadId) {
        // Update existing lead
        const { error } = await supabase
          .from('leads')
          .update({
            trainer_id: leadFormData.trainer_id || null,
            trainer_contact: leadFormData.trainer_contact.trim() || null,
            buyer_name: leadFormData.buyer_name.trim(),
            buyer_contact: leadFormData.buyer_contact.trim() || null,
            status: leadFormData.status,
          })
          .eq('id', editingLeadId)

        if (error) throw error

        // Log audit event for update
        const oldLeadVals = editingLeadData ? {
          buyer_name: editingLeadData.buyer_name,
          buyer_contact: editingLeadData.buyer_contact,
          status: editingLeadData.status,
          trainer_id: editingLeadData.trainer_id,
        } : null
        const newLeadVals = {
          buyer_name: leadFormData.buyer_name.trim(),
          buyer_contact: leadFormData.buyer_contact.trim() || null,
          status: leadFormData.status,
          trainer_id: leadFormData.trainer_id,
        }
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'lead',
          entityId: editingLeadId,
          description: createAuditDescription('UPDATE', 'lead', {
            buyer_name: leadFormData.buyer_name.trim(),
          }, null, oldLeadVals, newLeadVals),
          oldValues: oldLeadVals,
          newValues: newLeadVals,
        })
      } else {
        // Insert new lead
        const { data, error } = await supabase
          .from('leads')
          .insert([{
            trainer_id: leadFormData.trainer_id || null,
            trainer_contact: leadFormData.trainer_contact.trim() || null,
            buyer_name: leadFormData.buyer_name.trim(),
            buyer_contact: leadFormData.buyer_contact.trim() || null,
            status: leadFormData.status,
          }])
          .select()
          .single()

        if (error) throw error

        // Log audit event for create
        const newLeadCreateVals = {
          buyer_name: leadFormData.buyer_name.trim(),
          buyer_contact: leadFormData.buyer_contact.trim() || null,
          status: leadFormData.status,
          trainer_id: leadFormData.trainer_id,
        }
        await logAuditEvent({
          actionType: 'CREATE',
          entityType: 'lead',
          entityId: data.id,
          description: createAuditDescription('CREATE', 'lead', {
            buyer_name: leadFormData.buyer_name.trim(),
          }, null, null, newLeadCreateVals),
          newValues: newLeadCreateVals,
        })
      }

      // Reset form and refresh data
      setLeadFormData({
        trainer_id: '',
        trainer_contact: '',
        buyer_name: '',
        buyer_contact: '',
        status: 'new',
      })
      setEditingLeadId(null)
      setEditingLeadData(null)
      setIsAddModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving lead:', error)
      alert('Error saving lead: ' + error.message)
    }
  }

  const handleCloseModal = () => {
    setIsAddModalOpen(false)
    setEditingLeadId(null)
    setLeadFormData({
      trainer_id: '',
      trainer_contact: '',
      buyer_name: '',
      buyer_contact: '',
      status: 'new',
    })
  }

  const getStatusBadge = (status) => {
    const styles = {
      new: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      converted: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      lost: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    }
    return (
      <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${styles[status] || styles.new}`}>
        {status?.charAt(0).toUpperCase() + status?.slice(1)}
      </span>
    )
  }

  const formatPhoneNumber = (contact) => {
    if (!contact) return null
    // Remove all non-digit characters except + for international numbers
    return contact.replace(/[^\d+]/g, '')
  }

  const handleCall = (contact) => {
    const phoneNumber = formatPhoneNumber(contact)
    if (!phoneNumber) {
      alert('No contact number available for this lead')
      return
    }
    window.location.href = `tel:${phoneNumber}`
  }

  const handleCallPartner = (contact) => {
    const phoneNumber = formatPhoneNumber(contact)
    if (!phoneNumber) {
      alert('No contact number available for this partner')
      return
    }
    window.location.href = `tel:${phoneNumber}`
  }

  // Sales functionality
  const getRemainingUnsoldUnits = (sale) => {
    const assigned = sale?.units_assigned || 0
    const sold = sale?.units_sold || 0
    const retracted = sale?.retracted_units || 0
    return Math.max(0, assigned - sold - retracted)
  }
  const isActiveSale = (sale) => getRemainingUnsoldUnits(sale) > 0

  // Batch freshness: an assignment carries the originating batch's expiry clock
  // via batch_id. Legacy / mixed-variant assignments (NULL batch_id) have no
  // batch and are treated as never-expiring (always "active", no countdown).
  const getSaleBatch = (sale) => (sale?.batch_id ? batchMap[sale.batch_id] : null)
  const getSaleMsLeft = (sale) => {
    const batch = getSaleBatch(sale)
    return batch ? batchMsLeft(batch.expiry_at, now) : null
  }
  const isExpiredSale = (sale) => {
    const ms = getSaleMsLeft(sale)
    return ms != null && ms <= 0
  }
  const saleFreshnessCls = (ms) => {
    if (ms == null) return 'text-slate-400'
    if (ms <= 0) return 'text-rose-400'
    if (ms <= 24 * 60 * 60 * 1000) return 'text-amber-400'
    return 'text-emerald-300'
  }

  // Filter sales
  const filteredSales = sales.filter((sale) => {
    if (salesTrainerFilter !== 'all' && sale.trainer_id !== salesTrainerFilter) return false
    if (salesStateFilter === 'active' && !isActiveSale(sale)) return false
    if (salesStateFilter === 'inactive' && isActiveSale(sale)) return false
    if (salesSearchQuery) {
      const query = salesSearchQuery.toLowerCase()
      const matchesTrainer = getPartnerName(sale).toLowerCase().includes(query)
      const matchesContact = getPartnerContact(sale).toLowerCase().includes(query)
      if (!matchesTrainer && !matchesContact) return false
    }
    return true
  })
  const handleSalesSort = (field) => {
    if (salesSortField === field) {
      setSalesSortDirection(salesSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSalesSortField(field)
      setSalesSortDirection('desc')
    }
  }

  const getSaleSortTimestamp = (sale) => {
    const value = sale?.date_of_assignment || sale?.created_at
    if (!value) return 0
    const timestamp = new Date(value).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
  }

  // BOX 1 — Active Sales: assignments whose batch clock has NOT expired
  // (NULL-batch legacy rows count as active). Newest assignment first.
  const openAssignments = [...sales]
    .filter((sale) => !isExpiredSale(sale))
    .sort((a, b) => getSaleSortTimestamp(b) - getSaleSortTimestamp(a))
  const openAssignmentsCount = openAssignments.length

  // Retracted — any assignment that had units pulled back (own table on the
  // Assignment page, separate from Active Sales). Newest retraction first.
  const retractedSales = [...sales]
    .filter(
      (sale) =>
        (sale.retracted_units || 0) > 0 ||
        (sale.multigrain_retracted || 0) > 0 ||
        (sale.plain_retracted || 0) > 0,
    )
    .sort(
      (a, b) =>
        new Date(b.retract_date || b.created_at || 0).getTime() -
        new Date(a.retract_date || a.created_at || 0).getTime(),
    )

  const sortedSales = [...filteredSales].sort((a, b) => {
    // Priority 1: keep unclosed (active) sales at the top.
    const aActive = isActiveSale(a)
    const bActive = isActiveSale(b)
    if (aActive !== bActive) return aActive ? -1 : 1

    // Priority 2: within each group, newest assignment first.
    const recencyDiff = getSaleSortTimestamp(b) - getSaleSortTimestamp(a)
    if (recencyDiff !== 0) return recencyDiff

    // Priority 3: apply manual table sort only as a tie-breaker.
    let aVal = a[salesSortField]
    let bVal = b[salesSortField]
    
    if (salesSortField === 'trainer_name') {
      aVal = getPartnerName(a)
      bVal = getPartnerName(b)
    } else if (salesSortField === 'retracted') {
      aVal = a.retracted_units || 0
      bVal = b.retracted_units || 0
    }
    
    if (typeof aVal === 'string') {
      return salesSortDirection === 'asc' 
        ? aVal.localeCompare(bVal) 
        : bVal.localeCompare(aVal)
    }
    
    return salesSortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })

  // Pagination calculations
  const customersTotalPages = Math.ceil(filteredLeads.length / customersItemsPerPage)
  const customersStartIndex = (customersPage - 1) * customersItemsPerPage
  const customersEndIndex = customersStartIndex + customersItemsPerPage
  const paginatedCustomers = filteredLeads.slice(customersStartIndex, customersEndIndex)

  const salesTotalPages = Math.ceil(sortedSales.length / salesItemsPerPage)
  const salesStartIndex = (salesPage - 1) * salesItemsPerPage
  const salesEndIndex = salesStartIndex + salesItemsPerPage
  const paginatedSales = sortedSales.slice(salesStartIndex, salesEndIndex)
  const customerCountStart = filteredLeads.length ? customersStartIndex + 1 : 0
  const customerCountEnd = filteredLeads.length ? Math.min(customersEndIndex, filteredLeads.length) : 0
  const salesCountStart = sortedSales.length ? salesStartIndex + 1 : 0
  const salesCountEnd = sortedSales.length ? Math.min(salesEndIndex, sortedSales.length) : 0

  // Reset to page 1 when items per page changes
  useEffect(() => {
    setCustomersPage(1)
  }, [customersItemsPerPage])

  useEffect(() => {
    setSalesPage(1)
  }, [salesItemsPerPage])

  const today = new Date()
  today.setHours(0, 0, 0, 0) // Normalize to start of day
  
  const getDaysSinceAssignment = (assignmentDate) => {
    if (!assignmentDate) return null
    const assignment = new Date(assignmentDate)
    assignment.setHours(0, 0, 0, 0)
    const diffTime = today - assignment
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getSalesRowClassName = (row) => {
    const retractedUnits = row.retracted_units || 0
    if (retractedUnits > 0) {
      return 'bg-purple-500/10 border-l-2 border-purple-500'
    }
    return ''
  }

  const handleSaveSale = async () => {
    if (isDemo) return demoBlock()

    const multigrainAssigned = parseInt(saleFormData.multigrain_assigned) || 0
    const plainAssigned = parseInt(saleFormData.plain_assigned) || 0
    const totalAssigned = multigrainAssigned + plainAssigned

    if (!saleFormData.trainer_id) {
      alert('Please select a partner')
      return
    }

    if (totalAssigned <= 0) {
      alert('Please enter at least one variant quantity')
      return
    }

    // When only a single variant is assigned, tag the row with that variant so
    // downstream views can attribute it cleanly; mixed assignments stay null.
    const singleVariant =
      multigrainAssigned > 0 && plainAssigned === 0
        ? VARIANTS.multigrain
        : plainAssigned > 0 && multigrainAssigned === 0
          ? VARIANTS.plain
          : null

    try {

      // Combine the chosen date + time into a full ISO timestamp so shelf-life
      // is counted from the exact assignment moment, not midnight.
      const assignmentDate = combineDateTime(saleFormData.date_of_assignment, saleFormData.time_of_assignment)

      const insertPayload = {
        trainer_id: saleFormData.trainer_id,
        units_assigned: totalAssigned,
        multigrain_assigned: multigrainAssigned,
        plain_assigned: plainAssigned,
        units_sold: 0,
        date_of_assignment: assignmentDate,
        product_variant: singleVariant?.name || null,
        unit_price: singleVariant?.price || null,
      };


      if (editingSaleId) {
        const retractedUnits = parseInt(saleFormData.retracted_units) || 0
        const unitsAssigned = totalAssigned
        
        // Validate that retracted units don't exceed assigned units
        if (retractedUnits > unitsAssigned) {
          alert(`Retracted units (${retractedUnits}) cannot exceed assigned units (${unitsAssigned})`)
          return
        }
        
        if (retractedUnits < 0) {
          alert('Retracted units cannot be negative')
          return
        }

        const unitsSold = parseInt(saleFormData.units_sold) || 0
        
        // Validate that units sold don't exceed assigned units (after retracted)
        const availableUnits = unitsAssigned - retractedUnits
        if (unitsSold > availableUnits) {
          alert(`Units sold (${unitsSold}) cannot exceed available units (${availableUnits} = ${unitsAssigned} assigned - ${retractedUnits} retracted)`)
          return
        }
        
        if (unitsSold < 0) {
          alert('Units sold cannot be negative')
          return
        }

        const { error } = await supabase
          .from('sales')
          .update({
            trainer_id: saleFormData.trainer_id,
            units_assigned: unitsAssigned,
            multigrain_assigned: multigrainAssigned,
            plain_assigned: plainAssigned,
            units_sold: unitsSold,
            date_of_assignment: assignmentDate,
            retracted_units: retractedUnits,
            product_variant: singleVariant?.name || null,
            unit_price: singleVariant?.price || null,
          })
          .eq('id', editingSaleId)

        
        if (error) throw error

        // Log audit event for update
        const trainer = trainers.find(t => t.id === saleFormData.trainer_id)
        const oldVals = editingSaleData ? {
          units_assigned: editingSaleData.units_assigned,
          units_sold: editingSaleData.units_sold,
          retracted_units: editingSaleData.retracted_units || 0,
          date_of_assignment: editingSaleData.date_of_assignment,
        } : null
        const newVals = {
          units_assigned: unitsAssigned,
          units_sold: unitsSold,
          retracted_units: retractedUnits,
          date_of_assignment: assignmentDate,
        }
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'sale',
          entityId: editingSaleId,
          description: createAuditDescription('UPDATE', 'sale', {
            units_assigned: unitsAssigned,
            units_sold: unitsSold,
            retracted_units: retractedUnits,
            date_of_assignment: assignmentDate,
          }, trainer, oldVals, newVals),
          oldValues: oldVals,
          newValues: newVals,
          metadata: {
            trainer_id: saleFormData.trainer_id,
            trainer_name: trainer?.name,
          },
        })
      } else {
        // Agent -> partner handoff. The SECURITY DEFINER RPC FIFO-picks the
        // caller's oldest non-expired batch lot that covers this assignment,
        // stamps the new sales row with that batch_id (clock carries, no reset)
        // and writes a 'delivered' ledger row to decrement the agent's in-hand
        // units. When no covering batch exists (legacy / mixed / no stock) it
        // inserts exactly as before with batch_id NULL — no countdown.
        // Money snapshot for the credit/paid ledger: gross across both variants
        // (mixed-safe). Owed is recomputed server-side from the partner's margin.
        const assignGross =
          multigrainAssigned * VARIANTS.multigrain.price +
          plainAssigned * VARIANTS.plain.price
        const { data, error } = await supabase
          .rpc('assign_sale_fifo', {
            p_partner_id: saleFormData.trainer_id,
            p_multigrain: multigrainAssigned,
            p_plain: plainAssigned,
            p_date_of_assignment: assignmentDate,
            p_product_variant: singleVariant?.name || null,
            p_unit_price: singleVariant?.price || null,
            p_payment_status: saleFormData.payment_method === 'paid' ? 'paid' : 'pending',
            p_amount_gross: assignGross,
          })


        if (error) throw error

        // Log audit event for create
        const trainer = trainers.find(t => t.id === saleFormData.trainer_id)
        await logAuditEvent({
          actionType: 'CREATE',
          entityType: 'sale',
          entityId: data.id,
          description: createAuditDescription('CREATE', 'sale', {
            units_assigned: insertPayload.units_assigned,
          }, trainer, null, insertPayload),
          newValues: insertPayload,
          metadata: {
            trainer_id: saleFormData.trainer_id,
            trainer_name: trainer?.name,
            date_of_assignment: assignmentDate,
          },
        })
      }

      setSaleFormData({
        trainer_id: '',
        multigrain_assigned: '',
        plain_assigned: '',
        units_sold: '',
        date_of_assignment: new Date().toISOString().split('T')[0],
        time_of_assignment: currentTimeHHMM(),
        retracted_units: '',
        payment_method: 'credit',
      })
      setIsDateEditable(false)
      setEditingSaleId(null)
      setEditingSaleData(null)
      setIsAddSaleModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving sale:', error)
      alert('Error saving sale: ' + error.message)
    }
  }

  // Agent/admin marks a credit assignment paid after seeing the partner's proof.
  // verify_payment is admin/sales gated server-side; sets payment_status = 'paid'.
  const handleVerifyPayment = async (sale) => {
    if (isDemo) return demoBlock()
    setVerifyingId(sale.id)
    try {
      await verifyPayment(sale.id)
      await fetchData()
    } catch (error) {
      console.error('Verify payment failed:', error)
      alert('Could not mark as paid: ' + (error.message || error))
    } finally {
      setVerifyingId(null)
    }
  }

  const viewProof = async (path) => {
    try {
      const url = await getProofSignedUrl(path, 120)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.error('Proof URL failed:', e)
    }
  }

  const handleEditSale = (sale) => {
    // Derive each variant's assigned count from the stored columns; legacy rows
    // (single units_assigned, no breakdown) fall back to attributing the total
    // to the row's tagged variant, defaulting to multi-grain.
    const mg = sale.multigrain_assigned != null ? sale.multigrain_assigned : null
    const pl = sale.plain_assigned != null ? sale.plain_assigned : null
    let multigrain = mg ?? 0
    let plain = pl ?? 0
    if (mg == null && pl == null) {
      if (sale.product_variant === VARIANTS.plain.name) plain = sale.units_assigned || 0
      else multigrain = sale.units_assigned || 0
    }
    setSaleFormData({
      trainer_id: sale.trainer_id,
      multigrain_assigned: multigrain,
      plain_assigned: plain,
      units_sold: sale.units_sold || 0,
      date_of_assignment: extractDateYMD(sale.date_of_assignment || sale.created_at),
      time_of_assignment: extractTimeHHMM(sale.date_of_assignment || sale.created_at),
      retracted_units: sale.retracted_units || 0,
    })
    setIsDateEditable(false)
    setEditingSaleId(sale.id)
    setEditingSaleData(sale) // Store original data for audit
    setIsAddSaleModalOpen(true)
  }

  const handleDeleteSale = async (id) => {
    if (isDemo) return demoBlock()
    if (!confirm('Are you sure you want to delete this sale?')) return

    try {
      // Get sale data before deletion for audit
      const sale = sales.find(s => s.id === id)
      const trainer = sale ? trainers.find(t => t.id === sale.trainer_id) : null

      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('id', id)

      if (error) throw error

      // Log audit event for delete
      const oldVals = sale ? {
        units_assigned: sale.units_assigned,
        units_sold: sale.units_sold,
        retracted_units: sale.retracted_units || 0,
        date_of_assignment: sale.date_of_assignment,
      } : null
      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'sale',
        entityId: id,
        description: createAuditDescription('DELETE', 'sale', {}, trainer, oldVals, null),
        oldValues: oldVals,
        metadata: {
          trainer_id: sale?.trainer_id,
          trainer_name: trainer?.name,
        },
      })

      await fetchData()
    } catch (error) {
      console.error('Error deleting sale:', error)
      alert('Error deleting sale: ' + error.message)
    }
  }

  const handleCloseSaleModal = () => {
    setIsAddSaleModalOpen(false)
    setEditingSaleId(null)
    setEditingSaleData(null)
    setIsDateEditable(false)
    setSaleFormData({
      trainer_id: '',
      multigrain_assigned: '',
      plain_assigned: '',
      units_sold: '',
      date_of_assignment: new Date().toISOString().split('T')[0],
      time_of_assignment: currentTimeHHMM(),
      retracted_units: '',
    })
  }

  // Trainer functions
  const handleSaveTrainer = async () => {
    if (isDemo) return demoBlock()
    if (!trainerFormData.name.trim()) {
      alert('Please enter a partner name')
      return
    }

    try {
      const joiningTimestamp = trainerFormData.joining_date 
        ? new Date(trainerFormData.joining_date).toISOString()
        : new Date().toISOString()

      if (editingTrainerId) {
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: trainerFormData.name.trim(),
            phone_number: trainerFormData.contact.trim() || null,
            notes: trainerFormData.notes.trim() || null,
            created_at: joiningTimestamp,
          })
          .eq('role', 'partner')
          .eq('id', editingTrainerId)

        if (error) throw error

        // Log audit event for update
        const oldTrainerVals = editingTrainerData ? {
          full_name: editingTrainerData.name,
          phone_number: editingTrainerData.contact,
          notes: editingTrainerData.notes,
          created_at: editingTrainerData.created_at,
        } : null
        const newTrainerVals = {
          full_name: trainerFormData.name.trim(),
          phone_number: trainerFormData.contact.trim() || null,
          notes: trainerFormData.notes.trim() || null,
          created_at: joiningTimestamp,
        }
        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'user',
          entityId: editingTrainerId,
          description: createAuditDescription('UPDATE', 'user', {
            name: trainerFormData.name.trim(),
          }, null, oldTrainerVals, newTrainerVals),
          oldValues: oldTrainerVals,
          newValues: newTrainerVals,
        })
      } else {
        alert('Create new partners from the Partners page.')
        return
      }

      setTrainerFormData({
        name: '',
        contact: '',
        notes: '',
        joining_date: new Date().toISOString().split('T')[0],
      })
      setEditingTrainerId(null)
      setEditingTrainerData(null)
      setIsAddTrainerModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving trainer:', error)
      alert('Error saving partner: ' + error.message)
    }
  }

  const handleCloseTrainerModal = () => {
    setIsAddTrainerModalOpen(false)
    setEditingTrainerId(null)
    setTrainerFormData({
      name: '',
      contact: '',
      notes: '',
      joining_date: new Date().toISOString().split('T')[0],
    })
  }

  const handleSaveSaleEntry = async () => {
    if (isDemo) return demoBlock()
    if (!saleEntryFormData.trainer_id) {
      alert('Please select a partner')
      return
    }
    if (!saleEntryFormData.sale_id) {
      alert('Please select an active sale')
      return
    }
    const units = parseInt(saleEntryFormData.units)
    if (!units || units <= 0) {
      alert('Please enter valid units')
      return
    }

    try {
      const sale = sales.find(s => s.id === saleEntryFormData.sale_id)
      if (!sale) {
        alert('Selected sale not found')
        return
      }

      const remainingUnsold = getRemainingUnsoldUnits(sale)
      if (units > remainingUnsold) {
        alert(`Units (${units}) cannot exceed remaining unsold units (${remainingUnsold})`)
        return
      }

      const nextValues = {
        units_sold: (sale.units_sold || 0) + units,
        retracted_units: sale.retracted_units || 0,
      }

      const { error } = await supabase
        .from('sales')
        .update(nextValues)
        .eq('id', saleEntryFormData.sale_id)

      if (error) throw error

      const trainer = trainers.find(t => t.id === saleEntryFormData.trainer_id)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'sale',
        entityId: saleEntryFormData.sale_id,
        description: createAuditDescription('UPDATE', 'sale', {
          units_sold: nextValues.units_sold,
          retracted_units: nextValues.retracted_units,
        }, trainer, {
          units_sold: sale.units_sold || 0,
          retracted_units: sale.retracted_units || 0,
        }, nextValues),
        oldValues: {
          units_sold: sale.units_sold || 0,
          retracted_units: sale.retracted_units || 0,
        },
        newValues: nextValues,
        metadata: {
          trainer_id: saleEntryFormData.trainer_id,
          trainer_name: trainer?.name,
          units_delta: units,
        },
      })

      setSaleEntryFormData({
        trainer_id: '',
        sale_id: '',
        units: '',
      })
      setIsAddSaleEntryModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving sale entry:', error)
      alert('Error saving sale entry: ' + error.message)
    }
  }

  const handleCloseSaleEntryModal = () => {
    setIsAddSaleEntryModalOpen(false)
    setSaleEntryFormData({
      trainer_id: '',
      sale_id: '',
      units: '',
    })
  }

  const handleSaveRetractEntry = async () => {
    if (isDemo) return demoBlock()
    if (!retractFormData.trainer_id) {
      alert('Please select a partner')
      return
    }
    if (!retractFormData.sale_id) {
      alert('Please select an active shipment')
      return
    }
    const units = parseInt(retractFormData.units)
    if (!units || units <= 0) {
      alert('Please enter valid units')
      return
    }
    if (!retractFormData.reason) {
      alert('Please select a reason')
      return
    }

    try {
      const sale = sales.find(s => s.id === retractFormData.sale_id)
      if (!sale) {
        alert('Selected shipment not found')
        return
      }

      const remainingUnsold = getRemainingUnsoldUnits(sale)
      if (units > remainingUnsold) {
        alert(`Units (${units}) cannot exceed remaining unsold units (${remainingUnsold})`)
        return
      }

      const isPlain = retractFormData.variant === 'plain'
      const nowIso = new Date().toISOString()

      const nextValues = {
        units_sold: sale.units_sold || 0,
        retracted_units: (sale.retracted_units || 0) + units,
        // Attribution fields — best-effort. Columns are added by the
        // attribution-columns.sql migration; if they don't exist yet the
        // update payload is filtered down to known columns by Supabase.
        retract_reason: retractFormData.reason,
        retract_notes: retractFormData.notes || null,
        retracted_by: user?.id || null,
        retract_date: nowIso,
        multigrain_retracted: (sale.multigrain_retracted || 0) + (isPlain ? 0 : units),
        plain_retracted: (sale.plain_retracted || 0) + (isPlain ? units : 0),
      }

      const { error } = await supabase
        .from('sales')
        .update(nextValues)
        .eq('id', retractFormData.sale_id)

      if (error) throw error

      const trainer = trainers.find(t => t.id === retractFormData.trainer_id)
      await logAuditEvent({
        actionType: 'UPDATE',
        entityType: 'sale',
        entityId: retractFormData.sale_id,
        description: createAuditDescription('UPDATE', 'sale', {
          units_sold: nextValues.units_sold,
          retracted_units: nextValues.retracted_units,
        }, trainer, {
          units_sold: sale.units_sold || 0,
          retracted_units: sale.retracted_units || 0,
        }, nextValues),
        oldValues: {
          units_sold: sale.units_sold || 0,
          retracted_units: sale.retracted_units || 0,
        },
        newValues: nextValues,
        metadata: {
          trainer_id: retractFormData.trainer_id,
          trainer_name: trainer?.name,
          units_delta: units,
        },
      })

      setRetractFormData({
        trainer_id: '',
        sale_id: '',
        units: '',
        variant: 'multigrain',
        reason: 'damaged',
        notes: '',
      })
      setIsAddRetractModalOpen(false)
      await fetchData()
    } catch (error) {
      console.error('Error saving retract entry:', error)
      alert('Error saving retract entry: ' + error.message)
    }
  }

  const handleCloseRetractModal = () => {
    setIsAddRetractModalOpen(false)
    setRetractFormData({
      trainer_id: '',
      sale_id: '',
      units: '',
      variant: 'multigrain',
      reason: 'damaged',
      notes: '',
    })
  }

  const getTrainerActiveSales = (trainerId) => {
    return sales.filter(s => s.trainer_id === trainerId && isActiveSale(s))
  }

  const salesColumns = [
    {
      key: 'trainer_name',
      label: 'Partner',
      sortable: true,
      render: (_, row) => {
        const partnerName = getPartnerName(row)
        const partnerContact = getPartnerContact(row)
        return (
          <div>
            <p className="font-medium text-slate-100">{partnerName}</p>
            <p className="text-xs text-slate-500">{partnerContact || 'No contact'}</p>
          </div>
        )
      },
    },
    {
      key: 'units_assigned',
      label: 'Assigned',
      sortable: true,
      render: (value) => (
        <span className="font-mono">{value || 0}</span>
      ),
    },
    {
      key: 'units_sold',
      label: 'Sold',
      sortable: true,
      render: (value, row) => {
        const percentage = row.units_assigned > 0 
          ? ((value / row.units_assigned) * 100).toFixed(0) 
          : 0
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-emerald-400">{value || 0}</span>
            <span className="text-xs text-slate-500">({percentage}%)</span>
          </div>
        )
      },
    },
    {
      key: 'product_variant',
      label: 'Product',
      sortable: true,
      render: (value) => (
        <span className="text-slate-200">{value || '—'}</span>
      ),
    },
    {
      key: 'retracted',
      label: 'Retracted',
      sortable: true,
      render: (_, row) => {
        const retractedUnits = row.retracted_units || 0
        const percentage = row.units_assigned > 0 
          ? ((retractedUnits / row.units_assigned) * 100).toFixed(0) 
          : 0
        return retractedUnits > 0 ? (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-[#7e22ce]">{retractedUnits}</span>
            <span className="text-xs text-[#7e22ce]">({percentage}%)</span>
          </div>
        ) : (
          <span className="font-mono text-slate-500">0</span>
        )
      },
    },
    {
      key: 'date_of_assignment',
      label: 'Date of Asn',
      sortable: true,
      render: (value, row) => {
        if (!value) return <span className="text-slate-500">N/A</span>
        
        const daysSince = getDaysSinceAssignment(value)
        const displayDate = formatDateTimeDDMMYY(value)
        
        if (daysSince === null) {
          return <span>{displayDate}</span>
        }
        
        // Show days until 6 days, after that show N/A
        if (Math.abs(daysSince) > 6) {
          return <span>{displayDate}</span>
        }
        
        // Show days difference (negative for past, positive for future)
        const daysText = daysSince === 0 ? 'Today' : daysSince > 0 ? `+${daysSince}` : `${daysSince}`
        
        return (
          <div className="flex items-center gap-2">
            <span>{displayDate}</span>
            <span className="px-2 py-0.5 text-xs bg-slate-700 text-slate-300 rounded-full">
              {daysText}
            </span>
          </div>
        )
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleEditSale(row)}
            className="px-3 py-1 text-xs bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded transition-colors"
          >
            Edit
          </button>
        </div>
      ),
    },
  ]

  const columns = [
    {
      key: 'trainer_name',
      label: 'Partner',
      render: (_, row) => (
        <div>
          <p className="font-medium text-slate-100">{getPartnerName(row)}</p>
        </div>
      ),
    },
    {
      key: 'buyer_name',
      label: 'Buyer',
      render: (value, row) => (
        <div>
          <p className="font-medium text-slate-100">{value || 'N/A'}</p>
          <p className="text-xs text-slate-500">{row.buyer_contact}</p>
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Joined',
      render: (value) => (
        <span className="text-slate-400">
          {value ? formatDateDDMMYY(value) : 'N/A'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          {row.buyer_contact && (
            <button
              onClick={() => handleCall(row.buyer_contact)}
              className="px-3 py-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors flex items-center gap-1"
              title={`Call ${row.buyer_contact}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call
            </button>
          )}
          <button
            onClick={() => handleEditLead(row)}
            className="px-3 py-1 text-xs bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded transition-colors"
          >
            Edit
          </button>
        </div>
      ),
    },
  ]

  const renderSalesCard = (sale) => (
    <div key={sale.id} className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${getSalesRowClassName(sale)}`}>
      <div className="mb-3">
        <p className="font-semibold text-slate-100">{getPartnerName(sale)}</p>
        <p className="text-xs text-slate-500">{getPartnerContact(sale) || 'No contact'}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-xs text-slate-500">Assigned</p>
          <p className="font-mono text-slate-100">{sale.units_assigned || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Sold</p>
          <p className="font-mono text-emerald-400">{sale.units_sold || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Retracted</p>
          <p className="font-mono text-[#7e22ce]">{sale.retracted_units || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Product</p>
          <p className="text-sm text-slate-200">{sale.product_variant || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Date of Asn</p>
          <p className="text-sm text-slate-300">
            {sale.date_of_assignment ? formatDateTimeDDMMYY(sale.date_of_assignment) : 'N/A'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {getPartnerContact(sale) && (
          <button
            onClick={() => handleCallPartner(getPartnerContact(sale))}
            className="flex-1 px-3 py-2 text-xs bg-emerald-500/20 text-emerald-400 rounded transition-colors"
          >
            Call
          </button>
        )}
        <button
          onClick={() => handleEditSale(sale)}
          className="flex-1 px-3 py-2 text-xs bg-indigo-500/20 text-indigo-400 rounded transition-colors"
        >
          Edit
        </button>
      </div>
    </div>
  )

  const renderCustomerCard = (lead) => (
    <div key={lead.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2">
        <p className="font-semibold text-slate-100">{lead.buyer_name || 'N/A'}</p>
        <p className="text-xs text-slate-500">{lead.buyer_contact || 'No contact'}</p>
      </div>
      <div className="mb-3">
        <p className="text-xs text-slate-500">Partner</p>
        <p className="text-sm text-slate-300">{getPartnerName(lead)}</p>
      </div>
      <div className="flex items-center justify-between mb-3">
        <div>{getStatusBadge(lead.status)}</div>
        <p className="text-xs text-slate-500">
          {lead.created_at ? formatDateDDMMYY(lead.created_at) : 'N/A'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {lead.buyer_contact && (
          <button
            onClick={() => handleCall(lead.buyer_contact)}
            className="flex-1 px-3 py-2 text-xs bg-emerald-500/20 text-emerald-400 rounded transition-colors"
          >
            Call
          </button>
        )}
        <button
          onClick={() => handleEditLead(lead)}
          className="flex-1 px-3 py-2 text-xs bg-indigo-500/20 text-indigo-400 rounded transition-colors"
        >
          Edit
        </button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="mb-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="dashboard-title">Assignment</h1>
              <p className="dashboard-subtitle hidden sm:block">Assign stock to partners and track active assignments</p>
            </div>
            <RefreshButton onRefresh={refresh} loading={refreshing} />
          </div>
          <div className="grid grid-cols-4 gap-2 w-full lg:w-auto">
            <button
              onClick={() => setIsAddSaleModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 px-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-[#fbf3d4] text-xs font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Assign</span>
            </button>
            <button
              onClick={() => setIsAddSaleEntryModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 px-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-[#fbf3d4] text-xs font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Sale</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 px-3 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-[#fbf3d4] text-xs font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="hidden sm:inline">Customer</span>
            </button>
            <button
              onClick={() => setIsAddRetractModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 px-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-[#fbf3d4] text-xs font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
              <span className="hidden sm:inline">Retract</span>
            </button>
          </div>
        </div>
      </div>


      {/* Available units — the agent's own in-hand stock (admin → agent ledger).
          This is what's available to assign to partners right now. */}
      {agentBalance && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Available units</h2>
            <span className="text-xs text-slate-500">Your in-hand stock</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
              <p className="font-mono text-2xl font-bold text-emerald-300">{agentBalance.available}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Multi-Grain</p>
              <p className="font-mono text-2xl font-bold text-slate-100">{agentBalance.byVariant?.multigrain?.available ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Plain</p>
              <p className="font-mono text-2xl font-bold text-slate-100">{agentBalance.byVariant?.plain?.available ?? 0}</p>
            </div>
          </div>
        </div>
      )}

      {/* BOX 1 — Active Sales (assignments whose batch clock hasn't expired) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Active Sales</h2>
          <p className="dashboard-subtitle mt-1">Open assignments: {openAssignmentsCount}</p>
        </div>
        {openAssignments.length === 0 ? (
          <p className="text-sm text-slate-400">No active assignments.</p>
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur">
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Partner</th>
                  <th className="px-2 py-2 text-right font-medium">MG</th>
                  <th className="px-2 py-2 text-right font-medium">Plain</th>
                  <th className="px-2 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 font-medium">Expiry</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {openAssignments.map((sale) => {
                  const ms = getSaleMsLeft(sale)
                  const batch = getSaleBatch(sale)
                  const left = batch ? fmtBatchLeft(ms) : null
                  const proof = proofMap[sale.id]
                  const payMeta = sale.payment_status
                    ? {
                        pending: { label: 'On credit', cls: 'border-amber-700 bg-amber-500/10 text-amber-300' },
                        awaiting_verification: { label: 'Awaiting', cls: 'border-sky-700 bg-sky-500/10 text-sky-300' },
                        paid: { label: 'Paid', cls: 'border-emerald-700 bg-emerald-500/10 text-emerald-300' },
                      }[sale.payment_status] || { label: sale.payment_status, cls: 'border-slate-700 bg-slate-800 text-slate-300' }
                    : null
                  return (
                    <tr key={sale.id} className="align-top">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-100">{getPartnerName(sale)}</p>
                        <p className="text-[11px] text-slate-500">{getPartnerContact(sale) || 'No contact'}</p>
                        <p className="text-[11px] text-slate-600">
                          {sale.date_of_assignment ? formatDateTimeDDMMYY(sale.date_of_assignment) : 'N/A'}
                        </p>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-slate-200">{sale.multigrain_assigned || 0}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-200">{sale.plain_assigned || 0}</td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-400">{sale.units_sold || 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {left ? (
                          <span className={`font-semibold ${saleFreshnessCls(ms)}`}>{left}</span>
                        ) : (
                          <span className="text-slate-500">No expiry</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {payMeta ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${payMeta.cls}`}>
                              {payMeta.label}
                            </span>
                            {sale.amount_owed != null && sale.payment_status !== 'paid' && (
                              <span className="font-mono text-[11px] text-amber-300">₹{Number(sale.amount_owed).toLocaleString('en-IN')} owed</span>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {proof?.proof_file_path && (
                                <button
                                  onClick={() => viewProof(proof.proof_file_path)}
                                  className="rounded bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-200 transition-colors hover:bg-sky-500/30"
                                >
                                  Proof
                                </button>
                              )}
                              {sale.payment_status !== 'paid' && (
                                <button
                                  onClick={() => handleVerifyPayment(sale)}
                                  disabled={verifyingId === sale.id}
                                  className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-[#fbf3d4] transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {verifyingId === sale.id ? '…' : 'Mark paid'}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleEditSale(sale)}
                          className="rounded bg-indigo-500/20 px-3 py-1 text-indigo-400 transition-colors hover:bg-indigo-500/30"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Retracted — units pulled back from partners (separate from Active Sales) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Retracted</h2>
          <p className="dashboard-subtitle mt-1">Units pulled back: {retractedSales.length}</p>
        </div>
        {retractedSales.length === 0 ? (
          <p className="text-sm text-slate-400">No retracted units.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur">
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Partner</th>
                  <th className="px-2 py-2 text-right font-medium">MG</th>
                  <th className="px-2 py-2 text-right font-medium">Plain</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {retractedSales.map((sale) => {
                  const total =
                    sale.retracted_units ||
                    (sale.multigrain_retracted || 0) + (sale.plain_retracted || 0)
                  return (
                    <tr key={sale.id} className="align-top">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-100">{getPartnerName(sale)}</p>
                        <p className="text-[11px] text-slate-500">{getPartnerContact(sale) || 'No contact'}</p>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[#c084fc]">{sale.multigrain_retracted || 0}</td>
                      <td className="px-2 py-2 text-right font-mono text-[#c084fc]">{sale.plain_retracted || 0}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-[#c084fc]">{total}</td>
                      <td className="px-3 py-2 text-slate-300">
                        <p className="capitalize">{sale.retract_reason || '—'}</p>
                        {sale.retract_notes && <p className="text-[11px] text-slate-500">{sale.retract_notes}</p>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                        {sale.retract_date
                          ? formatDateTimeDDMMYY(sale.retract_date)
                          : sale.date_of_assignment
                            ? formatDateDDMMYY(sale.date_of_assignment)
                            : 'N/A'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters (admin only — customer list below) */}
      {isAdmin && (
      <>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4">
          {/* Search */}
          <div className="w-full sm:flex-1 sm:min-w-[220px]">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by trainer, buyer, or contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Trainer Filter */}
          <select
            value={trainerFilter}
            onChange={(e) => setTrainerFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Partners</option>
            {trainers.map((trainer) => (
              <option key={trainer.id} value={trainer.id}>
                {trainer.name}
              </option>
            ))}
          </select>

          {/* Clear Filters */}
          {(searchQuery || statusFilter !== 'all' || trainerFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('')
                setStatusFilter('all')
                setTrainerFilter('all')
              }}
              className="w-full sm:w-auto px-4 py-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-8">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-slate-100">Customers</h3>
        </div>
        <div className="sm:hidden p-4 space-y-3">
          {paginatedCustomers.length === 0 ? (
            <p className="text-sm text-slate-400">No customers found for selected filters.</p>
          ) : (
            paginatedCustomers.map(renderCustomerCard)
          )}
        </div>
        <div className="hidden sm:block max-h-[600px] overflow-y-auto">
          <DataTable columns={columns} data={paginatedCustomers} />
        </div>
        {/* Bottom bar — items-per-page + showing count + pager (below the table) */}
        <div className="px-4 sm:px-6 py-4 border-t border-slate-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Items per page:</span>
            <select
              value={customersItemsPerPage}
              onChange={(e) => setCustomersItemsPerPage(Number(e.target.value))}
              className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="text-sm text-slate-500">
              Showing {customerCountStart}-{customerCountEnd} of {filteredLeads.length}
            </span>
          </div>
          {customersTotalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCustomersPage(Math.max(1, customersPage - 1))}
                disabled={customersPage === 1}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {customersPage} of {customersTotalPages}
              </span>
              <button
                onClick={() => setCustomersPage(Math.min(customersTotalPages, customersPage + 1))}
                disabled={customersPage === customersTotalPages}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* Add/Edit Lead Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        title={editingLeadId ? 'Edit Lead' : isAdmin ? 'Add New Lead' : 'Add Customer'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveLead()
          }}
        >
          {/* Partner linkage + status are an admin concern. Agents only log the
              customer (name + contact); it goes to admin with no partner. */}
          {(isAdmin || editingLeadId) && (
            <>
              <FormField
                label="Partner"
                type="select"
                value={leadFormData.trainer_id}
                onChange={(value) => {
                  const selectedTrainer = trainers.find(t => t.id === value)
                  setLeadFormData({
                    ...leadFormData,
                    trainer_id: value,
                    trainer_contact: selectedTrainer?.contact || leadFormData.trainer_contact,
                  })
                }}
                options={trainers.map((t) => ({ value: t.id, label: t.name }))}
              />
              <FormField
                label="Partner Contact"
                value={leadFormData.trainer_contact}
                onChange={(value) => setLeadFormData({ ...leadFormData, trainer_contact: value })}
                placeholder="Enter trainer contact (phone/email)"
              />
            </>
          )}
          <FormField
            label="Customer Name"
            value={leadFormData.buyer_name}
            onChange={(value) => setLeadFormData({ ...leadFormData, buyer_name: value })}
            placeholder="Enter customer name"
            required
          />
          <FormField
            label="Customer Contact"
            value={leadFormData.buyer_contact}
            onChange={(value) => setLeadFormData({ ...leadFormData, buyer_contact: value })}
            placeholder="Enter customer contact (phone/email)"
          />
          {(isAdmin || editingLeadId) && (
            <FormField
              label="Status"
              type="select"
              value={leadFormData.status}
              onChange={(value) => setLeadFormData({ ...leadFormData, status: value })}
              options={[
                { value: 'new', label: 'New' },
                { value: 'converted', label: 'Converted' },
                { value: 'lost', label: 'Lost' },
              ]}
            />
          )}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {editingLeadId && (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
                    await handleDeleteLead(editingLeadId)
                    handleCloseModal()
                  }
                }}
                className="w-full sm:w-auto px-4 py-2 bg-rose-600 hover:bg-rose-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
            >
              {editingLeadId ? 'Update' : 'Add'} {isAdmin || editingLeadId ? 'Lead' : 'Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add/Edit Sale Modal */}
      <Modal
        isOpen={isAddSaleModalOpen}
        onClose={handleCloseSaleModal}
        title={editingSaleId ? 'Edit Assignment' : 'Assign'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveSale()
          }}
        >
          <FormField
            label="Partner"
            type="select"
            value={saleFormData.trainer_id}
            onChange={(value) => setSaleFormData({ ...saleFormData, trainer_id: value })}
            options={trainers.map((t) => ({ value: t.id, label: t.name }))}
            required
          />

          {/* Per-variant assignment — either can be 0, at least one must be > 0.
              For an AGENT (sales) creating a new assignment, the wheels are
              capped to that agent's available batch stock per variant (admin is
              uncapped; editing an existing row is a direct update, not capped). */}
          {(() => {
            const isEditing = !!editingSaleId
            const mgAvail = agentBalance?.byVariant?.multigrain?.available ?? 0
            const plAvail = agentBalance?.byVariant?.plain?.available ?? 0
            const capMg = !isAdmin && !isEditing ? mgAvail : 100
            const capPl = !isAdmin && !isEditing ? plAvail : 100
            return (
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberStepper
                  label={`Multi-Grain (₹${VARIANTS.multigrain.price})`}
                  value={saleFormData.multigrain_assigned}
                  onChange={(value) => setSaleFormData({ ...saleFormData, multigrain_assigned: value })}
                  max={capMg}
                  hint={!isAdmin && !isEditing ? `${mgAvail} available` : undefined}
                />
                <NumberStepper
                  label={`Plain (₹${VARIANTS.plain.price})`}
                  value={saleFormData.plain_assigned}
                  onChange={(value) => setSaleFormData({ ...saleFormData, plain_assigned: value })}
                  max={capPl}
                  hint={!isAdmin && !isEditing ? `${plAvail} available` : undefined}
                />
              </div>
            )
          })()}

          {/* Live total preview */}
          {(() => {
            const mg = parseInt(saleFormData.multigrain_assigned) || 0
            const pl = parseInt(saleFormData.plain_assigned) || 0
            const totalUnits = mg + pl
            const totalValue = mg * VARIANTS.multigrain.price + pl * VARIANTS.plain.price
            return (
              <div className="mb-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">Total Units</span>
                  <span className="font-semibold text-slate-100">
                    {totalUnits} <span className="text-xs font-normal text-slate-400">({mg} Multi-Grain + {pl} Plain)</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-300">Total Value</span>
                  <span className="font-mono font-semibold text-emerald-300">₹{totalValue.toLocaleString()}</span>
                </div>
              </div>
            )
          })()}

          {/* Payment: Credit (default) or Paid. Credit tracks an amount owed to
              the company based on the partner's margin %; Paid settles now. */}
          {!editingSaleId && (() => {
            const mg = parseInt(saleFormData.multigrain_assigned) || 0
            const pl = parseInt(saleFormData.plain_assigned) || 0
            const gross = mg * VARIANTS.multigrain.price + pl * VARIANTS.plain.price
            const partner = trainers.find((t) => t.id === saleFormData.trainer_id)
            const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0))
            const mgMargin = clampPct(partner?.margin_percent_multigrain ?? partner?.margin_percent)
            const plMargin = clampPct(partner?.margin_percent_plain ?? partner?.margin_percent)
            const mgSet = partner?.margin_percent_multigrain != null || partner?.margin_percent != null
            const plSet = partner?.margin_percent_plain != null || partner?.margin_percent != null
            const owed = Math.round(
              mg * VARIANTS.multigrain.price * (100 - mgMargin) +
              pl * VARIANTS.plain.price * (100 - plMargin)
            ) / 100
            const isCredit = saleFormData.payment_method !== 'paid'
            return (
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSaleFormData({ ...saleFormData, payment_method: 'credit' })}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      isCredit
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    On Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleFormData({ ...saleFormData, payment_method: 'paid' })}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      !isCredit
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    Paid now
                  </button>
                </div>
                {isCredit && (
                  <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-sm">
                    {mg > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Multi-Grain margin</span>
                        <span className="font-semibold text-slate-100">{mgSet ? `${mgMargin}%` : '0% (not set)'}</span>
                      </div>
                    )}
                    {pl > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Plain margin</span>
                        <span className="font-semibold text-slate-100">{plSet ? `${plMargin}%` : '0% (not set)'}</span>
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-slate-300">Owed to company</span>
                      <span className="font-mono font-semibold text-amber-300">₹{owed.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Units Sold (only show when editing) */}
          {editingSaleId && (() => {
            const unitsAssigned =
              (parseInt(saleFormData.multigrain_assigned) || 0) +
              (parseInt(saleFormData.plain_assigned) || 0)
            const retractedUnits = parseInt(saleFormData.retracted_units) || 0
            const maxSold = Math.max(0, unitsAssigned - retractedUnits)
            return (
              <div className="mb-3">
                <NumberStepper
                  label="Units Sold"
                  hint={`Max: ${maxSold}`}
                  value={saleFormData.units_sold}
                  onChange={(value) => setSaleFormData({ ...saleFormData, units_sold: value })}
                  max={maxSold}
                />
              </div>
            )
          })()}

          {/* Date & Time of Assignment — shelf life is counted from this exact moment */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Date &amp; Time of Assignment
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="date"
                value={saleFormData.date_of_assignment}
                onChange={(e) => setSaleFormData({ ...saleFormData, date_of_assignment: e.target.value })}
                className="dashboard-input"
                aria-label="Date of assignment"
              />
              <input
                type="time"
                value={saleFormData.time_of_assignment}
                onChange={(e) => setSaleFormData({ ...saleFormData, time_of_assignment: e.target.value })}
                className="dashboard-input"
                aria-label="Time of assignment"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {formatDateTimeDDMMYY(combineDateTime(saleFormData.date_of_assignment, saleFormData.time_of_assignment))}
            </p>
          </div>

          {/* Retracted Units (only show when editing) */}
          {editingSaleId && (() => {
            const totalAssigned =
              (parseInt(saleFormData.multigrain_assigned) || 0) +
              (parseInt(saleFormData.plain_assigned) || 0)
            return (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Retracted Units
                <span className="ml-2 text-xs text-[#7e22ce]">(units returned to company)</span>
              </label>
              <NumberStepper
                hint={`Max: ${totalAssigned}`}
                value={saleFormData.retracted_units}
                onChange={(value) => setSaleFormData({ ...saleFormData, retracted_units: value })}
                max={totalAssigned}
              />
              {(parseInt(saleFormData.retracted_units) || 0) > 0 && (
                <div className="mt-2 p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <p className="text-xs text-[#7e22ce]">
                    Retracted: {saleFormData.retracted_units} units ({totalAssigned > 0 ? (((parseInt(saleFormData.retracted_units) || 0) / totalAssigned) * 100).toFixed(0) : 0}% of assigned)
                  </p>
                </div>
              )}
            </div>
            )
          })()}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {editingSaleId && (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this sale?')) {
                    await handleDeleteSale(editingSaleId)
                    handleCloseSaleModal()
                  }
                }}
                className="w-full sm:w-auto px-4 py-2 bg-rose-600 hover:bg-rose-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseSaleModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={((parseInt(saleFormData.multigrain_assigned) || 0) + (parseInt(saleFormData.plain_assigned) || 0)) <= 0}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#fbf3d4] rounded-lg transition-colors font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingSaleId ? 'Update Assignment' : 'Assign'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Partner Modal */}
      <Modal
        isOpen={isAddTrainerModalOpen}
        onClose={handleCloseTrainerModal}
        title={editingTrainerId ? "Edit Partner" : "Add New Partner"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveTrainer()
          }}
        >
          <FormField
            label="Partner Name"
            value={trainerFormData.name}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, name: value })}
            placeholder="Enter trainer name"
            required
          />
          <FormField
            label="Contact"
            value={trainerFormData.contact}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, contact: value })}
            placeholder="Enter contact number or email"
          />
          <FormField
            label="Joining Date"
            type="date"
            value={trainerFormData.joining_date}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, joining_date: value })}
          />
          <FormField
            label="Notes"
            type="textarea"
            value={trainerFormData.notes}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, notes: value })}
            placeholder="Enter any additional notes or information about the trainer"
          />

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseTrainerModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
            >
              {editingTrainerId ? 'Update' : 'Add'} Partner
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Sale Modal */}
      <Modal
        isOpen={isAddSaleEntryModalOpen}
        onClose={handleCloseSaleEntryModal}
        title="Add Sale"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveSaleEntry()
          }}
        >
          <FormField
            label="Partner"
            type="select"
            value={saleEntryFormData.trainer_id}
            onChange={(value) => {
              setSaleEntryFormData({
                ...saleEntryFormData,
                trainer_id: value,
                sale_id: '',
              })
            }}
            options={trainers.map((trainer) => ({
              value: trainer.id,
              label: `${trainer.name}${trainer.contact ? ` - ${trainer.contact}` : ''}`,
            }))}
            required
          />

          {saleEntryFormData.trainer_id && (
            <FormField
              label="Active Sale"
              type="select"
              value={saleEntryFormData.sale_id}
              onChange={(value) => setSaleEntryFormData({ ...saleEntryFormData, sale_id: value })}
              options={getTrainerActiveSales(saleEntryFormData.trainer_id).map((sale) => {
                const retractedUnits = sale.retracted_units || 0
                const remainingUnsold = getRemainingUnsoldUnits(sale)
                return {
                  value: sale.id,
                  label: `${sale.units_assigned} assigned (${sale.units_sold || 0} sold, ${retractedUnits} retracted, ${remainingUnsold} remaining) - ${sale.date_of_assignment ? formatDateDDMMYY(sale.date_of_assignment) : 'N/A'}`,
                }
              })}
              required
            />
          )}

          {saleEntryFormData.sale_id && (() => {
            const selectedSale = sales.find(s => s.id === saleEntryFormData.sale_id)
            const retractedUnits = selectedSale?.retracted_units || 0
            const remainingUnsold = getRemainingUnsoldUnits(selectedSale)
            return (
              <div className="mb-4 p-3 bg-slate-800 rounded-lg">
                <p className="text-sm text-slate-400 mb-1">Active Sale Details:</p>
                <p className="text-sm text-slate-100">Units Assigned: {selectedSale?.units_assigned || 0}</p>
                <p className="text-sm text-slate-100">Units Sold: {selectedSale?.units_sold || 0}</p>
                <p className="text-sm text-[#7e22ce]">Already Retracted: {retractedUnits}</p>
                <p className="text-sm text-emerald-400">Remaining Unsold: {remainingUnsold}</p>
              </div>
            )
          })()}

          {(() => {
            const selectedSale = saleEntryFormData.sale_id ? sales.find(s => s.id === saleEntryFormData.sale_id) : null
            const maxUnits = selectedSale ? getRemainingUnsoldUnits(selectedSale) : 100
            return (
              <div className="mb-3">
                <NumberStepper
                  label="Units Sold"
                  hint={selectedSale ? `Max: ${maxUnits}` : undefined}
                  value={saleEntryFormData.units}
                  onChange={(value) => setSaleEntryFormData({ ...saleEntryFormData, units: value })}
                  max={maxUnits}
                />
              </div>
            )
          })()}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseSaleEntryModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
            >
              Add Sale
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Retract Modal */}
      <Modal
        isOpen={isAddRetractModalOpen}
        onClose={handleCloseRetractModal}
        title="Add Retract"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveRetractEntry()
          }}
        >
          <FormField
            label="Partner"
            type="select"
            value={retractFormData.trainer_id}
            onChange={(value) => {
              setRetractFormData({
                ...retractFormData,
                trainer_id: value,
                sale_id: '',
              })
            }}
            options={trainers.map((trainer) => ({
              value: trainer.id,
              label: `${trainer.name}${trainer.contact ? ` - ${trainer.contact}` : ''}`,
            }))}
            required
          />

          {retractFormData.trainer_id && (
            <FormField
              label="Active Shipment"
              type="select"
              value={retractFormData.sale_id}
              onChange={(value) => setRetractFormData({ ...retractFormData, sale_id: value })}
              options={getTrainerActiveSales(retractFormData.trainer_id).map((sale) => {
                const retractedUnits = sale.retracted_units || 0
                const remainingUnsold = getRemainingUnsoldUnits(sale)
                return {
                  value: sale.id,
                  label: `${sale.units_assigned} assigned (${sale.units_sold || 0} sold, ${retractedUnits} retracted, ${remainingUnsold} remaining) - ${sale.date_of_assignment ? formatDateDDMMYY(sale.date_of_assignment) : 'N/A'}`,
                }
              })}
              required
            />
          )}

          {retractFormData.sale_id && (() => {
            const selectedSale = sales.find(s => s.id === retractFormData.sale_id)
            const retractedUnits = selectedSale?.retracted_units || 0
            const remainingUnsold = getRemainingUnsoldUnits(selectedSale)
            return (
              <div className="mb-4 p-3 bg-slate-800 rounded-lg">
                <p className="text-sm text-slate-400 mb-1">Active Shipment Details:</p>
                <p className="text-sm text-slate-100">Units Assigned: {selectedSale?.units_assigned || 0}</p>
                <p className="text-sm text-slate-100">Units Sold: {selectedSale?.units_sold || 0}</p>
                <p className="text-sm text-[#7e22ce]">Already Retracted: {retractedUnits}</p>
                <p className="text-sm text-emerald-400">Remaining Unsold: {remainingUnsold}</p>
              </div>
            )
          })()}

          <FormField
            label="Variant"
            type="select"
            value={retractFormData.variant}
            onChange={(value) => setRetractFormData({ ...retractFormData, variant: value })}
            options={[
              { value: 'multigrain', label: 'Multi-Grain' },
              { value: 'plain', label: 'Plain' },
            ]}
            required
          />

          {(() => {
            const selectedSale = retractFormData.sale_id ? sales.find(s => s.id === retractFormData.sale_id) : null
            const maxUnits = selectedSale ? getRemainingUnsoldUnits(selectedSale) : 100
            return (
              <div className="mb-3">
                <NumberStepper
                  label="Retracted Units"
                  hint={selectedSale ? `Max: ${maxUnits}` : undefined}
                  value={retractFormData.units}
                  onChange={(value) => setRetractFormData({ ...retractFormData, units: value })}
                  max={maxUnits}
                />
              </div>
            )
          })()}

          <FormField
            label="Reason"
            type="select"
            value={retractFormData.reason}
            onChange={(value) => setRetractFormData({ ...retractFormData, reason: value })}
            options={[
              { value: 'damaged',         label: 'Damaged' },
              { value: 'expired',         label: 'Expired' },
              { value: 'customer_return', label: 'Customer Return' },
              { value: 'unsold',          label: 'Unsold' },
              { value: 'other',           label: 'Other' },
            ]}
            required
          />

          <FormField
            label="Notes"
            type="textarea"
            value={retractFormData.notes}
            onChange={(value) => setRetractFormData({ ...retractFormData, notes: value })}
            placeholder="Why is this product being returned?"
          />

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseRetractModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-[#fbf3d4] rounded-lg transition-colors font-medium"
            >
              Add Retract
            </button>
          </div>
        </form>
      </Modal>


      <RefreshStatus pullDistance={pullDistance} refreshing={refreshing} at={lastUpdated} onRefresh={refresh} />
    </div>
  )
}

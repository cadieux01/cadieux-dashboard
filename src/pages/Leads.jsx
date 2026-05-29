import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import AlertBanner from '../components/AlertBanner'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'new', label: 'New' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
]

export default function Leads() {
  const [leads, setLeads] = useState([])
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
    units_assigned: '',
    units_sold: '',
    date_of_assignment: new Date().toISOString().split('T')[0],
    retracted_units: '',
  })
  const [isDateEditable, setIsDateEditable] = useState(false)
  const [trainerFormData, setTrainerFormData] = useState({
    name: '',
    contact: '',
    notes: '',
    joining_date: new Date().toISOString().split('T')[0],
  })

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

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
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

      // Fetch partners for filter/forms (kept in trainer-shaped object for UI compatibility)
      const { data: partnersData, error: trainersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at')
        .eq('role', 'partner')
        .order('full_name', { ascending: true, nullsFirst: false })

      if (trainersError) throw trainersError

      const normalizedPartners = (partnersData || []).map((partner) => ({
        id: partner.id,
        name: partner.full_name || partner.email || 'N/A',
        contact: partner.phone_number || '',
        email: partner.email || '',
        notes: partner.notes || '',
        created_at: partner.created_at,
      }))

      setLeads(leadsData || [])
      setSales(salesData || [])
      setTrainers(normalizedPartners)
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
    if (!leadFormData.trainer_id) {
      alert('Please select a partner')
      return
    }

    if (!leadFormData.buyer_name?.trim()) {
      alert('Please enter buyer name')
      return
    }

    try {
      if (editingLeadId) {
        // Update existing lead
        const { error } = await supabase
          .from('leads')
          .update({
            trainer_id: leadFormData.trainer_id,
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
            trainer_id: leadFormData.trainer_id,
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
  const activeSalesCount = sales.filter(isActiveSale).length

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
    if (!saleFormData.trainer_id) {
      alert('Please select a partner')
      return
    }

    if (!saleFormData.units_assigned || parseInt(saleFormData.units_assigned) <= 0) {
      alert('Please enter units assigned')
      return
    }

    try {
      
      // Ensure date is in YYYY-MM-DD format for Supabase DATE column
      const assignmentDate = saleFormData.date_of_assignment || new Date().toISOString().split('T')[0]
      
      const insertPayload = {
        trainer_id: saleFormData.trainer_id,
        units_assigned: parseInt(saleFormData.units_assigned) || 0,
        units_sold: 0,
        date_of_assignment: assignmentDate,
      };
      
      
      if (editingSaleId) {
        const retractedUnits = parseInt(saleFormData.retracted_units) || 0
        const unitsAssigned = parseInt(saleFormData.units_assigned) || 0
        
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
            units_sold: unitsSold,
            date_of_assignment: assignmentDate,
            retracted_units: retractedUnits,
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
        const { data, error } = await supabase
          .from('sales')
          .insert([insertPayload])
          .select()
          .single()


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
        units_assigned: '',
        units_sold: '',
        date_of_assignment: new Date().toISOString().split('T')[0],
        retracted_units: '',
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

  const handleEditSale = (sale) => {
    setSaleFormData({
      trainer_id: sale.trainer_id,
      units_assigned: sale.units_assigned,
      units_sold: sale.units_sold || 0,
      date_of_assignment: sale.date_of_assignment || sale.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      retracted_units: sale.retracted_units || 0,
    })
    setIsDateEditable(false)
    setEditingSaleId(sale.id)
    setEditingSaleData(sale) // Store original data for audit
    setIsAddSaleModalOpen(true)
  }

  const handleDeleteSale = async (id) => {
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
      units_assigned: '',
      units_sold: '',
      date_of_assignment: new Date().toISOString().split('T')[0],
      retracted_units: '',
    })
  }

  // Trainer functions
  const handleSaveTrainer = async () => {
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

      const nextValues = {
        units_sold: sale.units_sold || 0,
        retracted_units: (sale.retracted_units || 0) + units,
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
            <p className="font-medium text-white">{partnerName}</p>
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
            <span className="font-mono font-semibold text-purple-400">{retractedUnits}</span>
            <span className="text-xs text-purple-400">({percentage}%)</span>
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
        const displayDate = formatDateDDMMYY(value)
        
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
          <p className="font-medium text-white">{getPartnerName(row)}</p>
        </div>
      ),
    },
    {
      key: 'buyer_name',
      label: 'Buyer',
      render: (value, row) => (
        <div>
          <p className="font-medium text-white">{value || 'N/A'}</p>
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
        <p className="font-semibold text-white">{getPartnerName(sale)}</p>
        <p className="text-xs text-slate-500">{getPartnerContact(sale) || 'No contact'}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-xs text-slate-500">Assigned</p>
          <p className="font-mono text-white">{sale.units_assigned || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Sold</p>
          <p className="font-mono text-emerald-400">{sale.units_sold || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Retracted</p>
          <p className="font-mono text-purple-400">{sale.retracted_units || 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Date of Asn</p>
          <p className="text-sm text-slate-300">
            {sale.date_of_assignment ? formatDateDDMMYY(sale.date_of_assignment) : 'N/A'}
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
        <p className="font-semibold text-white">{lead.buyer_name || 'N/A'}</p>
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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-1 sm:mb-2">Sales</h1>
            <p className="text-sm sm:text-base text-slate-400">Track and manage buyer leads from partners</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 w-full lg:w-auto">
            <button
              onClick={() => setIsAddSaleModalOpen(true)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm sm:text-base font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Assign Unit
            </button>
            <button
              onClick={() => setIsAddSaleEntryModalOpen(true)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-sm sm:text-base font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Sale
            </button>
            <button
              onClick={() => setIsAddRetractModalOpen(true)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-sm sm:text-base font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
              Add Retract
            </button>
          </div>
        </div>
      </div>


      {/* Sales Records Section */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-lg">
            Sales Records
          </h2>
          <p className="text-sm sm:text-base text-slate-400 mt-2">Active sales: {activeSalesCount}</p>
        </div>
        
        {/* Sales Filters */}
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
                  placeholder="Search by partner or contact..."
                  value={salesSearchQuery}
                  onChange={(e) => setSalesSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
      </div>

            {/* Trainer Filter */}
            <select
              value={salesTrainerFilter}
              onChange={(e) => setSalesTrainerFilter(e.target.value)}
              className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Partners</option>
              {trainers.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.name}
                </option>
              ))}
            </select>

            <select
              value={salesStateFilter}
              onChange={(e) => setSalesStateFilter(e.target.value)}
              className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Sales</option>
              <option value="active">Active Sales</option>
              <option value="inactive">Closed Sales</option>
            </select>

            {/* Clear Filters */}
            {(salesSearchQuery || salesTrainerFilter !== 'all' || salesStateFilter !== 'all') && (
              <button
                onClick={() => {
                  setSalesSearchQuery('')
                  setSalesTrainerFilter('all')
                  setSalesStateFilter('all')
                }}
                className="w-full sm:w-auto px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Sales Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Sales Records</h3>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Items per page:</span>
                <select
                  value={salesItemsPerPage}
                  onChange={(e) => setSalesItemsPerPage(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
              <span className="text-sm text-slate-500">
                Showing {salesCountStart}-{salesCountEnd} of {sortedSales.length} sales
              </span>
            </div>
          </div>
          <div className="sm:hidden p-4 space-y-3">
            {paginatedSales.length === 0 ? (
              <p className="text-sm text-slate-400">No sales found for selected filters.</p>
            ) : (
              paginatedSales.map(renderSalesCard)
            )}
          </div>
          <div className="hidden sm:block max-h-[600px] overflow-y-auto">
            <DataTable
              columns={salesColumns}
              data={paginatedSales}
              sortField={salesSortField}
              sortDirection={salesSortDirection}
              onSort={handleSalesSort}
              rowClassName={getSalesRowClassName}
            />
          </div>
          {salesTotalPages > 1 && (
            <div className="px-4 sm:px-6 py-4 border-t border-slate-800 flex justify-center sm:justify-start">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSalesPage(Math.max(1, salesPage - 1))}
                  disabled={salesPage === 1}
                  className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-400">
                  Page {salesPage} of {salesTotalPages}
                </span>
                <button
                  onClick={() => setSalesPage(Math.min(salesTotalPages, salesPage + 1))}
                  disabled={salesPage === salesTotalPages}
                  className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
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
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="w-full sm:w-auto px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-8">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">Customers</h3>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium rounded-lg shadow-lg transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Customer
            </button>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-sm text-slate-400">Items per page:</span>
              <select
                value={customersItemsPerPage}
                onChange={(e) => setCustomersItemsPerPage(Number(e.target.value))}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <span className="text-sm text-slate-500">
              Showing {customerCountStart}-{customerCountEnd} of {filteredLeads.length} customers
            </span>
          </div>
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
        {customersTotalPages > 1 && (
          <div className="px-4 sm:px-6 py-4 border-t border-slate-800 flex justify-center sm:justify-start">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <button
                onClick={() => setCustomersPage(Math.max(1, customersPage - 1))}
                disabled={customersPage === 1}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {customersPage} of {customersTotalPages}
              </span>
              <button
                onClick={() => setCustomersPage(Math.min(customersTotalPages, customersPage + 1))}
                disabled={customersPage === customersTotalPages}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Lead Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        title={editingLeadId ? "Edit Lead" : "Add New Lead"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSaveLead()
          }}
        >
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
            required
          />
          <FormField
            label="Partner Contact"
            value={leadFormData.trainer_contact}
            onChange={(value) => setLeadFormData({ ...leadFormData, trainer_contact: value })}
            placeholder="Enter trainer contact (phone/email)"
          />
          <FormField
            label="Buyer Name"
            value={leadFormData.buyer_name}
            onChange={(value) => setLeadFormData({ ...leadFormData, buyer_name: value })}
            placeholder="Enter buyer name"
            required
          />
          <FormField
            label="Buyer Contact"
            value={leadFormData.buyer_contact}
            onChange={(value) => setLeadFormData({ ...leadFormData, buyer_contact: value })}
            placeholder="Enter buyer contact (phone/email)"
          />
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
                className="w-full sm:w-auto px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors font-medium"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium"
            >
              {editingLeadId ? 'Update' : 'Add'} Lead
            </button>
          </div>
        </form>
      </Modal>

      {/* Add/Edit Sale Modal */}
      <Modal
        isOpen={isAddSaleModalOpen}
        onClose={handleCloseSaleModal}
        title={editingSaleId ? 'Edit Assignment' : 'Assign Unit'}
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
          
          <FormField
            label="Units Assigned"
            type="number"
            value={saleFormData.units_assigned}
            onChange={(value) => setSaleFormData({ ...saleFormData, units_assigned: value })}
            placeholder="0"
            required
          />

          {/* Units Sold (only show when editing) */}
          {editingSaleId && (
            <FormField
              label="Units Sold"
              type="number"
              value={saleFormData.units_sold}
              onChange={(value) => setSaleFormData({ ...saleFormData, units_sold: value })}
              placeholder="0"
              min="0"
              max={(() => {
                const unitsAssigned = parseInt(saleFormData.units_assigned) || 0
                const retractedUnits = parseInt(saleFormData.retracted_units) || 0
                return Math.max(0, unitsAssigned - retractedUnits)
              })()}
            />
          )}

          {/* Date of Assignment with Edit Button */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Date of Assignment
            </label>
            <div className="flex items-center gap-2">
              {isDateEditable ? (
                <>
                  <input
                    type="date"
                    value={saleFormData.date_of_assignment}
                    onChange={(e) => setSaleFormData({ ...saleFormData, date_of_assignment: e.target.value })}
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setIsDateEditable(false)}
                    className="w-full sm:w-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    title="Save date"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300">
                    {saleFormData.date_of_assignment ? formatDateDDMMYY(saleFormData.date_of_assignment) : 'N/A'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDateEditable(true)}
                    className="w-full sm:w-auto px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                    title="Edit date"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Retracted Units (only show when editing) */}
          {editingSaleId && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Retracted Units
                <span className="ml-2 text-xs text-purple-400">(units returned to company)</span>
              </label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="number"
                  value={saleFormData.retracted_units}
                  onChange={(e) => {
                    const value = e.target.value === '' ? '' : parseInt(e.target.value) || 0
                    setSaleFormData({ ...saleFormData, retracted_units: value })
                  }}
                  min="0"
                  max={parseInt(saleFormData.units_assigned) || 0}
                  className="flex-1 px-4 py-2 bg-slate-800 border border-purple-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="0"
                />
                <div className="w-full sm:w-auto px-3 py-2 bg-purple-900/30 border border-purple-700 rounded-lg text-purple-300 text-sm">
                  Max: {parseInt(saleFormData.units_assigned) || 0}
                </div>
              </div>
              {saleFormData.retracted_units > 0 && (
                <div className="mt-2 p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <p className="text-xs text-purple-400">
                    Retracted: {saleFormData.retracted_units} units ({saleFormData.units_assigned > 0 ? ((saleFormData.retracted_units / saleFormData.units_assigned) * 100).toFixed(0) : 0}% of assigned)
                  </p>
                </div>
              )}
            </div>
          )}

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
                className="w-full sm:w-auto px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors font-medium"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseSaleModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium"
            >
              {editingSaleId ? 'Update Assignment' : 'Assign Unit'}
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
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium"
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
                <p className="text-sm text-white">Units Assigned: {selectedSale?.units_assigned || 0}</p>
                <p className="text-sm text-white">Units Sold: {selectedSale?.units_sold || 0}</p>
                <p className="text-sm text-purple-400">Already Retracted: {retractedUnits}</p>
                <p className="text-sm text-emerald-400">Remaining Unsold: {remainingUnsold}</p>
              </div>
            )
          })()}

          <FormField
            label="Units Sold"
            type="number"
            value={saleEntryFormData.units}
            onChange={(value) => setSaleEntryFormData({ ...saleEntryFormData, units: value })}
            placeholder="Enter units"
            required
            min="1"
            max={saleEntryFormData.sale_id ? (() => {
              const selectedSale = sales.find(s => s.id === saleEntryFormData.sale_id)
              return getRemainingUnsoldUnits(selectedSale)
            })() : undefined}
          />

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseSaleEntryModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium"
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
                <p className="text-sm text-white">Units Assigned: {selectedSale?.units_assigned || 0}</p>
                <p className="text-sm text-white">Units Sold: {selectedSale?.units_sold || 0}</p>
                <p className="text-sm text-purple-400">Already Retracted: {retractedUnits}</p>
                <p className="text-sm text-emerald-400">Remaining Unsold: {remainingUnsold}</p>
              </div>
            )
          })()}

          <FormField
            label="Retracted Units"
            type="number"
            value={retractFormData.units}
            onChange={(value) => setRetractFormData({ ...retractFormData, units: value })}
            placeholder="Enter units"
            required
            min="1"
            max={retractFormData.sale_id ? (() => {
              const selectedSale = sales.find(s => s.id === retractFormData.sale_id)
              return getRemainingUnsoldUnits(selectedSale)
            })() : undefined}
          />

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              type="button"
              onClick={handleCloseRetractModal}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium"
            >
              Add Retract
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

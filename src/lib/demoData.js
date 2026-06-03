// ============================================================================
// DEMO MODE
// ----------------------------------------------------------------------------
// Self-contained, hardcoded fake data + helpers for the read-only "demo mode".
// When a demo account is logged in, every page reads from DEMO_DATA below and
// NEVER queries the real Supabase database. Demo accounts also never
// authenticate against Supabase — see matchDemoAccount() / AuthContext.
// ============================================================================

// --- Demo accounts ----------------------------------------------------------
// Detected by the email pattern demo-<role>@cadieux.demo. Users can type either
// the short key (demo-admin) or the full email at the login screen.
export const DEMO_ACCOUNTS = {
  'demo-admin': { role: 'admin', name: 'Demo Admin', password: 'demo123' },
  'demo-sales': { role: 'sales', name: 'Demo Sales Exec', password: 'demo123' },
  'demo-partner': { role: 'partner', name: 'Demo Partner', password: 'demo123' },
}

// Returns the matched account ({ key, role, name, email }) or null.
export function matchDemoAccount(identifier, password) {
  if (!identifier) return null
  const key = identifier.trim().toLowerCase().replace('@cadieux.demo', '')
  const account = DEMO_ACCOUNTS[key]
  if (!account || account.password !== password) return null
  return { key, role: account.role, name: account.name, email: `${key}@cadieux.demo` }
}

// --- Demo session (localStorage flags) --------------------------------------
export function isDemoMode() {
  return typeof window !== 'undefined' && localStorage.getItem('demo_mode') === 'true'
}

export function setDemoSession(account) {
  if (typeof window === 'undefined') return
  localStorage.setItem('demo_mode', 'true')
  localStorage.setItem('demo_role', account.role)
  localStorage.setItem('demo_name', account.name)
  localStorage.setItem('demo_email', account.email)
}

export function clearDemoSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('demo_mode')
  localStorage.removeItem('demo_role')
  localStorage.removeItem('demo_name')
  localStorage.removeItem('demo_email')
}

// Builds the AuthContext user/profile objects from the stored demo flags.
// profile.id intentionally matches user.id so ProtectedRoute is satisfied.
export function getDemoAuth() {
  if (!isDemoMode()) return null
  const role = localStorage.getItem('demo_role')
  if (!role) return null
  const id = `demo-${role}-id`
  const email = localStorage.getItem('demo_email') || `demo-${role}@cadieux.demo`
  const name = localStorage.getItem('demo_name') || 'Demo User'
  return {
    user: { id, email },
    profile: { id, email, full_name: name, role, phone: '9876543200', status: 'active' },
    role,
  }
}

// Fires a toast in demo mode when a write action is attempted. Always returns
// false so callers can `return demoBlock()` from a write handler.
export function demoBlock(message = 'Not available in demo mode') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('demo:blocked', { detail: message }))
  }
  return false
}

// --- Static fake data --------------------------------------------------------
const DEMO_DATA = {
  // Admin overview
  overview: {
    partners: 12,
    activePartners: 8,
    totalSales: 347,
    totalRevenue: 48580,
    soldUnits: 1204,
    assignedUnits: 1850,
    topContributor: { name: 'Rahul Kumar', sold: 89, revenue: 12460 },
    partnerRankings: [
      { name: 'Rahul Kumar', assigned: 200, sold: 89, revenue: 12460 },
      { name: 'Priya Sharma', assigned: 180, sold: 72, revenue: 10080 },
      { name: 'Vikram Reddy', assigned: 150, sold: 58, revenue: 8120 },
      { name: 'Anita Das', assigned: 120, sold: 45, revenue: 6300 },
      { name: 'Suresh Patel', assigned: 100, sold: 38, revenue: 5320 },
    ],
    recentSales: [
      { customer: 'Mohan Rao', contact: '9876543210', units: 3, revenue: 420, date: '2026-06-01', partner: 'Rahul Kumar' },
      { customer: 'Lakshmi Devi', contact: '9876543211', units: 5, revenue: 700, date: '2026-06-01', partner: 'Priya Sharma' },
      { customer: 'Ravi Teja', contact: '9876543212', units: 2, revenue: 280, date: '2026-05-31', partner: 'Vikram Reddy' },
      { customer: 'Sita Ram', contact: '9876543213', units: 4, revenue: 560, date: '2026-05-30', partner: 'Anita Das' },
      { customer: 'Krishna Murthy', contact: '9876543214', units: 1, revenue: 140, date: '2026-05-30', partner: 'Suresh Patel' },
    ],
  },

  // Sales exec view
  sales: {
    mySales: 45,
    myRevenue: 6300,
    myAssigned: 80,
    myTarget: 100,
    leads: [
      { name: 'Arjun Reddy', phone: '9876543220', status: 'hot', notes: 'Interested in bulk order', date: '2026-06-02' },
      { name: 'Meera Iyer', phone: '9876543221', status: 'warm', notes: 'Wants monthly subscription', date: '2026-06-01' },
      { name: 'Deepak Sharma', phone: '9876543222', status: 'cold', notes: 'Called twice, no response', date: '2026-05-29' },
    ],
  },

  // Partner view
  partner: {
    name: 'Demo Partner',
    phone: '9876543230',
    totalSales: 28,
    totalRevenue: 3920,
    assigned: 50,
    done: 18,
    mySales: [
      { customer: 'Anil Kumar', contact: '9876543240', units: 3, revenue: 420, date: '2026-06-02' },
      { customer: 'Bharti Devi', contact: '9876543241', units: 2, revenue: 280, date: '2026-06-01' },
      { customer: 'Chandan Rao', contact: '9876543242', units: 5, revenue: 700, date: '2026-05-31' },
    ],
  },

  // Partners list (admin)
  partnersList: [
    { id: '1', full_name: 'Rahul Kumar', phone: '9876543201', phone_number: '9876543201', email: 'demo-rahul@cadieux.demo', role: 'partner', status: 'active', notes: 'Top performer', created_at: '2026-01-15' },
    { id: '2', full_name: 'Priya Sharma', phone: '9876543202', phone_number: '9876543202', email: 'demo-priya@cadieux.demo', role: 'partner', status: 'active', notes: 'Vizag south', created_at: '2026-02-01' },
    { id: '3', full_name: 'Vikram Reddy', phone: '9876543203', phone_number: '9876543203', email: 'demo-vikram@cadieux.demo', role: 'partner', status: 'active', notes: 'MVP district', created_at: '2026-03-10' },
    { id: '4', full_name: 'Anita Das', phone: '9876543204', phone_number: '9876543204', email: 'demo-anita@cadieux.demo', role: 'partner', status: 'inactive', notes: 'On leave', created_at: '2026-04-01' },
  ],

  // Sales exec list (admin)
  salesExecList: [
    { id: '1', full_name: 'Kiran Joshi', phone: '9876543210', phone_number: '9876543210', email: 'demo-kiran@cadieux.demo', role: 'sales', status: 'active', notes: 'Senior exec', created_at: '2026-01-01' },
    { id: '2', full_name: 'Nandini Rao', phone: '9876543211', phone_number: '9876543211', email: 'demo-nandini@cadieux.demo', role: 'sales', status: 'active', notes: 'New hire', created_at: '2026-05-01' },
  ],

  // Audit logs
  auditLogs: [
    { id: '1', action_type: 'CREATE', category: 'partner', user_name: 'Demo Admin', description: 'Created partner Rahul Kumar', created_at: '2026-06-02T10:30:00Z' },
    { id: '2', action_type: 'UPDATE', category: 'sale', user_name: 'Kiran Joshi', description: 'Updated sale #347', created_at: '2026-06-01T14:22:00Z' },
    { id: '3', action_type: 'LOGIN', category: 'auth', user_name: 'Demo Admin', description: 'Admin login', created_at: '2026-06-01T09:00:00Z' },
  ],

  // Change requests
  changeRequests: [
    { id: '1', requester_name: 'Rahul Kumar', requester_role: 'partner', request_type: 'phone', current_value: '9876543201', requested_value: '9876543299', status: 'pending', created_at: '2026-06-02T11:00:00Z' },
  ],

  // CTA alerts (delivery follow-ups)
  cta: [
    { sale_id: 'c1', trainer_id: '1', trainer_name: 'Rahul Kumar', trainer_contact: '9876543201', buyer_name: 'Mohan Rao', units_assigned: 10, units_sold: 6, retracted_units: 0, unsold_units: 4, date_of_assignment: '2026-06-02', days_since_assignment: 1 },
    { sale_id: 'c2', trainer_id: '2', trainer_name: 'Priya Sharma', trainer_contact: '9876543202', buyer_name: 'Lakshmi Devi', units_assigned: 8, units_sold: 2, retracted_units: 0, unsold_units: 6, date_of_assignment: '2026-05-29', days_since_assignment: 5 },
    { sale_id: 'c3', trainer_id: '3', trainer_name: 'Vikram Reddy', trainer_contact: '9876543203', buyer_name: 'Ravi Teja', units_assigned: 12, units_sold: 9, retracted_units: 0, unsold_units: 3, date_of_assignment: '2026-06-03', days_since_assignment: 0 },
  ],
}

// --- Page-shaped adapters ----------------------------------------------------
// These transform DEMO_DATA into the exact state shapes each page expects, so
// the rest of the page code (memos, tables, charts) works unchanged.

export function demoTrainers() {
  return DEMO_DATA.overview.partnerRankings.map((r, i) => ({
    id: String(i + 1),
    name: r.name,
    contact: DEMO_DATA.partnersList[i]?.phone || '',
    notes: DEMO_DATA.partnersList[i]?.notes || '',
    created_at: DEMO_DATA.partnersList[i]?.created_at || '2026-01-15',
  }))
}

export function demoRankings() {
  return DEMO_DATA.overview.partnerRankings.map((r, i) => ({
    trainer_id: String(i + 1),
    trainer_name: r.name,
    trainer_contact: DEMO_DATA.partnersList[i]?.phone || '',
    total_units_assigned: r.assigned,
    total_units_sold: r.sold,
    rank: i + 1,
  }))
}

export function demoPartnerSales() {
  return DEMO_DATA.partner.mySales.map((s, i) => ({
    id: `demo-sale-${i}`,
    buyer_name: s.customer,
    buyer_contact: s.contact,
    units_sold: s.units,
    units_assigned: s.units,
    picture_url: 'demo://picture',
    purchase_date: s.date,
    created_at: `${s.date}T10:00:00Z`,
    qr_code_url: null,
  }))
}

export function demoLeads() {
  const statusMap = { hot: 'new', warm: 'converted', cold: 'lost' }
  return DEMO_DATA.sales.leads.map((l, i) => ({
    id: `demo-lead-${i}`,
    buyer_name: l.name,
    buyer_contact: l.phone,
    status: statusMap[l.status] || 'new',
    trainer_id: String((i % DEMO_DATA.partnersList.length) + 1),
    trainers: { name: DEMO_DATA.partnersList[i % DEMO_DATA.partnersList.length].full_name, contact: l.phone },
    notes: l.notes,
    created_at: `${l.date}T10:00:00Z`,
  }))
}

export function demoLeadSales() {
  return DEMO_DATA.overview.recentSales.map((s, i) => ({
    id: `demo-lsale-${i}`,
    buyer_name: s.customer,
    buyer_contact: s.contact,
    units_assigned: s.units,
    units_sold: s.units,
    retracted_units: 0,
    date_of_assignment: s.date,
    created_at: `${s.date}T10:00:00Z`,
    trainer_id: String((i % DEMO_DATA.partnersList.length) + 1),
    trainers: { name: s.partner, contact: '' },
  }))
}

export function demoLeadTrainers() {
  return DEMO_DATA.partnersList.map((p) => ({
    id: p.id,
    name: p.full_name,
    contact: p.phone,
    email: p.email,
    notes: p.notes,
    created_at: p.created_at,
  }))
}

export function demoCtaPartners() {
  return DEMO_DATA.partnersList.map((p) => ({ id: p.id, name: p.full_name }))
}

export default DEMO_DATA

import { getAssignmentStatus, timeRemaining, shelfDays, sellDay } from './shelfLife.js'

// ============================================================================
// DEMO MODE
// ----------------------------------------------------------------------------
// Self-contained, hardcoded fake data + helpers for the read-only "demo mode".
// When a demo account is logged in, every page reads from DEMO_DATA below and
// NEVER queries the real Supabase database. Demo accounts also never
// authenticate against Supabase — see matchDemoAccount() / AuthContext.
// ============================================================================

// --- Product variants -------------------------------------------------------
// The two bread variants Cadieux sells. Used across the sales/assignment flow
// for per-variant tracking and analytics.
export const VARIANTS = {
  multigrain: { key: 'multigrain', name: 'Multi-Grain High Protein Bread', short: 'Multi-Grain', price: 149 },
  plain: { key: 'plain', name: 'Plain High Protein Bread', short: 'Plain', price: 109 },
}

// --- Demo accounts ----------------------------------------------------------
// Detected by the email pattern demo-<role>@cadieux.demo. Users can type either
// the short key (demo-admin) or the full email at the login screen.
export const DEMO_ACCOUNTS = {
  'demo-admin': { role: 'admin', name: 'Demo Admin', password: 'demo123' },
  'demo-sales': { role: 'sales', name: 'Demo Agent', password: 'demo123' },
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
    // Per-partner variant breakdown (drives the variant bar chart + table).
    // Column sums: MG assigned 200, MG sold 156, Plain assigned 150, Plain sold 98.
    partnerVariants: [
      { name: 'Rahul Kumar', mg_assigned: 50, mg_sold: 42, plain_assigned: 35, plain_sold: 24 },
      { name: 'Priya Sharma', mg_assigned: 45, mg_sold: 36, plain_assigned: 35, plain_sold: 22 },
      { name: 'Vikram Reddy', mg_assigned: 40, mg_sold: 32, plain_assigned: 30, plain_sold: 20 },
      { name: 'Anita Das', mg_assigned: 35, mg_sold: 26, plain_assigned: 28, plain_sold: 18 },
      { name: 'Suresh Patel', mg_assigned: 30, mg_sold: 20, plain_assigned: 22, plain_sold: 14 },
    ],
    // All-time per-partner performance for the scrollable Partner Performance
    // chart. Larger roster so vertical scroll is visible. Numbers are derived
    // from each partner's all-time sold + a small retraction count.
    partnerPerformance: [
      { name: 'Rahul Kumar',    mg_sold: 42, plain_sold: 24, mg_retracted: 1, plain_retracted: 1 },
      { name: 'Priya Sharma',   mg_sold: 36, plain_sold: 22, mg_retracted: 0, plain_retracted: 1 },
      { name: 'Vikram Reddy',   mg_sold: 32, plain_sold: 20, mg_retracted: 2, plain_retracted: 1 },
      { name: 'Anita Das',      mg_sold: 26, plain_sold: 18, mg_retracted: 1, plain_retracted: 2 },
      { name: 'Suresh Patel',   mg_sold: 20, plain_sold: 14, mg_retracted: 1, plain_retracted: 0 },
      { name: 'Meena Iyer',     mg_sold: 18, plain_sold: 13, mg_retracted: 0, plain_retracted: 1 },
      { name: 'Arjun Mehta',    mg_sold: 16, plain_sold: 11, mg_retracted: 1, plain_retracted: 0 },
      { name: 'Kavita Nair',    mg_sold: 14, plain_sold:  9, mg_retracted: 0, plain_retracted: 0 },
      { name: 'Naveen Pillai',  mg_sold: 12, plain_sold:  8, mg_retracted: 2, plain_retracted: 1 },
      { name: 'Sneha Hegde',    mg_sold:  9, plain_sold:  6, mg_retracted: 0, plain_retracted: 0 },
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

  // Partner view — per-variant assigned/sold so KPI breakdowns work.
  // MG assigned 30 / sold 18, Plain assigned 20 / sold 10.
  // Revenue = 18×149 + 10×109 = ₹3,772. Total sold = 28.
  partner: {
    name: 'Demo Partner',
    phone: '9876543230',
    totalSales: 28,
    totalRevenue: 3772,
    assigned: 50,
    done: 18,
    mySales: [
      { customer: 'Anil Kumar', contact: '9876543240', variant: 'multigrain', units: 8, mg_assigned: 15, plain_assigned: 0, date: '2026-06-02' },
      { customer: 'Bharti Devi', contact: '9876543241', variant: 'multigrain', units: 10, mg_assigned: 15, plain_assigned: 0, date: '2026-06-01' },
      { customer: 'Chandan Rao', contact: '9876543242', variant: 'plain', units: 10, mg_assigned: 0, plain_assigned: 20, date: '2026-05-31' },
    ],
  },

  // Partners list (admin). Per-partner totals come from the overview's
  // partnerVariants rows (assigned = mg+plain assigned, sold = mg+plain sold).
  // `retracted` is hand-curated for demo.
  partnersList: [
    { id: 'p1', full_name: 'Rahul Kumar', phone: '9876543201', phone_number: '9876543201', email: 'demo-rahul@cadieux.demo', role: 'partner', status: 'active', partner_type: 'stall_owner', notes: 'Top performer', created_at: '2026-01-15', assigned: 85, sold: 66, retracted: 2 },
    { id: 'p2', full_name: 'Priya Sharma', phone: '9876543202', phone_number: '9876543202', email: 'demo-priya@cadieux.demo', role: 'partner', status: 'active', partner_type: 'retailer', notes: 'Vizag south', created_at: '2026-02-01', assigned: 80, sold: 58, retracted: 1 },
    { id: 'p3', full_name: 'Vikram Reddy', phone: '9876543203', phone_number: '9876543203', email: 'demo-vikram@cadieux.demo', role: 'partner', status: 'inactive', partner_type: 'gated_community', notes: 'MVP district', created_at: '2026-03-10', assigned: 70, sold: 52, retracted: 3 },
    { id: 'p4', full_name: 'Anita Das', phone: '9876543204', phone_number: '9876543204', email: 'demo-anita@cadieux.demo', role: 'partner', status: 'active', partner_type: 'cafeteria', notes: 'Tech park canteen', created_at: '2026-04-01', assigned: 63, sold: 44, retracted: 4 },
    { id: 'p5', full_name: 'Suresh Patel', phone: '9876543205', phone_number: '9876543205', email: 'demo-suresh@cadieux.demo', role: 'partner', status: 'active', partner_type: 'stall_owner', notes: 'Beach road stall', created_at: '2026-04-12', assigned: 40, sold: 29, retracted: 1 },
    { id: 'p6', full_name: 'Meena Iyer', phone: '9876543206', phone_number: '9876543206', email: 'demo-meena@cadieux.demo', role: 'partner', status: 'active', partner_type: 'business_b2b', notes: 'Corporate orders', created_at: '2026-02-20', assigned: 26, sold: 18, retracted: 1 },
    { id: 'p7', full_name: 'Arjun Mehta', phone: '9876543207', phone_number: '9876543207', email: 'demo-arjun@cadieux.demo', role: 'partner', status: 'active', partner_type: 'retailer', notes: 'Kirana chain', created_at: '2026-03-25', assigned: 23, sold: 16, retracted: 0 },
    { id: 'p8', full_name: 'Kavita Nair', phone: '9876543208', phone_number: '9876543208', email: 'demo-kavita@cadieux.demo', role: 'partner', status: 'inactive', partner_type: 'gated_community', notes: 'Apartment association', created_at: '2026-01-30', assigned: 12, sold: 6, retracted: 0 },
  ],

  // Agent list (admin). partners = direct reports; assigned/closed = totals
  // across all their partners.
  salesExecList: [
    { id: 'a1', full_name: 'Kiran Joshi', phone: '9876543210', phone_number: '9876543210', email: 'demo-kiran@cadieux.demo', role: 'sales', status: 'active', notes: 'Senior exec', created_at: '2026-01-01', partners: 3, assigned: 235, closed: 176 },
    { id: 'a2', full_name: 'Nandini Rao', phone: '9876543211', phone_number: '9876543211', email: 'demo-nandini@cadieux.demo', role: 'sales', status: 'active', notes: 'New hire', created_at: '2026-05-01', partners: 2, assigned: 115, closed: 82 },
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
  return DEMO_DATA.partner.mySales.map((s, i) => {
    const variant = VARIANTS[s.variant] || VARIANTS.multigrain
    return {
      id: `demo-sale-${i}`,
      buyer_name: s.customer,
      buyer_contact: s.contact,
      units_sold: s.units,
      units_assigned: s.units,
      multigrain_assigned: s.mg_assigned || 0,
      plain_assigned: s.plain_assigned || 0,
      product_variant: variant.name,
      unit_price: variant.price,
      picture_url: 'demo://picture',
      purchase_date: s.date,
      created_at: `${s.date}T10:00:00Z`,
      qr_code_url: null,
    }
  })
}

// --- Variant analytics (admin) ----------------------------------------------
// Totals per variant: { multigrain: {assigned, sold, revenue}, plain: {...} }.
export function demoVariantTotals() {
  const rows = DEMO_DATA.overview.partnerVariants
  const sum = (k) => rows.reduce((acc, r) => acc + (r[k] || 0), 0)
  const mgSold = sum('mg_sold')
  const plainSold = sum('plain_sold')
  return {
    multigrain: {
      assigned: sum('mg_assigned'),
      sold: mgSold,
      revenue: mgSold * VARIANTS.multigrain.price,
    },
    plain: {
      assigned: sum('plain_assigned'),
      sold: plainSold,
      revenue: plainSold * VARIANTS.plain.price,
    },
  }
}

// Per-partner variant breakdown for the bar chart + detailed table.
export function demoVariantByPartner() {
  return DEMO_DATA.overview.partnerVariants.map((r) => ({
    partner: r.name,
    mg_assigned: r.mg_assigned,
    mg_sold: r.mg_sold,
    plain_assigned: r.plain_assigned,
    plain_sold: r.plain_sold,
    revenue: r.mg_sold * VARIANTS.multigrain.price + r.plain_sold * VARIANTS.plain.price,
  }))
}

// Scaling factor mapped from the Partner Performance date-range dropdown to
// how much of all-time data should be attributed to the selected window.
// `all` keeps numbers untouched; smaller ranges scale down deterministically.
export const RANGE_FACTOR = {
  today: 0.02,
  '7d': 0.08,
  '15d': 0.15,
  '30d': 0.25,
  month: 0.25,
  '2m': 0.40,
  '3m': 0.55,
  '6m': 0.80,
  year: 0.95,
  all: 1.0,
}

// Per-partner performance for the scrollable bar chart. Scales the all-time
// numbers in DEMO_DATA.overview.partnerPerformance by RANGE_FACTOR[range] and
// returns a tooltip-ready shape with per-variant breakdown + revenue.
export function demoPartnerPerformance(range = 'all') {
  const factor = RANGE_FACTOR[range] ?? 1.0
  const mgPrice = VARIANTS.multigrain.price
  const plPrice = VARIANTS.plain.price
  return DEMO_DATA.overview.partnerPerformance
    .map((p, i) => {
      const mg_sold = Math.round((p.mg_sold || 0) * factor)
      const plain_sold = Math.round((p.plain_sold || 0) * factor)
      const mg_retracted = Math.round((p.mg_retracted || 0) * factor)
      const plain_retracted = Math.round((p.plain_retracted || 0) * factor)
      return {
        id: String(i + 1),
        name: p.name,
        mg_sold,
        plain_sold,
        mg_retracted,
        plain_retracted,
        totalSold: mg_sold + plain_sold,
        totalRetracted: mg_retracted + plain_retracted,
        mg_revenue: mg_sold * mgPrice,
        plain_revenue: plain_sold * plPrice,
        totalRevenue: mg_sold * mgPrice + plain_sold * plPrice,
      }
    })
    .sort((a, b) => b.totalSold - a.totalSold)
}

// Variant sales over time. Returns evenly-spaced points across the range with
// a gently upward multi-grain trend and a flatter plain trend.
export function demoVariantTrend(range = '30d') {
  const config = {
    today: { points: 6, step: 0 },
    '7d': { points: 7, step: 1 },
    '15d': { points: 8, step: 2 },
    '30d': { points: 10, step: 3 },
    month: { points: 10, step: 3 },
    '2m': { points: 10, step: 6 },
    '3m': { points: 12, step: 7 },
    '6m': { points: 12, step: 15 },
    year: { points: 12, step: 30 },
    all: { points: 12, step: 30 },
  }[range] || { points: 10, step: 3 }

  const today = new Date('2026-06-03')
  const out = []
  for (let i = config.points - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i * config.step)
    const seed = config.points - i
    out.push({
      date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      multigrain: Math.round(9 + seed * 1.7 + (i % 3) * 1.5),
      plain: Math.round(6 + seed * 0.8 + ((i + 1) % 2) * 1.2),
    })
  }
  return out
}

export function demoLeads() {
  const statusMap = { hot: 'new', warm: 'converted', cold: 'lost' }
  return DEMO_DATA.sales.leads.map((l, i) => ({
    id: `demo-lead-${i}`,
    buyer_name: l.name,
    buyer_contact: l.phone,
    status: statusMap[l.status] || 'new',
    trainer_id: DEMO_DATA.partnersList[i % DEMO_DATA.partnersList.length].id,
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
    trainer_id: DEMO_DATA.partnersList[i % DEMO_DATA.partnersList.length].id,
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

// =========================================================================
// Drill-down records (Admin Overview clickable KPI cards)
// =========================================================================
// Hard-coded reference "today" so the demo data is deterministic.
const DEMO_TODAY = new Date('2026-06-03')

// Larger demo partner roster used by drill-down views. Indexed by `id`.
// Index aligns with DEMO_DATA.overview.partnerPerformance.
const DRILLDOWN_PARTNERS = [
  { id: 'p1',  name: 'Rahul Kumar',   phone: '9876543201', status: 'active',   partner_type: 'stall_owner',     joined_at: '2026-01-15' },
  { id: 'p2',  name: 'Priya Sharma',  phone: '9876543202', status: 'active',   partner_type: 'retailer',        joined_at: '2026-02-01' },
  { id: 'p3',  name: 'Vikram Reddy',  phone: '9876543203', status: 'inactive', partner_type: 'gated_community', joined_at: '2026-03-10' },
  { id: 'p4',  name: 'Anita Das',     phone: '9876543204', status: 'active',   partner_type: 'cafeteria',       joined_at: '2026-04-01' },
  { id: 'p5',  name: 'Suresh Patel',  phone: '9876543205', status: 'active',   partner_type: 'stall_owner',     joined_at: '2026-04-12' },
  { id: 'p6',  name: 'Meena Iyer',    phone: '9876543206', status: 'active',   partner_type: 'business_b2b',    joined_at: '2026-02-20' },
  { id: 'p7',  name: 'Arjun Mehta',   phone: '9876543207', status: 'active',   partner_type: 'retailer',        joined_at: '2026-03-25' },
  { id: 'p8',  name: 'Kavita Nair',   phone: '9876543208', status: 'inactive', partner_type: 'gated_community', joined_at: '2026-01-30' },
  { id: 'p9',  name: 'Naveen Pillai', phone: '9876543209', status: 'active',   partner_type: 'cafeteria',       joined_at: '2026-05-05' },
  { id: 'p10', name: 'Sneha Hegde',   phone: '9876543219', status: 'active',   partner_type: 'other',           joined_at: '2026-04-18' },
]

// Agent → partner mapping used by AgentProfilePage. Each agent now manages a
// varied mix of partner types so the per-type breakdown (FIX 6) is meaningful.
const DRILLDOWN_AGENTS = [
  { id: 'a1', name: 'Kiran Joshi',  phone: '9876543210', status: 'active', joined_at: '2026-01-01', partner_ids: ['p1', 'p2', 'p3', 'p6', 'p7'] },
  { id: 'a2', name: 'Nandini Rao', phone: '9876543211', status: 'active', joined_at: '2026-05-01', partner_ids: ['p4', 'p5', 'p8', 'p9', 'p10'] },
]

// Today's activity per agent — what their partners did today (demo).
const AGENT_TODAY_ACTIVITY = {
  a1: [
    { time: '09:15', partner_id: 'p1', partner_name: 'Rahul Kumar',  action: 'sold',     variant: 'multigrain', units: 3 },
    { time: '10:30', partner_id: 'p2', partner_name: 'Priya Sharma', action: 'sold',     variant: 'plain',      units: 5 },
    { time: '11:00', partner_id: 'p1', partner_name: 'Rahul Kumar',  action: 'assigned', variant: 'multigrain', units: 10 },
    { time: '13:45', partner_id: 'p3', partner_name: 'Vikram Reddy', action: 'retracted',variant: 'multigrain', units: 1 },
  ],
  a2: [
    { time: '08:45', partner_id: 'p4', partner_name: 'Anita Das',    action: 'sold',     variant: 'plain',      units: 4 },
    { time: '10:00', partner_id: 'p5', partner_name: 'Suresh Patel', action: 'sold',     variant: 'multigrain', units: 6 },
    { time: '14:30', partner_id: 'p5', partner_name: 'Suresh Patel', action: 'assigned', variant: 'plain',      units: 8 },
  ],
}

// Diversion records — what happened to unsold stock sent to non-standard channels.
// `diverted_to`: 'food_stalls' | 'b2b' | 'disposed' | 'other'
const AGENT_DIVERSIONS = [
  { id: 'div1', agent_id: 'a1', partner_id: 'p1', partner_name: 'Rahul Kumar',  variant: 'multigrain', units: 2, diverted_to: 'food_stalls', notes: 'Local food stall took day-end remainders', date: daysAgo(3) },
  { id: 'div2', agent_id: 'a1', partner_id: 'p2', partner_name: 'Priya Sharma', variant: 'plain',      units: 3, diverted_to: 'b2b',        notes: 'Sold to nearby café at reduced rate',   date: daysAgo(5) },
  { id: 'div3', agent_id: 'a1', partner_id: 'p3', partner_name: 'Vikram Reddy', variant: 'multigrain', units: 2, diverted_to: 'disposed',    notes: 'Expired — disposed per food safety SOP', date: daysAgo(7) },
  { id: 'div4', agent_id: 'a2', partner_id: 'p4', partner_name: 'Anita Das',    variant: 'plain',      units: 1, diverted_to: 'other',       notes: 'Partner kept samples for display',       date: daysAgo(2) },
  { id: 'div5', agent_id: 'a2', partner_id: 'p5', partner_name: 'Suresh Patel', variant: 'multigrain', units: 3, diverted_to: 'food_stalls', notes: 'End-of-week clearance at market',          date: daysAgo(9) },
]

// Remarks / notes left on a partner profile by admin or sales execs.
const PARTNER_REMARKS = [
  { id: 'rm1', partner_id: 'p1', author: 'Kiran Joshi', author_role: 'sales', text: 'Consistently the fastest seller in the north zone. Wants a higher weekly allocation.', date: daysAgo(2) },
  { id: 'rm2', partner_id: 'p1', author: 'Demo Admin',  author_role: 'admin', text: 'Approved 20% higher Multi-Grain allocation from next cycle.', date: daysAgo(6) },
  { id: 'rm3', partner_id: 'p2', author: 'Kiran Joshi', author_role: 'sales', text: 'Retail counter footfall is strong on weekends. Suggest weekend-heavy drops.', date: daysAgo(4) },
  { id: 'rm4', partner_id: 'p3', author: 'Nandini Rao', author_role: 'sales', text: 'Gated community gate pass expired — deliveries paused until renewed. Marked inactive.', date: daysAgo(8) },
  { id: 'rm5', partner_id: 'p4', author: 'Nandini Rao', author_role: 'sales', text: 'Cafeteria prefers Plain for the breakfast counter. Multi-Grain moves slower here.', date: daysAgo(5) },
  { id: 'rm6', partner_id: 'p5', author: 'Nandini Rao', author_role: 'sales', text: 'Beach-road stall does well in evenings. Keep stock fresh, short shelf window.', date: daysAgo(3) },
  { id: 'rm7', partner_id: 'p6', author: 'Kiran Joshi', author_role: 'sales', text: 'B2B corporate orders are bulk but infrequent. Coordinate drops with their HR calendar.', date: daysAgo(12) },
]

// Stall / retail supply log — units an agent pushed to food stalls / retail
// outlets directly (not via a partner sale). Agent profile section F.
const STALL_SUPPLIES = [
  { id: 'ss1', agent_id: 'a1', stall: 'Jagadamba Junction Stall', variant: 'multigrain', units: 12, source: 'p1', notes: 'Evening rush top-up', date: daysAgo(1) },
  { id: 'ss2', agent_id: 'a1', stall: 'RTC Complex Kiosk',        variant: 'plain',      units: 8,  source: 'p2', notes: 'Weekend clearance', date: daysAgo(4) },
  { id: 'ss3', agent_id: 'a1', stall: 'Beach Road Cart',          variant: 'multigrain', units: 6,  source: 'buffer', notes: 'From central buffer stock', date: daysAgo(9) },
  { id: 'ss4', agent_id: 'a2', stall: 'Gajuwaka Market Stall',    variant: 'plain',      units: 10, source: 'p5', notes: 'Near-expiry redirect', date: daysAgo(2) },
  { id: 'ss5', agent_id: 'a2', stall: 'MVP Colony Food Court',    variant: 'multigrain', units: 7,  source: 'p4', notes: 'Cafeteria surplus moved to court', date: daysAgo(6) },
]

// Helper — produce an ISO date string `daysAgo` days before DEMO_TODAY.
function daysAgo(n) {
  const d = new Date(DEMO_TODAY)
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// Helper — date-range filter. Returns true if `iso` falls within `range`.
function withinRange(iso, range) {
  if (range === 'all') return true
  const d = new Date(iso)
  const diff = (DEMO_TODAY - d) / 86400000
  switch (range) {
    case 'today':   return diff < 1
    case 'week':    return diff <= 7
    case 'month':   return diff <= 30
    case 'lastmonth': return diff > 30 && diff <= 60
    case '3m':      return diff <= 90
    case '6m':      return diff <= 180
    case 'year':    return diff <= 365
    default:        return true
  }
}

// --- Assignment records (Assigned KPI drill-down) ---------------------------
// Each row = one assignment event (partner received N units of each variant).
const ASSIGNMENTS = [
  { id: 'a1', partner_id: 'p1', mg: 25, plain: 15, date: daysAgo(2) },
  { id: 'a2', partner_id: 'p2', mg: 20, plain: 15, date: daysAgo(3) },
  { id: 'a3', partner_id: 'p3', mg: 18, plain: 12, date: daysAgo(5) },
  { id: 'a4', partner_id: 'p4', mg: 15, plain: 10, date: daysAgo(7) },
  { id: 'a5', partner_id: 'p1', mg: 25, plain: 20, date: daysAgo(10) },
  { id: 'a6', partner_id: 'p5', mg: 12, plain: 8, date: daysAgo(12) },
  { id: 'a7', partner_id: 'p2', mg: 25, plain: 20, date: daysAgo(15) },
  { id: 'a8', partner_id: 'p6', mg: 10, plain: 6, date: daysAgo(18) },
  { id: 'a9', partner_id: 'p3', mg: 22, plain: 18, date: daysAgo(22) },
  { id: 'a10', partner_id: 'p7', mg: 9, plain: 5, date: daysAgo(25) },
  { id: 'a11', partner_id: 'p4', mg: 20, plain: 18, date: daysAgo(30) },
  { id: 'a12', partner_id: 'p8', mg: 8, plain: 4, date: daysAgo(35) },
  { id: 'a13', partner_id: 'p9', mg: 7, plain: 4, date: daysAgo(42) },
  { id: 'a14', partner_id: 'p10', mg: 6, plain: 3, date: daysAgo(50) },
  { id: 'a15', partner_id: 'p5', mg: 18, plain: 14, date: daysAgo(65) },
  { id: 'a16', partner_id: 'p6', mg: 8, plain: 7, date: daysAgo(75) },
  { id: 'a17', partner_id: 'p7', mg: 7, plain: 6, date: daysAgo(95) },
  { id: 'a18', partner_id: 'p1', mg: 15, plain: 10, date: daysAgo(120) },
  { id: 'a19', partner_id: 'p2', mg: 12, plain: 8, date: daysAgo(160) },
  { id: 'a20', partner_id: 'p3', mg: 10, plain: 8, date: daysAgo(200) },
]

// --- Sale records (Sold KPI drill-down) -----------------------------------
// Each row = one sale (partner sold N units of variant on date to customer).
// `assigned_date` enables "days to sell" computation.
const SALES_RECORDS = [
  // Recent (last 7 days)
  { id: 's1', partner_id: 'p1', customer: 'Mohan Rao', contact: '9876500001', variant: 'multigrain', units: 3, date: daysAgo(0), assigned_date: daysAgo(2) },
  { id: 's2', partner_id: 'p2', customer: 'Lakshmi Devi', contact: '9876500002', variant: 'plain', units: 5, date: daysAgo(0), assigned_date: daysAgo(3) },
  { id: 's3', partner_id: 'p1', customer: 'Karthik Iyer', contact: '', variant: 'multigrain', units: 4, date: daysAgo(1), assigned_date: daysAgo(2) },
  { id: 's4', partner_id: 'p3', customer: 'Ravi Teja', contact: '9876500004', variant: 'multigrain', units: 2, date: daysAgo(2), assigned_date: daysAgo(5) },
  { id: 's5', partner_id: 'p4', customer: 'Sita Ram', contact: '', variant: 'plain', units: 4, date: daysAgo(3), assigned_date: daysAgo(7) },
  { id: 's6', partner_id: 'p5', customer: 'Krishna Murthy', contact: '9876500006', variant: 'multigrain', units: 6, date: daysAgo(3), assigned_date: daysAgo(12) },
  { id: 's7', partner_id: 'p2', customer: 'Ayesha Khan', contact: '9876500007', variant: 'multigrain', units: 8, date: daysAgo(4), assigned_date: daysAgo(3) },
  { id: 's8', partner_id: 'p1', customer: 'Deepak Joshi', contact: '', variant: 'plain', units: 3, date: daysAgo(5), assigned_date: daysAgo(10) },
  { id: 's9', partner_id: 'p6', customer: 'Nisha Kapoor', contact: '9876500009', variant: 'multigrain', units: 4, date: daysAgo(6), assigned_date: daysAgo(18) },
  { id: 's10', partner_id: 'p3', customer: 'Sunita Verma', contact: '9876500010', variant: 'plain', units: 5, date: daysAgo(7), assigned_date: daysAgo(5) },
  // Mid range (8–30 days)
  { id: 's11', partner_id: 'p2', customer: 'Rohit Mehra', contact: '9876500011', variant: 'multigrain', units: 7, date: daysAgo(9), assigned_date: daysAgo(15) },
  { id: 's12', partner_id: 'p7', customer: 'Asha Pillai', contact: '', variant: 'multigrain', units: 3, date: daysAgo(11), assigned_date: daysAgo(25) },
  { id: 's13', partner_id: 'p4', customer: 'Manoj Tiwari', contact: '9876500013', variant: 'plain', units: 4, date: daysAgo(13), assigned_date: daysAgo(7) },
  { id: 's14', partner_id: 'p5', customer: 'Geeta Nair', contact: '', variant: 'plain', units: 3, date: daysAgo(15), assigned_date: daysAgo(12) },
  { id: 's15', partner_id: 'p1', customer: 'Vishal Goel', contact: '9876500015', variant: 'multigrain', units: 6, date: daysAgo(17), assigned_date: daysAgo(10) },
  { id: 's16', partner_id: 'p8', customer: 'Pooja Shah', contact: '9876500016', variant: 'multigrain', units: 2, date: daysAgo(19), assigned_date: daysAgo(35) },
  { id: 's17', partner_id: 'p3', customer: 'Arvind Rao', contact: '', variant: 'multigrain', units: 5, date: daysAgo(22), assigned_date: daysAgo(22) },
  { id: 's18', partner_id: 'p2', customer: 'Divya Menon', contact: '9876500018', variant: 'plain', units: 6, date: daysAgo(24), assigned_date: daysAgo(15) },
  { id: 's19', partner_id: 'p6', customer: 'Sanjay Bhatt', contact: '9876500019', variant: 'plain', units: 3, date: daysAgo(26), assigned_date: daysAgo(18) },
  { id: 's20', partner_id: 'p4', customer: 'Rekha Yadav', contact: '', variant: 'multigrain', units: 5, date: daysAgo(28), assigned_date: daysAgo(30) },
  // Older (31–180 days)
  { id: 's21', partner_id: 'p1', customer: 'Tanvi Saha', contact: '9876500021', variant: 'multigrain', units: 8, date: daysAgo(35), assigned_date: daysAgo(120) },
  { id: 's22', partner_id: 'p5', customer: 'Imran Sheikh', contact: '', variant: 'plain', units: 4, date: daysAgo(42), assigned_date: daysAgo(65) },
  { id: 's23', partner_id: 'p2', customer: 'Neha Kulkarni', contact: '9876500023', variant: 'multigrain', units: 6, date: daysAgo(48), assigned_date: daysAgo(160) },
  { id: 's24', partner_id: 'p7', customer: 'Aditya Bose', contact: '9876500024', variant: 'plain', units: 2, date: daysAgo(55), assigned_date: daysAgo(95) },
  { id: 's25', partner_id: 'p3', customer: 'Shruti Pandit', contact: '', variant: 'multigrain', units: 5, date: daysAgo(70), assigned_date: daysAgo(200) },
  { id: 's26', partner_id: 'p9', customer: 'Vivek Choudhary', contact: '9876500026', variant: 'multigrain', units: 3, date: daysAgo(85), assigned_date: daysAgo(42) },
  { id: 's27', partner_id: 'p6', customer: 'Anjali Ravi', contact: '9876500027', variant: 'multigrain', units: 4, date: daysAgo(105), assigned_date: daysAgo(75) },
  { id: 's28', partner_id: 'p1', customer: 'Harish Naidu', contact: '', variant: 'plain', units: 5, date: daysAgo(130), assigned_date: daysAgo(120) },
  { id: 's29', partner_id: 'p10', customer: 'Komal Pawar', contact: '9876500029', variant: 'plain', units: 3, date: daysAgo(160), assigned_date: daysAgo(50) },
  { id: 's30', partner_id: 'p4', customer: 'Mahesh Acharya', contact: '9876500030', variant: 'multigrain', units: 6, date: daysAgo(220), assigned_date: daysAgo(30) },
  { id: 's31', partner_id: 'p2', customer: 'Reema D\'Souza', contact: '', variant: 'plain', units: 4, date: daysAgo(280), assigned_date: daysAgo(160) },
  { id: 's32', partner_id: 'p3', customer: 'Akash Sinha', contact: '9876500032', variant: 'multigrain', units: 7, date: daysAgo(340), assigned_date: daysAgo(200) },
]

// --- Attribution records (Attributed KPI drill-down) ------------------------
// Each row = one return/retract event. Reason is one of:
// 'damaged' | 'expired' | 'customer_return' | 'unsold' | 'other'.
const ATTRIBUTIONS = [
  { id: 'r1', partner_id: 'p1', variant: 'multigrain', units: 1, reason: 'damaged', diverted_to: 'disposed', notes: 'Package torn during transit', attributed_by: 'Kiran Joshi', date: daysAgo(1) },
  { id: 'r2', partner_id: 'p2', variant: 'plain', units: 1, reason: 'customer_return', diverted_to: 'food_stalls', notes: 'Customer changed mind after delivery', attributed_by: 'Kiran Joshi', date: daysAgo(3) },
  { id: 'r3', partner_id: 'p3', variant: 'multigrain', units: 2, reason: 'expired', diverted_to: 'disposed', notes: 'Past best-before date', attributed_by: 'Nandini Rao', date: daysAgo(6) },
  { id: 'r4', partner_id: 'p4', variant: 'plain', units: 2, reason: 'unsold', diverted_to: 'b2b', notes: 'Did not move from partner shelf in 21 days', attributed_by: 'Kiran Joshi', date: daysAgo(10) },
  { id: 'r5', partner_id: 'p1', variant: 'multigrain', units: 1, reason: 'damaged', diverted_to: 'disposed', notes: 'Wet during rain', attributed_by: 'Nandini Rao', date: daysAgo(14) },
  { id: 'r6', partner_id: 'p5', variant: 'plain', units: 1, reason: 'customer_return', diverted_to: 'food_stalls', notes: 'Wrong variant — wanted Multi-Grain', attributed_by: 'Kiran Joshi', date: daysAgo(20) },
  { id: 'r7', partner_id: 'p6', variant: 'multigrain', units: 1, reason: 'other', diverted_to: 'other', notes: 'Sample for partner training', attributed_by: 'Nandini Rao', date: daysAgo(35) },
  { id: 'r8', partner_id: 'p2', variant: 'plain', units: 2, reason: 'unsold', diverted_to: 'food_stalls', notes: 'Cleared to weekend market stall', attributed_by: 'Kiran Joshi', date: daysAgo(48) },
  { id: 'r9', partner_id: 'p3', variant: 'plain', units: 1, reason: 'expired', diverted_to: 'disposed', notes: 'Stock rotation cleanup', attributed_by: 'Nandini Rao', date: daysAgo(72) },
  { id: 'r10', partner_id: 'p7', variant: 'multigrain', units: 1, reason: 'damaged', diverted_to: 'disposed', notes: 'Crushed in handling', attributed_by: 'Kiran Joshi', date: daysAgo(95) },
  { id: 'r11', partner_id: 'p1', variant: 'plain', units: 1, reason: 'customer_return', diverted_to: 'b2b', notes: 'Reported off taste — moved to café', attributed_by: 'Nandini Rao', date: daysAgo(140) },
  { id: 'r12', partner_id: 'p4', variant: 'multigrain', units: 1, reason: 'unsold', diverted_to: 'food_stalls', notes: '', attributed_by: 'Kiran Joshi', date: daysAgo(210) },
]

const REASON_LABELS = {
  damaged: 'Damaged',
  expired: 'Expired',
  customer_return: 'Customer Return',
  unsold: 'Unsold',
  other: 'Other',
}

// --- Date-range constant for drill-downs ------------------------------------
export const DRILLDOWN_RANGES = [
  { value: 'today',     label: 'Today' },
  { value: 'week',      label: 'This Week' },
  { value: 'month',     label: 'This Month' },
  { value: 'lastmonth', label: 'Last Month' },
  { value: '3m',        label: 'Last 3 Months' },
  { value: '6m',        label: 'Last 6 Months' },
  { value: 'year',      label: '1 Year' },
  { value: 'all',       label: 'Overall' },
]

export const ATTRIBUTION_REASONS = [
  { value: 'damaged',         label: 'Damaged' },
  { value: 'expired',         label: 'Expired' },
  { value: 'customer_return', label: 'Customer Return' },
  { value: 'unsold',          label: 'Unsold' },
  { value: 'other',           label: 'Other' },
]

export const DIVERSION_REASONS = [
  { value: 'food_stalls', label: 'Food Stalls' },
  { value: 'b2b',         label: 'B2B Channels' },
  { value: 'disposed',    label: 'Disposed' },
  { value: 'other',       label: 'Other' },
]

// --- Partner types / categories ---------------------------------------------
// What kind of outlet a partner runs. Drives the type badge on the partner
// profile, the type column + filter in the Partners list, and the per-type
// breakdown on the agent profile.
export const PARTNER_TYPES = [
  { value: 'retailer',       label: 'Retailer' },
  { value: 'bulk_vendor',    label: 'Bulk Vendor' },
  { value: 'canteen_vendor', label: 'Canteen Vendor' },
  { value: 'stalls',         label: 'Stalls' },
  { value: 'residential',    label: 'Residential' },
]

// Legacy type values still present on older rows — kept for display only so
// existing partners keep a readable label/pill. Not offered in the selector.
const LEGACY_PARTNER_TYPE_LABELS = {
  stall_owner:     'Stall Owner',
  gated_community: 'Gated Community',
  cafeteria:       'Cafeteria',
  business_b2b:    'Business / B2B',
  other:           'Other',
}

export const PARTNER_TYPE_LABELS = {
  ...LEGACY_PARTNER_TYPE_LABELS,
  ...Object.fromEntries(PARTNER_TYPES.map((t) => [t.value, t.label])),
}

// Tailwind pill classes per partner type (dark theme).
export const PARTNER_TYPE_PILL = {
  retailer:        'border-indigo-400/30 bg-indigo-400/10 text-indigo-200',
  bulk_vendor:     'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  canteen_vendor:  'border-amber-400/30 bg-amber-400/10 text-amber-200',
  stalls:          'border-sky-400/30 bg-sky-400/10 text-sky-200',
  residential:     'border-violet-400/30 bg-violet-400/10 text-violet-200',
  // legacy
  stall_owner:     'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  gated_community: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  cafeteria:       'border-amber-400/30 bg-amber-400/10 text-amber-200',
  business_b2b:    'border-blue-400/30 bg-blue-400/10 text-blue-200',
  other:           'border-slate-500/30 bg-slate-500/10 text-slate-300',
}

// --- Drill-down adapters ----------------------------------------------------

// Returns the drill-down partner list with totals (sold / attributed / status).
export function demoDrilldownPartners() {
  return DRILLDOWN_PARTNERS.map((p) => {
    const sold = SALES_RECORDS
      .filter((s) => s.partner_id === p.id)
      .reduce((acc, s) => acc + s.units, 0)
    const attributed = ATTRIBUTIONS
      .filter((r) => r.partner_id === p.id)
      .reduce((acc, r) => acc + r.units, 0)
    return { id: p.id, name: p.name, phone: p.phone, status: p.status, sold, attributed }
  })
}

// Filters demo assignments by `range` and `variant` ('all' | 'multigrain' | 'plain').
export function demoAssignments({ range = 'all', variant = 'all' } = {}) {
  const nameById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p.name]))
  return ASSIGNMENTS
    .filter((a) => withinRange(a.date, range))
    .map((a) => {
      let mg = a.mg
      let plain = a.plain
      if (variant === 'multigrain') plain = 0
      if (variant === 'plain') mg = 0
      return {
        id: a.id,
        partner_id: a.partner_id,
        partner_name: nameById[a.partner_id] || 'Unknown',
        multigrain_assigned: mg,
        plain_assigned: plain,
        total: mg + plain,
        date_assigned: a.date,
      }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => new Date(b.date_assigned) - new Date(a.date_assigned))
}

// Filters demo sales records by range, variant, partner.
export function demoSalesRecords({ range = 'all', variant = 'all', partnerId = 'all' } = {}) {
  const nameById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p.name]))
  return SALES_RECORDS
    .filter((s) => withinRange(s.date, range))
    .filter((s) => variant === 'all' || s.variant === variant)
    .filter((s) => partnerId === 'all' || s.partner_id === partnerId)
    .map((s) => {
      const v = VARIANTS[s.variant] || VARIANTS.multigrain
      const daysToSell = Math.max(0, Math.round(
        (new Date(s.date) - new Date(s.assigned_date)) / 86400000,
      ))
      return {
        id: s.id,
        date: s.date,
        partner_id: s.partner_id,
        partner_name: nameById[s.partner_id] || 'Unknown',
        customer: s.customer,
        variant: s.variant,
        variant_label: v.short,
        units: s.units,
        revenue: s.units * v.price,
        days_to_sell: daysToSell,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

// Filters demo attribution records by range, variant, partner, reason.
export function demoAttributions({ range = 'all', variant = 'all', partnerId = 'all', reason = 'all' } = {}) {
  const nameById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p.name]))
  return ATTRIBUTIONS
    .filter((r) => withinRange(r.date, range))
    .filter((r) => variant === 'all' || r.variant === variant)
    .filter((r) => partnerId === 'all' || r.partner_id === partnerId)
    .filter((r) => reason === 'all' || r.reason === reason)
    .map((r) => {
      const v = VARIANTS[r.variant] || VARIANTS.multigrain
      return {
        id: r.id,
        date: r.date,
        partner_id: r.partner_id,
        partner_name: nameById[r.partner_id] || 'Unknown',
        variant: r.variant,
        variant_label: v.short,
        units: r.units,
        reason: r.reason,
        reason_label: REASON_LABELS[r.reason] || r.reason,
        notes: r.notes,
        attributed_by: r.attributed_by,
        loss_value: r.units * v.price,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

// Roll-up totals used by the KPI cards. Filtered by date range only.
export function demoDrilldownTotals({ range = 'all' } = {}) {
  const assigned = demoAssignments({ range }).reduce((s, a) => s + a.total, 0)
  const sold = demoSalesRecords({ range }).reduce((s, r) => s + r.units, 0)
  const attributed = demoAttributions({ range }).reduce((s, r) => s + r.units, 0)
  const partners = DRILLDOWN_PARTNERS.length
  const activePartners = DRILLDOWN_PARTNERS.filter((p) => p.status === 'active').length
  return { assigned, sold, attributed, partners, activePartners }
}

// Returns the partner list used by drill-down dropdowns.
export function demoDrilldownPartnerOptions() {
  return DRILLDOWN_PARTNERS.map((p) => ({ value: p.id, label: p.name }))
}

// =========================================================================
// Partner profile / variant detail extras
// =========================================================================

// Full partner profile data for `/admin/partner/:id`. Aggregates
// assignments + sales + attributions and computes per-variant rollups.
export function demoPartnerProfile(partnerId, { range = 'all' } = {}) {
  const partner = DRILLDOWN_PARTNERS.find((p) => p.id === partnerId)
  if (!partner) return null

  const sales = SALES_RECORDS.filter((s) => s.partner_id === partnerId && withinRange(s.date, range))
  const assigns = ASSIGNMENTS.filter((a) => a.partner_id === partnerId && withinRange(a.date, range))
  const attrs   = ATTRIBUTIONS.filter((r) => r.partner_id === partnerId && withinRange(r.date, range))

  const variantRow = (key) => {
    const variantKey = key === 'multigrain' ? 'multigrain' : 'plain'
    const variantPrice = VARIANTS[variantKey].price
    const assigned = assigns.reduce((s, a) => s + (variantKey === 'multigrain' ? a.mg : a.plain), 0)
    const sold      = sales.filter((s) => s.variant === variantKey).reduce((s, r) => s + r.units, 0)
    const retracted = attrs.filter((r) => r.variant === variantKey).reduce((s, r) => s + r.units, 0)
    const left      = Math.max(0, assigned - sold - retracted)
    return {
      key: variantKey,
      label: VARIANTS[variantKey].short,
      price: variantPrice,
      assigned,
      sold,
      retracted,
      left,
      revenue: sold * variantPrice,
      sellThrough: assigned > 0 ? (sold / assigned) * 100 : 0,
    }
  }

  const mg    = variantRow('multigrain')
  const plain = variantRow('plain')

  const salesHistory = sales
    .map((s) => {
      const v = VARIANTS[s.variant] || VARIANTS.multigrain
      const days = Math.max(0, Math.round((new Date(s.date) - new Date(s.assigned_date)) / 86400000))
      return {
        id: s.id,
        date: s.date,
        variant: s.variant,
        variant_label: v.short,
        units: s.units,
        revenue: s.units * v.price,
        customer: s.customer,
        contact: s.contact || '',
        days_to_sell: days,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const attributionHistory = attrs
    .map((r) => {
      const v = VARIANTS[r.variant] || VARIANTS.multigrain
      return {
        id: r.id,
        date: r.date,
        variant: r.variant,
        variant_label: v.short,
        units: r.units,
        reason: r.reason,
        reason_label: REASON_LABELS[r.reason] || r.reason,
        diverted_to: r.diverted_to || 'other',
        notes: r.notes,
        attributed_by: r.attributed_by,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // Selling speed — per-variant avg days receive→sell + fastest/slowest +
  // distribution of how quickly stock sold (within 1 / 2 / 3+ days).
  const speedFor = (variantKey) => {
    const rows = salesHistory.filter((s) => s.variant === variantKey)
    if (rows.length === 0) return { variant: variantKey, label: VARIANTS[variantKey].short, count: 0, avg: 0, fastest: 0, slowest: 0 }
    const days = rows.map((r) => r.days_to_sell)
    return {
      variant: variantKey,
      label: VARIANTS[variantKey].short,
      count: rows.length,
      avg: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
      fastest: Math.min(...days),
      slowest: Math.max(...days),
    }
  }
  const within = (lo, hi) => salesHistory.filter((s) => s.days_to_sell >= lo && (hi == null || s.days_to_sell < hi)).length

  // Per-day sell breakdown: how many units of each variant sold on shelf-day
  // 1..N (where N is that variant's shelf life). Drives the "SELL SPEED
  // BREAKDOWN" bars + average sell-time on the partner profile.
  const dayBreakdownFor = (variantKey) => {
    const total = shelfDays(variantKey)
    const buckets = Array.from({ length: total }, (_, i) => ({ day: i + 1, units: 0 }))
    let unitsSum = 0
    let weighted = 0
    for (const s of sales) {
      if (s.variant !== variantKey) continue
      const d = Math.min(sellDay(s.assigned_date, s.date), total)
      buckets[d - 1].units += s.units
      unitsSum += s.units
      weighted += d * s.units
    }
    return {
      totalDays: total,
      totalUnits: unitsSum,
      avgSellDay: unitsSum > 0 ? Math.round((weighted / unitsSum) * 10) / 10 : 0,
      days: buckets.map((b) => ({
        ...b,
        pct: unitsSum > 0 ? Math.round((b.units / unitsSum) * 100) : 0,
      })),
    }
  }

  const sellingSpeed = {
    multigrain: speedFor('multigrain'),
    plain: speedFor('plain'),
    distribution: {
      total: salesHistory.length,
      within1: within(0, 2),     // 0–1 days
      within2: within(2, 3),     // 2 days
      within3plus: within(3, null), // 3+ days
    },
    byDay: {
      multigrain: dayBreakdownFor('multigrain'),
      plain: dayBreakdownFor('plain'),
    },
  }

  // Customer log — one row per sale, with unique-customer + phone-coverage counts.
  const customers = salesHistory.map((s) => ({
    id: s.id,
    name: s.customer,
    contact: s.contact,
    variant: s.variant,
    variant_label: s.variant_label,
    units: s.units,
    revenue: s.revenue,
    date: s.date,
  }))
  const uniqueCustomers = new Set(customers.map((c) => c.name.toLowerCase())).size
  const withPhone = customers.filter((c) => c.contact).length
  const customerStats = {
    unique: uniqueCustomers,
    withPhone,
    withoutPhone: customers.length - withPhone,
  }

  // Remarks — newest first. Always returned (range-independent dossier note).
  const remarks = PARTNER_REMARKS
    .filter((r) => r.partner_id === partnerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // Monthly performance buckets: last 12 months of activity.
  const monthly = buildMonthlySeries(sales)

  // Join date — prefer the partner's recorded join date, else earliest assignment.
  const allAssigns = ASSIGNMENTS.filter((a) => a.partner_id === partnerId)
  const joined = partner.joined_at || (allAssigns.length
    ? allAssigns.map((a) => a.date).sort()[0]
    : null)

  return {
    id: partner.id,
    name: partner.name,
    phone: partner.phone,
    status: partner.status,
    partner_type: partner.partner_type || 'other',
    joined_at: joined,
    variants: { multigrain: mg, plain: plain },
    totals: {
      assigned: mg.assigned + plain.assigned,
      sold: mg.sold + plain.sold,
      retracted: mg.retracted + plain.retracted,
      revenue: mg.revenue + plain.revenue,
    },
    sellingSpeed,
    customers,
    customerStats,
    remarks,
    salesHistory,
    attributionHistory,
    monthly,
  }
}

// Build a 12-month {date, multigrain, plain} series ending at DEMO_TODAY.
function buildMonthlySeries(salesRows) {
  const months = []
  const ref = new Date(DEMO_TODAY)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      multigrain: 0,
      plain: 0,
    })
  }
  const byKey = Object.fromEntries(months.map((m) => [m.key, m]))
  for (const s of salesRows) {
    const d = new Date(s.date)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (byKey[k]) byKey[k][s.variant] += s.units
  }
  return months
}

// Variant detail aggregate for `/admin/overview/variant/:variantName`.
// Joins partners, sales, attributions for the given variant, scoped to
// the selected range. Used by VariantDetail.jsx.
export function demoVariantDetail(variantKey, { range = 'all' } = {}) {
  const variant = VARIANTS[variantKey]
  if (!variant) return null

  const sales = SALES_RECORDS.filter((s) => s.variant === variantKey && withinRange(s.date, range))
  const attrs = ATTRIBUTIONS.filter((r) => r.variant === variantKey && withinRange(r.date, range))
  const assigns = ASSIGNMENTS.filter((a) => withinRange(a.date, range))

  const assigned = assigns.reduce(
    (s, a) => s + (variantKey === 'multigrain' ? a.mg : a.plain),
    0,
  )
  const sold = sales.reduce((s, r) => s + r.units, 0)
  const retracted = attrs.reduce((s, r) => s + r.units, 0)
  const revenue = sold * variant.price
  const sellThrough = assigned > 0 ? (sold / assigned) * 100 : 0

  // First-assignment date for "days in market".
  const firstDate = ASSIGNMENTS
    .filter((a) => (variantKey === 'multigrain' ? a.mg : a.plain) > 0)
    .map((a) => a.date)
    .sort()[0]
  const daysInMarket = firstDate
    ? Math.max(0, Math.round((DEMO_TODAY - new Date(firstDate)) / 86400000))
    : 0

  // Per-partner rollup.
  const nameById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p.name]))
  const partnerMap = {}
  for (const a of assigns) {
    if (!partnerMap[a.partner_id]) {
      partnerMap[a.partner_id] = {
        partner_id: a.partner_id,
        partner_name: nameById[a.partner_id] || 'Unknown',
        assigned: 0, sold: 0, retracted: 0,
      }
    }
    partnerMap[a.partner_id].assigned += (variantKey === 'multigrain' ? a.mg : a.plain)
  }
  for (const s of sales) {
    if (!partnerMap[s.partner_id]) {
      partnerMap[s.partner_id] = {
        partner_id: s.partner_id,
        partner_name: nameById[s.partner_id] || 'Unknown',
        assigned: 0, sold: 0, retracted: 0,
      }
    }
    partnerMap[s.partner_id].sold += s.units
  }
  for (const r of attrs) {
    if (!partnerMap[r.partner_id]) {
      partnerMap[r.partner_id] = {
        partner_id: r.partner_id,
        partner_name: nameById[r.partner_id] || 'Unknown',
        assigned: 0, sold: 0, retracted: 0,
      }
    }
    partnerMap[r.partner_id].retracted += r.units
  }
  const topPartners = Object.values(partnerMap)
    .map((p) => ({
      ...p,
      revenue: p.sold * variant.price,
      sellThrough: p.assigned > 0 ? (p.sold / p.assigned) * 100 : 0,
    }))
    .sort((a, b) => b.sold - a.sold)

  // Reason breakdown for this variant.
  const reasonCounts = {}
  for (const r of attrs) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + r.units

  // Monthly sales series.
  const monthly = buildMonthlySeries(sales)

  // Recent 20 sales for this variant.
  const recentSales = sales
    .map((s) => ({
      id: s.id,
      date: s.date,
      partner_id: s.partner_id,
      partner_name: nameById[s.partner_id] || 'Unknown',
      customer: s.customer,
      units: s.units,
      revenue: s.units * variant.price,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20)

  return {
    key: variantKey,
    name: variant.name,
    short: variant.short,
    price: variant.price,
    totals: { assigned, sold, retracted, revenue, sellThrough, daysInMarket },
    topPartners,
    reasonCounts,
    monthly,
    recentSales,
  }
}

// =========================================================================
// CTA — shelf-life-aware assignment rows
// =========================================================================
// Each row = one (partner, variant) assignment with units remaining.
// Dates chosen so DEMO_TODAY (Jun 3) spreads across all 4 status buckets:
//   daysAgo(0-1) → multigrain active (48-72h left), plain active
//   daysAgo(2)   → multigrain expiring_soon (24h left), plain active
//   daysAgo(3)   → multigrain expired, plain active
//   daysAgo(5)   → multigrain expired, plain expiring_soon (24h left)
//   daysAgo(7+)  → both expired
const CTA_ASSIGNMENTS = [
  // Active — multigrain
  { id: 'ca1', partner_id: 'p1', variant: 'multigrain', assigned: 10, sold: 3, date: daysAgo(0), sold_date: daysAgo(0) },
  { id: 'ca2', partner_id: 'p2', variant: 'multigrain', assigned:  8, sold: 2, date: daysAgo(1), sold_date: daysAgo(0) },
  // Active — plain
  { id: 'ca3', partner_id: 'p3', variant: 'plain',      assigned: 12, sold: 5, date: daysAgo(1), sold_date: daysAgo(0) },
  { id: 'ca4', partner_id: 'p4', variant: 'plain',      assigned: 10, sold: 4, date: daysAgo(3), sold_date: daysAgo(0) },
  // Expiring soon — multigrain (2 days elapsed → ~24h left)
  { id: 'ca5', partner_id: 'p5', variant: 'multigrain', assigned:  6, sold: 1, date: daysAgo(2) },
  { id: 'ca6', partner_id: 'p6', variant: 'multigrain', assigned:  9, sold: 3, date: daysAgo(2) },
  // Expiring soon — plain (5 days elapsed → ~24h left)
  { id: 'ca7', partner_id: 'p1', variant: 'plain',      assigned:  8, sold: 2, date: daysAgo(5) },
  // Expired/Unsold — multigrain (4-5 days ago)
  { id: 'ca8', partner_id: 'p7', variant: 'multigrain', assigned:  7, sold: 1, date: daysAgo(4) },
  { id: 'ca9', partner_id: 'p8', variant: 'multigrain', assigned:  5, sold: 0, date: daysAgo(5) },
  // Expired/Unsold — plain (7-8 days ago)
  { id: 'ca10', partner_id: 'p2', variant: 'plain',     assigned:  9, sold: 3, date: daysAgo(7) },
  { id: 'ca11', partner_id: 'p9', variant: 'plain',     assigned:  6, sold: 2, date: daysAgo(8) },
]

/**
 * Returns flat CTA rows for demo mode, with status + hours_remaining
 * pre-computed relative to DEMO_TODAY.
 */
export function demoCTAData() {
  const partnerById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p]))
  return CTA_ASSIGNMENTS.map((a) => {
    const partner = partnerById[a.partner_id] || { name: 'Unknown', phone: '' }
    const remaining = timeRemaining(a.variant, a.date, DEMO_TODAY)
    const status = getAssignmentStatus(a.variant, a.date, DEMO_TODAY)
    return {
      id: a.id,
      partner_id: a.partner_id,
      partner_name: partner.name,
      partner_phone: partner.phone,
      variant: a.variant,
      variant_label: VARIANTS[a.variant]?.short || a.variant,
      assigned_date: a.date,
      sold_date: a.sold_date || null,
      units_assigned: a.assigned,
      units_sold: a.sold,
      units_remaining: a.assigned - a.sold,
      status,
      hours_remaining: remaining,
    }
  })
}

/**
 * Returns recent retraction rows (last 30 days) for CTA "Retracted" section.
 */
export function demoCTARetractions() {
  const partnerById = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p]))
  return ATTRIBUTIONS
    .filter((r) => withinRange(r.date, 'month'))
    .map((r) => {
      const partner = partnerById[r.partner_id] || { name: 'Unknown', phone: '' }
      return {
        id: r.id,
        partner_id: r.partner_id,
        partner_name: partner.name,
        partner_phone: partner.phone,
        variant: r.variant,
        variant_label: VARIANTS[r.variant]?.short || r.variant,
        units: r.units,
        reason: r.reason,
        reason_label: REASON_LABELS[r.reason] || r.reason,
        date: r.date,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

// =========================================================================
// Agent profile  —  /admin/agent/:id
// =========================================================================

export function demoAgentOptions() {
  return DRILLDOWN_AGENTS.map((a) => ({ value: a.id, label: a.name }))
}

export function demoAgentProfile(agentId, { range = 'all' } = {}) {
  const agent = DRILLDOWN_AGENTS.find((a) => a.id === agentId)
  if (!agent) return null

  const partnerIds = agent.partner_ids
  const nameById   = Object.fromEntries(DRILLDOWN_PARTNERS.map((p) => [p.id, p]))

  const sales   = SALES_RECORDS.filter((s) => partnerIds.includes(s.partner_id) && withinRange(s.date, range))
  const assigns = ASSIGNMENTS.filter((a) => partnerIds.includes(a.partner_id) && withinRange(a.date, range))
  const attrs   = ATTRIBUTIONS.filter((r) => partnerIds.includes(r.partner_id) && withinRange(r.date, range))

  // KPI totals
  const totalAssigned  = assigns.reduce((s, a) => s + a.mg + a.plain, 0)
  const totalSold      = sales.reduce((s, r) => s + r.units, 0)
  const totalRetracted = attrs.reduce((s, r) => s + r.units, 0)
  const totalRevenue   = sales.reduce((s, r) => s + r.units * (VARIANTS[r.variant]?.price || 0), 0)

  // Per-partner performance table
  const partnerPerformance = partnerIds.map((pid) => {
    const partner  = nameById[pid]
    if (!partner) return null
    const pSales   = sales.filter((s) => s.partner_id === pid)
    const pAssigns = assigns.filter((a) => a.partner_id === pid)
    const pAttrs   = attrs.filter((r) => r.partner_id === pid)
    const assigned  = pAssigns.reduce((s, a) => s + a.mg + a.plain, 0)
    const sold      = pSales.reduce((s, r) => s + r.units, 0)
    const retracted = pAttrs.reduce((s, r) => s + r.units, 0)
    const revenue   = pSales.reduce((s, r) => s + r.units * (VARIANTS[r.variant]?.price || 0), 0)
    return {
      id: partner.id,
      name: partner.name,
      phone: partner.phone,
      status: partner.status,
      partner_type: partner.partner_type || 'other',
      assigned,
      sold,
      retracted,
      revenue,
      sellThrough: assigned > 0 ? Math.round((sold / assigned) * 100) : 0,
    }
  }).filter(Boolean).sort((a, b) => b.sold - a.sold)

  // Variant breakdown
  const variantRow = (key) => {
    const price     = VARIANTS[key].price
    const assigned  = assigns.reduce((s, a) => s + (key === 'multigrain' ? a.mg : a.plain), 0)
    const sold      = sales.filter((s) => s.variant === key).reduce((s, r) => s + r.units, 0)
    const retracted = attrs.filter((r) => r.variant === key).reduce((s, r) => s + r.units, 0)
    return {
      key,
      label: VARIANTS[key].short,
      price,
      assigned,
      sold,
      retracted,
      revenue: sold * price,
      sellThrough: assigned > 0 ? (sold / assigned) * 100 : 0,
    }
  }

  // Diversions filtered by range
  const diversions = AGENT_DIVERSIONS
    .filter((d) => d.agent_id === agentId && withinRange(d.date, range))
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // Delivery log — assignments to this agent's partners (section D).
  const deliveries = assigns
    .map((a) => {
      const sold = sales
        .filter((s) => s.partner_id === a.partner_id && new Date(s.date) >= new Date(a.date))
        .reduce((s, r) => s + r.units, 0)
      const delivered = a.mg + a.plain
      return {
        id: a.id,
        date: a.date,
        partner_id: a.partner_id,
        partner_name: nameById[a.partner_id]?.name || 'Unknown',
        mg: a.mg,
        plain: a.plain,
        delivered,
        sold,
        left: Math.max(0, delivered - sold),
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // Retraction / collected-back log — attributions for this agent's partners (section E).
  const retractions = attrs
    .map((r) => {
      const v = VARIANTS[r.variant] || VARIANTS.multigrain
      return {
        id: r.id,
        date: r.date,
        partner_id: r.partner_id,
        partner_name: nameById[r.partner_id]?.name || 'Unknown',
        variant: r.variant,
        variant_label: v.short,
        units: r.units,
        reason: r.reason,
        reason_label: REASON_LABELS[r.reason] || r.reason,
        notes: r.notes,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // Stall / retail supply log (section F).
  const stallSupplies = STALL_SUPPLIES
    .filter((ss) => ss.agent_id === agentId && withinRange(ss.date, range))
    .map((ss) => {
      const v = VARIANTS[ss.variant] || VARIANTS.multigrain
      const src = ss.source === 'buffer' ? 'Central buffer' : (nameById[ss.source]?.name || ss.source)
      return {
        id: ss.id,
        date: ss.date,
        stall: ss.stall,
        variant: ss.variant,
        variant_label: v.short,
        units: ss.units,
        source: src,
        notes: ss.notes,
      }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  const suppliedToStalls = stallSupplies.reduce((s, r) => s + r.units, 0)

  // Per-type partner breakdown (FIX 6): partners + units delivered per type.
  const typeMap = {}
  for (const p of partnerPerformance) {
    const t = p.partner_type || 'other'
    if (!typeMap[t]) typeMap[t] = { type: t, label: PARTNER_TYPE_LABELS[t] || t, partners: 0, delivered: 0, sold: 0 }
    typeMap[t].partners += 1
    typeMap[t].delivered += p.assigned
    typeMap[t].sold += p.sold
  }
  const partnerTypeBreakdown = Object.values(typeMap).sort((a, b) => b.delivered - a.delivered)

  return {
    id: agent.id,
    name: agent.name,
    phone: agent.phone,
    status: agent.status,
    joined_at: agent.joined_at,
    totals: {
      partners: partnerIds.length,
      assigned: totalAssigned,
      sold: totalSold,
      retracted: totalRetracted,
      revenue: totalRevenue,
      suppliedToStalls,
    },
    partnerPerformance,
    partnerTypeBreakdown,
    variants: {
      multigrain: variantRow('multigrain'),
      plain: variantRow('plain'),
    },
    monthly: buildMonthlySeries(sales),
    todayActivity: AGENT_TODAY_ACTIVITY[agentId] || [],
    deliveries,
    retractions,
    stallSupplies,
    diversions,
  }
}

export default DEMO_DATA

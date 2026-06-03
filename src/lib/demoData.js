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
    { id: '1', full_name: 'Rahul Kumar', phone: '9876543201', phone_number: '9876543201', email: 'demo-rahul@cadieux.demo', role: 'partner', status: 'active', notes: 'Top performer', created_at: '2026-01-15', assigned: 85, sold: 66, retracted: 2 },
    { id: '2', full_name: 'Priya Sharma', phone: '9876543202', phone_number: '9876543202', email: 'demo-priya@cadieux.demo', role: 'partner', status: 'active', notes: 'Vizag south', created_at: '2026-02-01', assigned: 80, sold: 58, retracted: 1 },
    { id: '3', full_name: 'Vikram Reddy', phone: '9876543203', phone_number: '9876543203', email: 'demo-vikram@cadieux.demo', role: 'partner', status: 'active', notes: 'MVP district', created_at: '2026-03-10', assigned: 70, sold: 52, retracted: 3 },
    { id: '4', full_name: 'Anita Das', phone: '9876543204', phone_number: '9876543204', email: 'demo-anita@cadieux.demo', role: 'partner', status: 'inactive', notes: 'On leave', created_at: '2026-04-01', assigned: 63, sold: 44, retracted: 4 },
  ],

  // Agent list (admin). partners = direct reports; assigned/closed = totals
  // across all their partners.
  salesExecList: [
    { id: '1', full_name: 'Kiran Joshi', phone: '9876543210', phone_number: '9876543210', email: 'demo-kiran@cadieux.demo', role: 'sales', status: 'active', notes: 'Senior exec', created_at: '2026-01-01', partners: 3, assigned: 235, closed: 176 },
    { id: '2', full_name: 'Nandini Rao', phone: '9876543211', phone_number: '9876543211', email: 'demo-nandini@cadieux.demo', role: 'sales', status: 'active', notes: 'New hire', created_at: '2026-05-01', partners: 2, assigned: 115, closed: 82 },
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

// =========================================================================
// Drill-down records (Admin Overview clickable KPI cards)
// =========================================================================
// Hard-coded reference "today" so the demo data is deterministic.
const DEMO_TODAY = new Date('2026-06-03')

// Larger demo partner roster used by drill-down views. Indexed by `id`.
// Index aligns with DEMO_DATA.overview.partnerPerformance.
const DRILLDOWN_PARTNERS = [
  { id: 'p1', name: 'Rahul Kumar',   phone: '9876543201', status: 'active' },
  { id: 'p2', name: 'Priya Sharma',  phone: '9876543202', status: 'active' },
  { id: 'p3', name: 'Vikram Reddy',  phone: '9876543203', status: 'inactive' },
  { id: 'p4', name: 'Anita Das',     phone: '9876543204', status: 'active' },
  { id: 'p5', name: 'Suresh Patel',  phone: '9876543205', status: 'active' },
  { id: 'p6', name: 'Meena Iyer',    phone: '9876543206', status: 'active' },
  { id: 'p7', name: 'Arjun Mehta',   phone: '9876543207', status: 'active' },
  { id: 'p8', name: 'Kavita Nair',   phone: '9876543208', status: 'inactive' },
  { id: 'p9', name: 'Naveen Pillai', phone: '9876543209', status: 'active' },
  { id: 'p10', name: 'Sneha Hegde',  phone: '9876543210', status: 'active' },
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
  { id: 's1', partner_id: 'p1', customer: 'Mohan Rao', variant: 'multigrain', units: 3, date: daysAgo(0), assigned_date: daysAgo(2) },
  { id: 's2', partner_id: 'p2', customer: 'Lakshmi Devi', variant: 'plain', units: 5, date: daysAgo(0), assigned_date: daysAgo(3) },
  { id: 's3', partner_id: 'p1', customer: 'Karthik Iyer', variant: 'multigrain', units: 4, date: daysAgo(1), assigned_date: daysAgo(2) },
  { id: 's4', partner_id: 'p3', customer: 'Ravi Teja', variant: 'multigrain', units: 2, date: daysAgo(2), assigned_date: daysAgo(5) },
  { id: 's5', partner_id: 'p4', customer: 'Sita Ram', variant: 'plain', units: 4, date: daysAgo(3), assigned_date: daysAgo(7) },
  { id: 's6', partner_id: 'p5', customer: 'Krishna Murthy', variant: 'multigrain', units: 6, date: daysAgo(3), assigned_date: daysAgo(12) },
  { id: 's7', partner_id: 'p2', customer: 'Ayesha Khan', variant: 'multigrain', units: 8, date: daysAgo(4), assigned_date: daysAgo(3) },
  { id: 's8', partner_id: 'p1', customer: 'Deepak Joshi', variant: 'plain', units: 3, date: daysAgo(5), assigned_date: daysAgo(10) },
  { id: 's9', partner_id: 'p6', customer: 'Nisha Kapoor', variant: 'multigrain', units: 4, date: daysAgo(6), assigned_date: daysAgo(18) },
  { id: 's10', partner_id: 'p3', customer: 'Sunita Verma', variant: 'plain', units: 5, date: daysAgo(7), assigned_date: daysAgo(5) },
  // Mid range (8–30 days)
  { id: 's11', partner_id: 'p2', customer: 'Rohit Mehra', variant: 'multigrain', units: 7, date: daysAgo(9), assigned_date: daysAgo(15) },
  { id: 's12', partner_id: 'p7', customer: 'Asha Pillai', variant: 'multigrain', units: 3, date: daysAgo(11), assigned_date: daysAgo(25) },
  { id: 's13', partner_id: 'p4', customer: 'Manoj Tiwari', variant: 'plain', units: 4, date: daysAgo(13), assigned_date: daysAgo(7) },
  { id: 's14', partner_id: 'p5', customer: 'Geeta Nair', variant: 'plain', units: 3, date: daysAgo(15), assigned_date: daysAgo(12) },
  { id: 's15', partner_id: 'p1', customer: 'Vishal Goel', variant: 'multigrain', units: 6, date: daysAgo(17), assigned_date: daysAgo(10) },
  { id: 's16', partner_id: 'p8', customer: 'Pooja Shah', variant: 'multigrain', units: 2, date: daysAgo(19), assigned_date: daysAgo(35) },
  { id: 's17', partner_id: 'p3', customer: 'Arvind Rao', variant: 'multigrain', units: 5, date: daysAgo(22), assigned_date: daysAgo(22) },
  { id: 's18', partner_id: 'p2', customer: 'Divya Menon', variant: 'plain', units: 6, date: daysAgo(24), assigned_date: daysAgo(15) },
  { id: 's19', partner_id: 'p6', customer: 'Sanjay Bhatt', variant: 'plain', units: 3, date: daysAgo(26), assigned_date: daysAgo(18) },
  { id: 's20', partner_id: 'p4', customer: 'Rekha Yadav', variant: 'multigrain', units: 5, date: daysAgo(28), assigned_date: daysAgo(30) },
  // Older (31–180 days)
  { id: 's21', partner_id: 'p1', customer: 'Tanvi Saha', variant: 'multigrain', units: 8, date: daysAgo(35), assigned_date: daysAgo(120) },
  { id: 's22', partner_id: 'p5', customer: 'Imran Sheikh', variant: 'plain', units: 4, date: daysAgo(42), assigned_date: daysAgo(65) },
  { id: 's23', partner_id: 'p2', customer: 'Neha Kulkarni', variant: 'multigrain', units: 6, date: daysAgo(48), assigned_date: daysAgo(160) },
  { id: 's24', partner_id: 'p7', customer: 'Aditya Bose', variant: 'plain', units: 2, date: daysAgo(55), assigned_date: daysAgo(95) },
  { id: 's25', partner_id: 'p3', customer: 'Shruti Pandit', variant: 'multigrain', units: 5, date: daysAgo(70), assigned_date: daysAgo(200) },
  { id: 's26', partner_id: 'p9', customer: 'Vivek Choudhary', variant: 'multigrain', units: 3, date: daysAgo(85), assigned_date: daysAgo(42) },
  { id: 's27', partner_id: 'p6', customer: 'Anjali Ravi', variant: 'multigrain', units: 4, date: daysAgo(105), assigned_date: daysAgo(75) },
  { id: 's28', partner_id: 'p1', customer: 'Harish Naidu', variant: 'plain', units: 5, date: daysAgo(130), assigned_date: daysAgo(120) },
  { id: 's29', partner_id: 'p10', customer: 'Komal Pawar', variant: 'plain', units: 3, date: daysAgo(160), assigned_date: daysAgo(50) },
  { id: 's30', partner_id: 'p4', customer: 'Mahesh Acharya', variant: 'multigrain', units: 6, date: daysAgo(220), assigned_date: daysAgo(30) },
  { id: 's31', partner_id: 'p2', customer: 'Reema D\'Souza', variant: 'plain', units: 4, date: daysAgo(280), assigned_date: daysAgo(160) },
  { id: 's32', partner_id: 'p3', customer: 'Akash Sinha', variant: 'multigrain', units: 7, date: daysAgo(340), assigned_date: daysAgo(200) },
]

// --- Attribution records (Attributed KPI drill-down) ------------------------
// Each row = one return/retract event. Reason is one of:
// 'damaged' | 'expired' | 'customer_return' | 'unsold' | 'other'.
const ATTRIBUTIONS = [
  { id: 'r1', partner_id: 'p1', variant: 'multigrain', units: 1, reason: 'damaged', notes: 'Package torn during transit', attributed_by: 'Kiran Joshi', date: daysAgo(1) },
  { id: 'r2', partner_id: 'p2', variant: 'plain', units: 1, reason: 'customer_return', notes: 'Customer changed mind after delivery', attributed_by: 'Kiran Joshi', date: daysAgo(3) },
  { id: 'r3', partner_id: 'p3', variant: 'multigrain', units: 2, reason: 'expired', notes: 'Past best-before date', attributed_by: 'Nandini Rao', date: daysAgo(6) },
  { id: 'r4', partner_id: 'p4', variant: 'plain', units: 2, reason: 'unsold', notes: 'Did not move from partner shelf in 21 days', attributed_by: 'Kiran Joshi', date: daysAgo(10) },
  { id: 'r5', partner_id: 'p1', variant: 'multigrain', units: 1, reason: 'damaged', notes: 'Wet during rain', attributed_by: 'Nandini Rao', date: daysAgo(14) },
  { id: 'r6', partner_id: 'p5', variant: 'plain', units: 1, reason: 'customer_return', notes: 'Wrong variant — wanted Multi-Grain', attributed_by: 'Kiran Joshi', date: daysAgo(20) },
  { id: 'r7', partner_id: 'p6', variant: 'multigrain', units: 1, reason: 'other', notes: 'Sample for partner training', attributed_by: 'Nandini Rao', date: daysAgo(35) },
  { id: 'r8', partner_id: 'p2', variant: 'plain', units: 2, reason: 'unsold', notes: '', attributed_by: 'Kiran Joshi', date: daysAgo(48) },
  { id: 'r9', partner_id: 'p3', variant: 'plain', units: 1, reason: 'expired', notes: 'Stock rotation cleanup', attributed_by: 'Nandini Rao', date: daysAgo(72) },
  { id: 'r10', partner_id: 'p7', variant: 'multigrain', units: 1, reason: 'damaged', notes: 'Crushed in handling', attributed_by: 'Kiran Joshi', date: daysAgo(95) },
  { id: 'r11', partner_id: 'p1', variant: 'plain', units: 1, reason: 'customer_return', notes: 'Reported off taste', attributed_by: 'Nandini Rao', date: daysAgo(140) },
  { id: 'r12', partner_id: 'p4', variant: 'multigrain', units: 1, reason: 'unsold', notes: '', attributed_by: 'Kiran Joshi', date: daysAgo(210) },
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

export default DEMO_DATA

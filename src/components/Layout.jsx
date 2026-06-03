import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  Megaphone,
  Users,
  ClipboardCheck,
  FileText,
  User,
  UserPlus,
  Home,
  LogOut,
  Shield,
  Menu as MenuIcon,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  MoreHorizontal,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import SessionTimeout from './SessionTimeout'
import { displayLogin, displayName } from '../lib/phone'
import { fetchPendingCount } from '../lib/changeRequests'

// Floating "DEMO MODE" badge + transient toast. Only mounted when a demo
// account is logged in. Listens for the `demo:blocked` event fired by
// demoBlock() whenever a write action is attempted.
function DemoBadge() {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const onBlocked = (e) => {
      setToast(e.detail || 'Not available in demo mode')
      const t = setTimeout(() => setToast(null), 2500)
      return () => clearTimeout(t)
    }
    window.addEventListener('demo:blocked', onBlocked)
    return () => window.removeEventListener('demo:blocked', onBlocked)
  }, [])

  return (
    <>
      {toast && (
        <div className="fixed bottom-24 right-4 z-[60] rounded-lg bg-[#1a2332] px-4 py-2.5 text-sm font-semibold text-amber-200 shadow-lg ring-1 ring-amber-400/30 md:bottom-16">
          {toast}
        </div>
      )}
      <div className="fixed bottom-20 right-4 z-[60] rounded-full bg-[#fbf3d4] px-3.5 py-1.5 text-xs font-bold text-[#024628] shadow-lg md:bottom-4">
        DEMO MODE — No real data
      </div>
    </>
  )
}

const adminNavigation = [
  { name: 'Overview', href: '/admin/overview', Icon: LayoutDashboard },
  { name: 'Sales', href: '/admin/sales', Icon: TrendingUp },
  { name: 'CTA', href: '/admin/cta', Icon: Megaphone },
  { name: 'Team', href: '/admin/team', Icon: Users },
  { name: 'Change Requests', href: '/admin/change-requests', badge: 'pendingRequests', Icon: ClipboardCheck },
  { name: 'Audit', href: '/admin/audit-logs', Icon: FileText },
  { name: 'Profile', href: '/admin/profile', Icon: User },
]

const salesNavigation = [
  { name: 'Overview', href: '/admin/overview', Icon: LayoutDashboard },
  { name: 'Sales', href: '/admin/sales', Icon: TrendingUp },
  { name: 'CTA', href: '/admin/cta', Icon: Megaphone },
  { name: 'Team', href: '/admin/team', Icon: Users },
  { name: 'Partner Requests', href: '/admin/change-requests', badge: 'pendingRequests', Icon: ClipboardCheck },
  { name: 'Profile', href: '/admin/profile', Icon: User },
]

const partnerNavigation = [
  { name: 'Home', href: '/partner/dashboard', Icon: Home },
  { name: 'Profile', href: '/partner/profile', Icon: User },
]

// Onboarding showcase entry — only injected into the sidebar in demo mode.
const onboardingNavItem = { name: 'Onboarding', href: '/admin/onboarding', Icon: UserPlus }

export default function Layout() {
  const { profile, role, signOut, isDemo } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [pendingRequests, setPendingRequests] = useState(0)

  // Pending change-request count for the sidebar badge. RLS scopes it:
  // admin gets the global count; sales gets only pending partner requests.
  useEffect(() => {
    if (isDemo) return
    if (role !== 'admin' && role !== 'sales') return
    let active = true
    fetchPendingCount()
      .then((n) => { if (active) setPendingRequests(n) })
      .catch(() => {})
    return () => { active = false }
  }, [role, isDemo])

  const badgeCounts = { pendingRequests }

  const handleSignOut = async () => {
    await signOut()
  }

  // Get navigation based on role
  let navigation = partnerNavigation
  let appName = 'Partner'

  if (role === 'admin') {
    navigation = adminNavigation
    appName = 'Operations'
  } else if (role === 'sales') {
    navigation = salesNavigation
    appName = 'Sales'
  }

  // In demo mode, surface the Onboarding showcase in the sidebar (just
  // before Profile) for admin/sales so the flow is discoverable.
  if (isDemo && (role === 'admin' || role === 'sales')) {
    const profileIdx = navigation.findIndex((n) => n.name === 'Profile')
    const insertAt = profileIdx === -1 ? navigation.length : profileIdx
    navigation = [
      ...navigation.slice(0, insertAt),
      onboardingNavItem,
      ...navigation.slice(insertAt),
    ]
  }

  // Mobile bottom tab bar: first 3 nav items + a Menu trigger.
  const bottomTabs = navigation.slice(0, 3)

  const navLinkClass = ({ isActive }) =>
    `group relative flex h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 ${
      isActive
        ? 'bg-[rgba(2,70,40,0.15)] text-[#fbf3d4]'
        : 'text-slate-500 hover:bg-[rgba(2,70,40,0.08)] hover:text-slate-100'
    }`

  return (
    <div className="min-h-screen bg-transparent text-slate-100 lg:flex">
      <SessionTimeout />

      {/* Mobile menu button */}
      <button
        onClick={() => setIsMobileMenuOpen((v) => !v)}
        className="lg:hidden fixed top-4 right-4 z-50 rounded-lg border border-[#1e2d3d] bg-[#111921] p-2 text-slate-300 shadow-lg transition-all hover:text-white"
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? <X size={20} /> : <MenuIcon size={20} />}
      </button>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar — on mobile, ends 52px above the bottom (above the bottom
          nav bar) so the user/sign-out section is always tappable. */}
      <aside
        className={`
          fixed top-0 bottom-[52px] lg:static lg:inset-y-0 left-0 z-40
          flex flex-col border-r border-[#1e2d3d] bg-[#0a0f14]
          transition-all duration-300 ease-in-out
          ${isSidebarOpen ? 'w-[13.75rem]' : 'w-[4.25rem]'}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Brand */}
        <div className="flex min-h-[52px] items-center border-b border-[#1e2d3d] px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#024628] text-[#fbf3d4] shadow-[0_4px_12px_rgba(2,70,40,0.4)]">
              <span className="font-display text-base font-extrabold leading-none">C</span>
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <p className="truncate font-display text-base font-extrabold tracking-[0.06em] text-[#fbf3d4]">
                  CADIEUX
                </p>
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {appName}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[#1e2d3d] text-slate-400 transition-all hover:border-[#28394b] hover:text-white lg:flex"
            aria-label="Toggle sidebar"
          >
            {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {navigation.map((item) => {
            const Icon = item.Icon
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={navLinkClass}
                title={!isSidebarOpen ? item.name : undefined}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[#024628]" />
                    )}
                    <span className="relative flex flex-shrink-0 items-center justify-center">
                      <Icon size={16} className={isActive ? 'text-[#fbf3d4]' : 'text-slate-500 group-hover:text-slate-100'} />
                      {item.badge && badgeCounts[item.badge] > 0 && !isSidebarOpen && (
                        <span className="absolute -right-2 -top-2 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                          {badgeCounts[item.badge]}
                        </span>
                      )}
                    </span>
                    {isSidebarOpen && (
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="block truncate">{item.name}</span>
                        {item.badge && badgeCounts[item.badge] > 0 && (
                          <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
                            {badgeCounts[item.badge]}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* User section — pinned to the bottom of the sidebar (sibling of the
            scrollable nav, not inside it), so it never scrolls away. The card
            itself is a Link to the role-specific profile page. */}
        <div className="flex-shrink-0 border-t border-[#1e2d3d] p-3">
          <Link
            to={role === 'partner' ? '/partner/profile' : '/admin/profile'}
            onClick={() => setIsMobileMenuOpen(false)}
            title={!isSidebarOpen ? 'My profile' : undefined}
            className={`group mb-2.5 flex cursor-pointer items-center gap-3 rounded-lg border border-[#1e2d3d] bg-[#111921] p-2.5 transition-colors hover:bg-[#162133] ${
              !isSidebarOpen ? 'justify-center' : ''
            }`}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#024628] text-sm font-bold text-[#fbf3d4]">
              {role === 'admin'
                ? <Shield size={16} className="text-[#fbf3d4]" />
                : (profile?.full_name?.charAt(0) || displayLogin(profile?.email)?.charAt(0) || 'A')}
            </div>
            {isSidebarOpen && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">
                    {role === 'admin' ? 'Admin' : (displayName(profile) || 'Admin')}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {role === 'admin' ? 'Administrator' : (profile?.phone || displayLogin(profile?.email))}
                  </p>
                </div>
                <ChevronRightIcon
                  size={16}
                  className="flex-shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300"
                />
              </>
            )}
          </Link>
          <button
            onClick={handleSignOut}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border border-[#1e2d3d] px-3 py-2 text-sm font-semibold text-slate-400 transition-all hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 ${
              !isSidebarOpen ? 'px-2' : ''
            }`}
            title={!isSidebarOpen ? 'Sign Out' : undefined}
          >
            <LogOut size={16} className="flex-shrink-0" />
            {isSidebarOpen && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto scroll-smooth pb-[52px] lg:ml-0 lg:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar (< lg) — 52px tall, 4 evenly-spaced tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-[52px] items-stretch border-t border-[#1e2d3d] bg-[#0a0f14] lg:hidden">
        {bottomTabs.map((item) => {
          const Icon = item.Icon
          return (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  isActive ? 'text-[#fbf3d4]' : 'text-slate-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute top-0 h-[2px] w-10 rounded-full bg-[#024628]" />}
                  <Icon size={20} />
                  <span className="truncate">{item.name}</span>
                </>
              )}
            </NavLink>
          )
        })}
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-slate-500"
        >
          <MoreHorizontal size={20} />
          <span>Menu</span>
        </button>
      </nav>

      {isDemo && <DemoBadge />}
    </div>
  )
}

import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const adminNavigation = [
  {
    name: 'Overview',
    href: '/admin/overview',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'Sales',
    href: '/admin/sales',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    name: 'CTA',
    href: '/admin/cta',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    name: 'Partners',
    href: '/admin/partners',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    name: 'Sales Exec',
    href: '/admin/sales-exec',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7zm6-5h3m-1.5-1.5v3" />
      </svg>
    ),
  },
  {
    name: 'Audit',
    href: '/admin/audit-logs',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

const salesNavigation = [
  {
    name: 'Overview',
    href: '/admin/overview',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'Sales',
    href: '/admin/sales',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    name: 'CTA',
    href: '/admin/cta',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    name: 'Partners',
    href: '/admin/partners',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

const partnerNavigation = [
  {
    name: 'Home',
    href: '/partner/dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    name: 'Profile',
    href: '/partner/profile',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
]

export default function Layout() {
  const { profile, role, signOut } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
  }

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  // Get navigation based on role
  let navigation = partnerNavigation
  let appName = 'Partner'
  
  if (role === 'admin') {
    navigation = adminNavigation
    appName = 'Sunny'
  } else if (role === 'sales') {
    navigation = salesNavigation
    appName = 'Sales'
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-100 lg:flex">
      {/* Mobile menu button */}
      <button
        onClick={toggleMobileMenu}
        className="lg:hidden fixed top-4 right-4 z-50 rounded-2xl border border-white/10 bg-slate-950/75 p-2.5 text-slate-300 shadow-[0_18px_30px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:text-white"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isMobileMenuOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden"
          onClick={toggleMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          flex flex-col border-r border-white/8 bg-slate-950/70 backdrop-blur-2xl
          shadow-[0_36px_70px_rgba(2,6,23,0.35)] transition-all duration-300 ease-in-out
          ${isSidebarOpen ? 'w-[18rem]' : 'w-[5.75rem]'}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex min-h-[88px] items-center border-b border-white/8 px-4 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-semibold tracking-tight text-white">
                  {appName}
                </p>
                <p className="truncate text-xs uppercase tracking-[0.22em] text-slate-500">
                  Panel
                </p>
              </div>
            )}
          </div>
          {/* Desktop collapse button */}
          <button
            onClick={toggleSidebar}
            className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border border-white/8 text-slate-400 transition-all hover:border-white/14 hover:bg-white/[0.04] hover:text-white lg:flex"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isSidebarOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              )}
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5 sm:px-4">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? 'border-white/10 bg-white/[0.08] text-white shadow-[0_14px_32px_rgba(2,6,23,0.26)]'
                    : 'border-transparent text-slate-400 hover:border-white/8 hover:bg-white/[0.04] hover:text-white'
                }`
              }
              title={!isSidebarOpen ? item.name : undefined}
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-slate-300 transition-colors group-hover:text-white">
                {item.icon}
              </span>
              {isSidebarOpen && (
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{item.name}</span>
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-white/8 p-3.5 sm:p-4">
          <div
            className={`mb-3 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3 ${
              !isSidebarOpen ? 'justify-center' : ''
            }`}
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/80 to-emerald-500/70">
              <span className="text-white text-sm font-semibold">
                {profile?.full_name?.charAt(0) || profile?.email?.charAt(0) || 'A'}
              </span>
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {profile?.full_name || 'Admin'}
                </p>
                <p className="truncate text-xs text-slate-500">{profile?.email}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 px-3 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:border-white/12 hover:bg-white/[0.05] hover:text-white ${
              !isSidebarOpen ? 'px-2' : ''
            }`}
            title={!isSidebarOpen ? 'Sign Out' : undefined}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {isSidebarOpen && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto lg:ml-0">
        <Outlet />
      </main>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import KPICard from '../components/KPICard'
import { formatDateDDMMYY } from '../lib/date'

export default function PartnerProfile() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalUnitsAssigned: 0,
    totalSold: 0,
    totalRetracted: 0,
    unitsRemaining: 0,
    totalRevenue: 0,
    totalOrders: 0,
  })

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch partner's orders (RLS will filter to only their data)
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('units_assigned, units_sold, units_retracted, unit_price')
        .eq('partner_id', user.id)

      if (error) throw error

      const totalUnitsAssigned = ordersData?.reduce((sum, o) => sum + (o.units_assigned || 0), 0) || 0
      const totalSold = ordersData?.reduce((sum, o) => sum + (o.units_sold || 0), 0) || 0
      const totalRetracted = ordersData?.reduce((sum, o) => sum + (o.units_retracted || 0), 0) || 0
      const unitsRemaining = totalUnitsAssigned - totalSold - totalRetracted
      
      // Calculate revenue (units sold - retracted) * unit price
      const totalRevenue = ordersData?.reduce((sum, o) => {
        const effectiveSold = Math.max(0, (o.units_sold || 0) - (o.units_retracted || 0))
        return sum + (effectiveSold * (o.unit_price || 100))
      }, 0) || 0

      setStats({
        totalUnitsAssigned,
        totalSold,
        totalRetracted,
        unitsRemaining,
        totalRevenue,
        totalOrders: ordersData?.length || 0,
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 pb-24 sm:pb-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2">Partner Profile</h1>
        <p className="text-sm sm:text-base text-slate-400">View and manage your profile information</p>
      </div>

      {/* KPI Cards - Mobile-first responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <KPICard
          title="Total Units Assigned"
          value={stats.totalUnitsAssigned.toLocaleString()}
          color="indigo"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <KPICard
          title="Units Sold"
          value={stats.totalSold.toLocaleString()}
          color="emerald"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="Units Retracted"
          value={stats.totalRetracted.toLocaleString()}
          color="purple"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          }
        />
        <KPICard
          title="Units Remaining"
          value={stats.unitsRemaining.toLocaleString()}
          color="amber"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="Total Revenue"
          value={`₹${stats.totalRevenue.toLocaleString()}`}
          color="rose"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Profile Information */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-white mb-4 sm:mb-6">Profile Information</h2>
        <div className="space-y-3 sm:space-y-4">
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Full Name</label>
            <p className="text-sm sm:text-base md:text-lg text-white mt-1">{profile?.full_name || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Email</label>
            <p className="text-sm sm:text-base md:text-lg text-white mt-1 break-words">{profile?.email || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Phone Number</label>
            <p className="text-sm sm:text-base md:text-lg text-white mt-1">{profile?.phone_number || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Role</label>
            <p className="text-sm sm:text-base md:text-lg text-white mt-1 capitalize">{profile?.role || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs sm:text-sm font-medium text-slate-400">Member Since</label>
            <p className="text-sm sm:text-base md:text-lg text-white mt-1">
              {profile?.created_at 
                ? formatDateDDMMYY(profile.created_at)
                : 'N/A'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

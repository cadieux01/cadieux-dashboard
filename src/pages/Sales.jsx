import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import KPICard from '../components/KPICard'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { supabase } from '../lib/supabase'
import { logAuditEvent, createAuditDescription } from '../lib/audit'
import { formatDateDDMMYY } from '../lib/date'

const UNIT_PRICE = 100
const chartPalette = ['#8ee1cb', '#7f95ff', '#f2b36d', '#f28b9d', '#a7b4ff', '#8fcdf3']

function OverviewTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload
  if (!row) return null

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/92 px-4 py-3 shadow-[0_24px_50px_rgba(2,6,23,0.35)] backdrop-blur-xl">
      <p className="font-semibold text-white">{row.trainer_name}</p>
      <div className="mt-2 space-y-1.5 text-sm text-slate-300">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Assigned</span>
          <span>{(row.total_units_assigned || 0).toLocaleString()} units</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Sold</span>
          <span>{(row.total_units_sold || 0).toLocaleString()} units</span>
        </div>
      </div>
    </div>
  )
}

function ShareTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload
  if (!row) return null

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/92 px-4 py-3 shadow-[0_24px_50px_rgba(2,6,23,0.35)] backdrop-blur-xl">
      <p className="font-semibold text-white">{row.name}</p>
      <p className="mt-2 text-sm text-slate-300">
        {row.value.toLocaleString()} sold
      </p>
    </div>
  )
}

export default function Sales() {
  const [trainers, setTrainers] = useState([])
  const [rankings, setRankings] = useState([])
  const [loading, setLoading] = useState(true)
  const [isAddTrainerModalOpen, setIsAddTrainerModalOpen] = useState(false)
  const [editingTrainerId, setEditingTrainerId] = useState(null)
  const [editingTrainerData, setEditingTrainerData] = useState(null)
  const [trainerFormData, setTrainerFormData] = useState({
    name: '',
    contact: '',
    notes: '',
    joining_date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const { data: partnersData, error: trainersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, notes, created_at')
        .eq('role', 'partner')
        .order('full_name', { ascending: true, nullsFirst: false })

      if (trainersError) throw trainersError

      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('trainer_id, units_assigned, units_sold')

      if (salesError) throw salesError

      const normalizedPartners = (partnersData || []).map((partner) => ({
        id: partner.id,
        name: partner.full_name || partner.email || 'N/A',
        contact: partner.phone_number || '',
        notes: partner.notes || '',
        created_at: partner.created_at,
      }))

      const totalsByPartner = {}
      for (const sale of salesData || []) {
        const partnerId = sale.trainer_id
        if (!partnerId) continue

        if (!totalsByPartner[partnerId]) {
          totalsByPartner[partnerId] = {
            total_units_assigned: 0,
            total_units_sold: 0,
          }
        }

        totalsByPartner[partnerId].total_units_assigned += sale.units_assigned || 0
        totalsByPartner[partnerId].total_units_sold += sale.units_sold || 0
      }

      const rankingBase = normalizedPartners.map((partner) => {
        const totals = totalsByPartner[partner.id] || { total_units_assigned: 0, total_units_sold: 0 }

        return {
          trainer_id: partner.id,
          trainer_name: partner.name,
          trainer_contact: partner.contact,
          total_units_assigned: totals.total_units_assigned,
          total_units_sold: totals.total_units_sold,
        }
      })

      const sortedRankings = rankingBase.sort((a, b) => b.total_units_sold - a.total_units_sold)
      let previousSold = null
      let currentRank = 0

      const rankingsData = sortedRankings.map((row, index) => {
        if (row.total_units_sold !== previousSold) {
          currentRank = index + 1
          previousSold = row.total_units_sold
        }

        return {
          ...row,
          rank: currentRank,
        }
      })

      setTrainers(normalizedPartners)
      setRankings(rankingsData || [])
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEditTrainer = (trainer) => {
    setEditingTrainerId(trainer.id)
    setEditingTrainerData(trainer)

    const joiningDate = trainer.created_at
      ? new Date(trainer.created_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]

    setTrainerFormData({
      name: trainer.name || '',
      contact: trainer.contact || '',
      notes: trainer.notes || '',
      joining_date: joiningDate,
    })
    setIsAddTrainerModalOpen(true)
  }

  const handleDeleteTrainer = async (id) => {
    if (!confirm('Are you sure you want to delete this partner? This action cannot be undone.')) {
      return
    }

    try {
      const trainer = trainers.find((item) => item.id === id)

      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('role', 'partner')
        .eq('id', id)

      if (error) throw error

      const oldTrainerDelVals = trainer
        ? {
            name: trainer.name,
            contact: trainer.contact,
            notes: trainer.notes,
            created_at: trainer.created_at,
          }
        : null

      await logAuditEvent({
        actionType: 'DELETE',
        entityType: 'user',
        entityId: id,
        description: createAuditDescription(
          'DELETE',
          'user',
          { name: trainer?.name },
          null,
          oldTrainerDelVals,
          null,
        ),
        oldValues: oldTrainerDelVals,
      })

      await fetchData()
    } catch (error) {
      console.error('Error deleting trainer:', error)
      alert(`Error deleting partner: ${error.message}`)
    }
  }

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

        const oldTrainerUpdVals = editingTrainerData
          ? {
              full_name: editingTrainerData.name,
              phone_number: editingTrainerData.contact,
              notes: editingTrainerData.notes,
              created_at: editingTrainerData.created_at,
            }
          : null

        const newTrainerUpdVals = {
          full_name: trainerFormData.name.trim(),
          phone_number: trainerFormData.contact.trim() || null,
          notes: trainerFormData.notes.trim() || null,
          created_at: joiningTimestamp,
        }

        await logAuditEvent({
          actionType: 'UPDATE',
          entityType: 'user',
          entityId: editingTrainerId,
          description: createAuditDescription(
            'UPDATE',
            'user',
            { name: trainerFormData.name.trim() },
            null,
            oldTrainerUpdVals,
            newTrainerUpdVals,
          ),
          oldValues: oldTrainerUpdVals,
          newValues: newTrainerUpdVals,
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
      alert(`Error saving partner: ${error.message}`)
    }
  }

  const handleCloseTrainerModal = () => {
    setIsAddTrainerModalOpen(false)
    setEditingTrainerId(null)
    setEditingTrainerData(null)
    setTrainerFormData({
      name: '',
      contact: '',
      notes: '',
      joining_date: new Date().toISOString().split('T')[0],
    })
  }

  const formatPhoneNumber = (contact) => {
    if (!contact) return null
    return contact.replace(/[^\d+]/g, '')
  }

  const handleCallTrainer = (contact) => {
    const phoneNumber = formatPhoneNumber(contact)
    if (!phoneNumber) {
      alert('No contact number available for this partner')
      return
    }

    window.location.href = `tel:${phoneNumber}`
  }

  const trainerStatsMap = useMemo(() => {
    const map = {}

    rankings.forEach((ranking) => {
      map[ranking.trainer_id] = {
        totalUnits: ranking.total_units_assigned || 0,
        totalRevenue: (ranking.total_units_sold || 0) * UNIT_PRICE,
      }
    })

    return map
  }, [rankings])

  const summary = useMemo(() => {
    const totalUnitsAssigned = rankings.reduce((sum, ranking) => sum + (ranking.total_units_assigned || 0), 0)
    const totalUnitsSold = rankings.reduce((sum, ranking) => sum + (ranking.total_units_sold || 0), 0)
    const totalRevenue = totalUnitsSold * UNIT_PRICE
    const activePartners = rankings.filter((ranking) => (ranking.total_units_sold || 0) > 0).length
    const sellThrough = totalUnitsAssigned > 0 ? (totalUnitsSold / totalUnitsAssigned) * 100 : 0
    const topPartner = rankings[0] || null

    return {
      totalUnitsAssigned,
      totalUnitsSold,
      totalRevenue,
      activePartners,
      sellThrough,
      topPartner,
    }
  }, [rankings])

  const topRankings = useMemo(() => rankings.slice(0, 6), [rankings])

  const contributionData = useMemo(
    () =>
      topRankings
        .filter((partner) => (partner.total_units_sold || 0) > 0)
        .map((partner, index) => ({
          name: partner.trainer_name,
          value: partner.total_units_sold || 0,
          fill: chartPalette[index % chartPalette.length],
        })),
    [topRankings],
  )

  if (loading) {
    return (
      <div className="dashboard-page flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="dashboard-page !pt-2 sm:!pt-3 lg:!pt-4">
      <div className="relative z-10 mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="dashboard-title">Overview</h1>
        </div>

        <div className="dashboard-panel rounded-[32px] p-5 sm:p-6 xl:max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Top</p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">Top contributor</p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                {summary.topPartner?.trainer_name || 'No activity yet'}
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sell-through</p>
              <p className="mt-1 text-lg font-semibold text-emerald-100">
                {summary.sellThrough.toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            {summary.topPartner
              ? `${summary.topPartner.trainer_name} leads.`
              : 'No sales yet.'}
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Partners"
          value={trainers.length.toLocaleString()}
          subtitle={`${summary.activePartners} active`}
          color="indigo"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <KPICard
          title="Assigned"
          value={summary.totalUnitsAssigned.toLocaleString()}
          subtitle="Stock"
          color="amber"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          }
        />
        <KPICard
          title="Sold"
          value={summary.totalUnitsSold.toLocaleString()}
          subtitle="Closed"
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
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.92fr)]">
        <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Chart</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                Assigned vs sold
              </h2>
            </div>
          </div>

          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topRankings} barGap={10} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="overviewAssigned" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7f95ff" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#7f95ff" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="overviewSold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8ee1cb" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#8ee1cb" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(170, 183, 202, 0.12)" />
                <XAxis
                  dataKey="trainer_name"
                  axisLine={false}
                  tickLine={false}
                  stroke="#7b8da8"
                  fontSize={12}
                  tickFormatter={(value) => (value?.length > 12 ? `${value.slice(0, 12)}...` : value)}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  stroke="#7b8da8"
                  fontSize={12}
                />
                <Tooltip content={<OverviewTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="total_units_assigned" radius={[12, 12, 0, 0]} fill="url(#overviewAssigned)" maxBarSize={26} />
                <Bar dataKey="total_units_sold" radius={[12, 12, 0, 0]} fill="url(#overviewSold)" maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="space-y-6">
          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Share</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                  Sales share
                </h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Top 6
              </div>
            </div>

            {contributionData.length > 0 ? (
              <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                <div className="mx-auto h-[200px] w-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip content={<ShareTooltip />} />
                      <Pie
                        data={contributionData}
                        dataKey="value"
                        innerRadius={54}
                        outerRadius={82}
                        paddingAngle={4}
                        stroke="none"
                      >
                        {contributionData.map((entry, index) => (
                          <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3">
                  {contributionData.map((entry, index) => (
                    <div key={entry.name} className="dashboard-subpanel flex items-center justify-between rounded-[22px] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
                        <span className="text-sm font-semibold text-slate-200">
                          {entry.name.length > 18 ? `${entry.name.slice(0, 18)}...` : entry.name}
                        </span>
                      </div>
                      <span className="text-sm text-slate-400">{entry.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                No data yet.
              </div>
            )}
          </section>

          <section className="dashboard-panel rounded-[32px] p-5 sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Rank</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                Top partners
              </h2>
            </div>

            <div className="space-y-3">
              {topRankings.length === 0 ? (
                <div className="dashboard-subpanel rounded-[24px] px-5 py-8 text-center text-sm text-slate-400">
                  No partner data available yet.
                </div>
              ) : (
                topRankings.map((trainer, index) => (
                  <div key={trainer.trainer_id} className="dashboard-subpanel flex items-center gap-4 rounded-[24px] px-4 py-3.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">{trainer.trainer_name}</p>
                      <p className="truncate text-xs text-slate-500">{trainer.trainer_contact || 'No contact added'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-100">
                        {trainer.total_units_sold.toLocaleString()} sold
                      </p>
                      <p className="text-xs text-slate-500">
                        {trainer.total_units_assigned.toLocaleString()} assigned
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="dashboard-panel mb-8 overflow-hidden rounded-[32px]">
        <div className="flex flex-col gap-3 border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">List</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">Partners</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-400">
            {trainers.length} partner{trainers.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="dashboard-table min-w-full">
            <thead>
              <tr>
                <th className="border-b border-white/8 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Partner</th>
                <th className="border-b border-white/8 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Joined</th>
                <th className="border-b border-white/8 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Units</th>
                <th className="border-b border-white/8 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Revenue</th>
                <th className="border-b border-white/8 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Notes</th>
                <th className="border-b border-white/8 px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trainers.map((trainer) => {
                const stats = trainerStatsMap[trainer.id] || { totalUnits: 0, totalRevenue: 0 }

                return (
                  <tr key={trainer.id}>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-semibold text-white">{trainer.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{trainer.contact || 'No contact added'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {trainer.created_at ? formatDateDDMMYY(trainer.created_at) : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-emerald-100">
                      {stats.totalUnits.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-indigo-100">
                      ₹{stats.totalRevenue.toLocaleString()}
                    </td>
                    <td className="max-w-md px-6 py-4 text-sm text-slate-400">
                      <span className="block truncate">{trainer.notes || 'No notes added'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        {trainer.contact && (
                          <button
                            onClick={() => handleCallTrainer(trainer.contact)}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-300/16 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/16"
                            title={`Call ${trainer.contact}`}
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            Call
                          </button>
                        )}
                        <button
                          onClick={() => handleEditTrainer(trainer)}
                          className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08]"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {trainers.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-6 py-10 text-center text-sm text-slate-500">
                    No partners yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        isOpen={isAddTrainerModalOpen}
        onClose={handleCloseTrainerModal}
        title={editingTrainerId ? 'Edit Partner' : 'Add New Partner'}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleSaveTrainer()
          }}
        >
          <FormField
            label="Partner Name"
            value={trainerFormData.name}
            onChange={(value) => setTrainerFormData({ ...trainerFormData, name: value })}
            placeholder="Enter partner name"
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
            placeholder="Add context or reminders for this partner"
          />

          <div className="mt-6 flex gap-3">
            {editingTrainerId && (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this partner? This action cannot be undone.')) {
                    await handleDeleteTrainer(editingTrainerId)
                    handleCloseTrainerModal()
                  }
                }}
                className="dashboard-button inline-flex border border-rose-300/18 bg-rose-400/12 px-4 py-2 text-rose-100"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseTrainerModal}
              className="dashboard-button dashboard-button-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="dashboard-button dashboard-button-primary flex-1"
            >
              {editingTrainerId ? 'Update' : 'Add'} Partner
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

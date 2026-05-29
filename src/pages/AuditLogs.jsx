import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import DataTable from '../components/DataTable'
import { formatDateDDMMYY } from '../lib/date'

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(50)
  const [filterAction, setFilterAction] = useState('all')
  const [filterEntity, setFilterEntity] = useState('all')

  useEffect(() => {
    fetchLogs()
  }, [page, itemsPerPage, filterAction, filterEntity])

  const fetchLogs = async () => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range((page - 1) * itemsPerPage, page * itemsPerPage - 1)

      if (filterAction !== 'all') {
        query = query.eq('action_type', filterAction)
      }

      if (filterEntity !== 'all') {
        query = query.eq('entity_type', filterEntity)
      }

      const { data, error } = await query

      if (error) throw error
      setLogs(data || [])
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTotalCount = async () => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })

      if (filterAction !== 'all') {
        query = query.eq('action_type', filterAction)
      }

      if (filterEntity !== 'all') {
        query = query.eq('entity_type', filterEntity)
      }

      const { count } = await query
      return count || 0
    } catch (error) {
      console.error('Error fetching count:', error)
      return 0
    }
  }

  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    const loadCount = async () => {
      const count = await fetchTotalCount()
      setTotalCount(count)
    }
    loadCount()
  }, [filterAction, filterEntity])

  const totalPages = Math.ceil(totalCount / itemsPerPage)

  const columns = [
    {
      key: 'created_at',
      label: 'Date & Time',
      render: (value) => (
        <div>
          <span className="text-slate-400 block">
            {formatDateDDMMYY(value)}
          </span>
          <span className="text-xs text-slate-500">
            {new Date(value).toLocaleTimeString()}
          </span>
        </div>
      ),
    },
    {
      key: 'user_name',
      label: 'User',
      render: (value) => (
        <span className="font-medium text-white">{value}</span>
      ),
    },
    {
      key: 'action_type',
      label: 'Action',
      render: (value) => (
        <span className={`px-2 py-1 text-xs font-semibold rounded ${
          value === 'CREATE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
          value === 'UPDATE' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
          'bg-rose-500/20 text-rose-400 border border-rose-500/30'
        }`}>
          {value}
        </span>
      ),
    },
    {
      key: 'entity_type',
      label: 'Entity',
      render: (value) => (
        <span className="text-slate-300 capitalize">{value}</span>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (value) => {
        if (!value) return <span className="text-slate-500">N/A</span>
        
        // Split by separator if it exists
        const parts = value.split(' | ')
        if (parts.length === 2) {
          return (
            <div className="space-y-1">
              <div className="text-white text-sm">{parts[0]}</div>
              <div className="w-full h-px bg-slate-700 my-1"></div>
              <div className="text-slate-300 text-sm">{parts[1]}</div>
            </div>
          )
        }
        
        // If no separator, just show the value
        return <span className="text-white">{value}</span>
      },
    },
  ]

  if (loading && page === 1) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Audit Logs</h1>
        <p className="text-slate-400">Track all actions performed in the system</p>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Action:</span>
            <select
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Entity:</span>
            <select
              value={filterEntity}
              onChange={(e) => {
                setFilterEntity(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Entities</option>
              <option value="sale">Sale</option>
              <option value="lead">Customer</option>
              <option value="trainer">Partner</option>
              <option value="retract">Retract</option>
            </select>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-slate-400">Items per page:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Activity Log</h3>
          <span className="text-sm text-slate-500">
            Showing {logs.length} of {totalCount} entries
          </span>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <DataTable columns={columns} data={logs} />
        </div>
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

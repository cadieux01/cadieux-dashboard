import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import usePinGate from '../lib/usePinGate'
import { formatDateDDMMYY } from '../lib/date'
import {
  approveOrderChangeRequest,
  listDeliveryRequests,
  listOrderChangeRequests,
  markDeliveryRequestServiceable,
  rejectDeliveryRequest,
  rejectOrderChangeRequest,
} from '../lib/customerRequests'
import Modal from '../components/Modal'
import AlertBanner from '../components/AlertBanner'
import RefreshButton from '../components/RefreshButton'
import useRefreshable from '../lib/useRefreshable'
import { demoBlock } from '../lib/demoData'

// CustomerRequests — admin/sales approval queue for end-customer requests
// raised from the cadieux.in storefront:
//   • order_change_requests   — delivery / item-qty / address edits to an
//                               existing order (admin approves → server
//                               applies the apply_order_*_change RPC).
//   • delivery_requests       — "please deliver to my pincode" raised from
//                               an unserviceable area (admin marks
//                               serviceable, which upserts service_areas
//                               and notifies the customer).
//
// All website mutations go through the dashboard-admin-bridge Edge Function
// (mints a short-lived HMAC token); the browser never sees the website's
// ADMIN_TOKEN or any service-role key. Approve/Reject are PIN-gated via
// the existing usePinGate() — same modal the profile-change queue uses.

function StatusBadge({ status }) {
  const s = (status || 'pending').toLowerCase()
  const map = {
    pending: 'border-amber-700 bg-amber-500/10 text-amber-400',
    approved: 'border-emerald-700 bg-emerald-500/10 text-emerald-400',
    serviceable: 'border-emerald-700 bg-emerald-500/10 text-emerald-400',
    rejected: 'border-rose-700 bg-rose-500/10 text-rose-400',
    cancelled: 'border-slate-700 bg-slate-800/40 text-slate-400',
  }
  const cls = map[s] || 'border-slate-700 bg-slate-800 text-slate-400'
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${cls}`}>
      {s}
    </span>
  )
}

function TypeBadge({ type }) {
  const map = {
    delivery: 'bg-sky-500/10 text-sky-400 border-sky-800',
    items: 'bg-violet-500/10 text-violet-400 border-violet-800',
    address: 'bg-amber-500/10 text-amber-400 border-amber-800',
    delivery_request: 'bg-emerald-500/10 text-emerald-400 border-emerald-800',
  }
  const label =
    type === 'delivery_request' ? 'Pincode' : (type || 'delivery')
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${map[type] || 'border-slate-700 bg-slate-800 text-slate-400'}`}>
      {label}
    </span>
  )
}

// Compact "old → new" diff for order_change_requests. We render whichever
// fields the request touches (delivery_date / delivery_slot / address /
// items / total) and leave the rest blank.
function OrderChangeDiff({ row }) {
  const order = row.order || {}
  const blocks = []

  if (row.requested_delivery_date && row.requested_delivery_date !== order.delivery_date) {
    blocks.push({
      label: 'Date',
      from: order.delivery_date || '—',
      to: row.requested_delivery_date,
    })
  }
  if (row.requested_delivery_slot && row.requested_delivery_slot !== order.delivery_slot) {
    blocks.push({
      label: 'Slot',
      from: order.delivery_slot || '—',
      to: row.requested_delivery_slot,
    })
  }
  if (row.requested_delivery_address && row.requested_delivery_address !== order.delivery_address) {
    blocks.push({
      label: 'Address',
      from: order.delivery_address || '—',
      to: row.requested_delivery_address,
    })
  }
  if (Array.isArray(row.requested_items) && row.requested_items.length > 0) {
    const currentBySlug = new Map(
      (Array.isArray(order.items) ? order.items : []).map((it) => [
        it.slug,
        it.qty ?? it.quantity ?? 0,
      ]),
    )
    row.requested_items.forEach((it) => {
      const newQty = it.qty ?? it.quantity ?? 0
      const oldQty = currentBySlug.get(it.slug) ?? 0
      if (newQty !== oldQty) {
        blocks.push({
          label: it.slug,
          from: `${oldQty}`,
          to: `${newQty}`,
        })
      }
    })
    if (row.requested_total_amount && row.requested_total_amount !== order.total_amount) {
      blocks.push({
        label: 'Total',
        from: `\u20B9${order.total_amount ?? '—'}`,
        to: `\u20B9${row.requested_total_amount}`,
      })
    }
  }

  if (blocks.length === 0) {
    return <span className="text-xs text-slate-500">No diff</span>
  }
  return (
    <div className="space-y-1">
      {blocks.map((b, i) => (
        <div key={i} className="text-xs">
          <span className="text-slate-500">{b.label}: </span>
          <span className="text-slate-400 line-through">{b.from}</span>
          <span className="mx-1 text-slate-500">→</span>
          <span className="text-emerald-400">{b.to}</span>
        </div>
      ))}
    </div>
  )
}

// "Old → new" for delivery_requests is just "this pincode isn't serviced
// yet — approve to add it to service_areas".
function DeliveryRequestSummary({ row }) {
  return (
    <div className="space-y-1 text-xs text-slate-400">
      <div>
        <span className="text-slate-500">Pincode:</span>{' '}
        <span className="font-mono text-slate-200">{row.pincode || '—'}</span>
      </div>
      {row.area_name && (
        <div>
          <span className="text-slate-500">Area:</span>{' '}
          <span className="text-slate-300">{row.area_name}</span>
        </div>
      )}
      {row.address && (
        <div className="truncate">
          <span className="text-slate-500">Address:</span>{' '}
          <span className="text-slate-300">{row.address}</span>
        </div>
      )}
    </div>
  )
}

export default function CustomerRequests({ embedded = false }) {
  const { isDemo } = useAuth()
  const { gate, PinGateElement } = usePinGate()

  // Merged feed of order-change-requests + delivery-requests. Each row gets
  // a synthetic `kind` so the same table can render both.
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('pending')

  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    if (isDemo) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      // The two website endpoints use slightly different status vocabularies
      // ('approved' vs 'serviceable'). When filtering by "approved", ask the
      // delivery-requests endpoint for 'serviceable' instead.
      const ocStatus = statusFilter
      const drStatus =
        statusFilter === 'approved' ? 'serviceable' : statusFilter
      const [oc, dr] = await Promise.all([
        listOrderChangeRequests(ocStatus).catch((e) => {
          console.error('order-change-requests fetch failed', e)
          return []
        }),
        listDeliveryRequests(drStatus).catch((e) => {
          console.error('delivery-requests fetch failed', e)
          return []
        }),
      ])
      const merged = [
        ...oc.map((r) => ({ ...r, kind: 'order_change' })),
        ...dr.map((r) => ({ ...r, kind: 'delivery_request' })),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      setRows(merged)
    } catch (e) {
      console.error('CustomerRequests load failed:', e)
      setBanner({
        type: 'error',
        title: 'Failed to load requests',
        message: e.message,
      })
    } finally {
      setLoading(false)
    }
  }, [isDemo, statusFilter])

  const { refresh, refreshing } = useRefreshable(() => load())

  useEffect(() => {
    load()
  }, [load])

  const handleApproveOrderChange = async (row) => {
    if (isDemo) {
      demoBlock('Approving customer requests is disabled in demo mode')
      return
    }
    try {
      setBusyId(row.id)
      await approveOrderChangeRequest(row.id)
      setBanner({
        type: 'success',
        title: 'Approved',
        message: 'The customer\u2019s requested change has been applied.',
      })
      await load()
    } catch (e) {
      setBanner({ type: 'error', title: 'Approve failed', message: e.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleApproveDeliveryRequest = async (row) => {
    if (isDemo) {
      demoBlock('Approving customer requests is disabled in demo mode')
      return
    }
    try {
      setBusyId(row.id)
      await markDeliveryRequestServiceable(row.id, {
        areaName: row.area_name || undefined,
      })
      setBanner({
        type: 'success',
        title: 'Pincode marked serviceable',
        message: `Pincode ${row.pincode} is now in your service area.`,
      })
      await load()
    } catch (e) {
      setBanner({ type: 'error', title: 'Approve failed', message: e.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirmReject = async () => {
    const row = rejectTarget
    if (!row) return
    try {
      setBusyId(row.id)
      if (row.kind === 'delivery_request') {
        await rejectDeliveryRequest(row.id, rejectReason || undefined)
      } else {
        await rejectOrderChangeRequest(row.id, rejectReason || undefined)
      }
      setBanner({
        type: 'success',
        title: 'Rejected',
        message: 'The customer will see the updated status on their order page.',
      })
      setRejectTarget(null)
      setRejectReason('')
      await load()
    } catch (e) {
      setBanner({ type: 'error', title: 'Reject failed', message: e.message })
    } finally {
      setBusyId(null)
    }
  }

  const counts = useMemo(() => {
    const c = { total: rows.length, order_change: 0, delivery_request: 0 }
    rows.forEach((r) => {
      if (r.kind === 'order_change') c.order_change += 1
      else c.delivery_request += 1
    })
    return c
  }, [rows])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'dashboard-page'}>
      {!embedded && (
        <div className="dashboard-page-header">
          <div className="min-w-0">
            <h1 className="dashboard-title">Customer Requests</h1>
            <p className="dashboard-subtitle hidden truncate sm:block">
              Approve or reject end-customer changes to existing orders and new
              pincode coverage requests.
            </p>
          </div>
          <RefreshButton onRefresh={refresh} loading={refreshing} />
        </div>
      )}

      {embedded && (
        <div className="mb-4 flex justify-end">
          <RefreshButton onRefresh={refresh} loading={refreshing} />
        </div>
      )}

      {banner && (
        <div className="mb-6">
          <AlertBanner
            type={banner.type}
            title={banner.title}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="dashboard-select max-w-[180px]"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <div className="text-xs text-slate-400">
            {counts.total} total &middot; {counts.order_change} order &middot;{' '}
            {counts.delivery_request} pincode
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-slate-100">Requests</h3>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No customer requests at this status.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Change</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => {
                  const isPending = (row.status || 'pending').toLowerCase() === 'pending'
                  const customer =
                    row.customer ||
                    (row.kind === 'delivery_request'
                      ? { full_name: null, phone: row.phone }
                      : null)
                  return (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td className="px-4 py-3 align-top">
                        <TypeBadge
                          type={
                            row.kind === 'delivery_request'
                              ? 'delivery_request'
                              : row.type || 'delivery'
                          }
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-sm text-slate-200">
                          {customer?.full_name || 'Unknown customer'}
                        </div>
                        {customer?.phone && (
                          <div className="text-xs text-slate-500 font-mono">
                            {customer.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top max-w-[420px]">
                        {row.kind === 'delivery_request' ? (
                          <DeliveryRequestSummary row={row} />
                        ) : (
                          <OrderChangeDiff row={row} />
                        )}
                        {row.reason && (
                          <div className="mt-1 text-xs italic text-slate-500">
                            &ldquo;{row.reason}&rdquo;
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-400">
                        {formatDateDDMMYY(row.created_at)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {isPending ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() =>
                                gate(() => {
                                  if (row.kind === 'delivery_request') {
                                    handleApproveDeliveryRequest(row)
                                  } else {
                                    handleApproveOrderChange(row)
                                  }
                                }, 'Approve customer request')
                              }
                              disabled={busyId === row.id}
                              className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                              {busyId === row.id ? '…' : 'Approve'}
                            </button>
                            <button
                              onClick={() =>
                                gate(() => {
                                  setRejectReason('')
                                  setRejectTarget(row)
                                }, 'Reject customer request')
                              }
                              disabled={busyId === row.id}
                              className="rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {PinGateElement}

      <Modal
        isOpen={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null)
          setRejectReason('')
        }}
        title="Reject request"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Add an optional note for the customer.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason"
            rows={3}
            className="dashboard-input w-full"
          />
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setRejectTarget(null)
                setRejectReason('')
              }}
              disabled={busyId === rejectTarget?.id}
              className="rounded px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmReject}
              disabled={busyId === rejectTarget?.id}
              className="rounded bg-rose-500/20 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/30 disabled:opacity-50"
            >
              {busyId === rejectTarget?.id ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

import { Fragment, useEffect, useRef, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { useAuth } from '../context/AuthContext'
import { formatDateTimeDDMMYY } from '../lib/date'
import RefreshButton from '../components/RefreshButton'
import WheelDateTime from '../components/WheelDateTime'
import {
  getShelfLife,
  updateShelfLife,
  listBatches,
  createBatch,
  editBatch,
  fmtBatchLeft,
  VARIANT_KEYS,
} from '../lib/batches'

// ============================================================================
// Central Stock (admin) — production BATCHES with a carried shelf-life clock.
//   • Each batch starts a clock at created_at; expiry = created_at + the
//     variant's shelf life. A live countdown ticks client-side.
//   • Create / edit batches and edit the shelf-life settings (admin only).
// This is the NEW batch system; it coexists with the old stock_pool / Allot
// flow for now (reconciled in a later stage).
// ============================================================================

const CARD = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6'

export default function CentralStock() {
  const { isDemo } = useAuth()

  const [shelf, setShelf] = useState({ multigrain: 3, plain: 6 })
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [filter, setFilter] = useState('all')

  // Shelf-life edit
  const [shelfEdit, setShelfEdit] = useState(null) // variant key or null
  const [shelfValue, setShelfValue] = useState('')
  const [shelfBusy, setShelfBusy] = useState(false)
  const [shelfErr, setShelfErr] = useState(null)

  // Create batch (when = the batch-start clock; defaults to now)
  const [createForm, setCreateForm] = useState({ variant: 'multigrain', quantity: '', when: new Date() })
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState(null)

  // Edit batch
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({ quantity: '', when: new Date() })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState(null)

  const tickRef = useRef(null)
  const pollRef = useRef(null)

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const [s, b] = await Promise.all([getShelfLife(), listBatches()])
      setShelf(s)
      setBatches(b)
    } catch (e) {
      console.warn('Central stock load failed:', e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (isDemo) {
      setLoading(false)
      return
    }
    load()
    // Tick the countdown every second (no DB hit); refetch every 60s.
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    pollRef.current = setInterval(() => load(true), 60000)
    return () => {
      clearInterval(tickRef.current)
      clearInterval(pollRef.current)
    }
  }, [isDemo])

  const expiredAt = (b) => {
    const exp = b.expiry_at ? new Date(b.expiry_at).getTime() : null
    return exp != null && now >= exp
  }

  // Available central stock = remaining units across NON-expired batches.
  const availableByVariant = (variant) =>
    batches
      .filter((b) => b.variant === variant && !expiredAt(b))
      .reduce((sum, b) => sum + (b.quantity_remaining || 0), 0)

  const visibleBatches = batches.filter((b) => filter === 'all' || b.variant === filter)

  // --- handlers ---
  const openShelf = (variant) => {
    setShelfEdit(variant)
    setShelfValue(String(shelf[variant] ?? ''))
    setShelfErr(null)
  }

  const submitShelf = async (e) => {
    e.preventDefault()
    setShelfErr(null)
    const days = parseInt(shelfValue, 10)
    if (Number.isNaN(days) || days < 1) { setShelfErr('Enter at least 1 day.'); return }
    setShelfBusy(true)
    try {
      await updateShelfLife({ variant: shelfEdit, days })
      setShelfEdit(null)
      await load(true)
    } catch (e2) {
      setShelfErr(e2.message)
    } finally {
      setShelfBusy(false)
    }
  }

  const submitCreate = async (e) => {
    e.preventDefault()
    setCreateErr(null)
    const quantity = parseInt(createForm.quantity, 10)
    if (Number.isNaN(quantity) || quantity <= 0) { setCreateErr('Enter a quantity (1 or more).'); return }
    setCreateBusy(true)
    try {
      await createBatch({
        variant: createForm.variant,
        quantity,
        createdAt: createForm.when instanceof Date ? createForm.when.toISOString() : null,
      })
      setCreateForm({ variant: createForm.variant, quantity: '', when: new Date() })
      await load(true)
    } catch (e2) {
      setCreateErr(e2.message)
    } finally {
      setCreateBusy(false)
    }
  }

  const openEdit = (b) => {
    setEditId(b.id)
    const when = b.created_at ? new Date(b.created_at) : new Date()
    setEditForm({ quantity: String(b.quantity), when: Number.isNaN(when.getTime()) ? new Date() : when })
    setEditErr(null)
  }

  const submitEdit = async (e) => {
    e.preventDefault()
    setEditErr(null)
    const quantity = parseInt(editForm.quantity, 10)
    if (Number.isNaN(quantity) || quantity <= 0) { setEditErr('Enter a quantity (1 or more).'); return }
    setEditBusy(true)
    try {
      await editBatch({
        batchId: editId,
        quantity,
        createdAt: editForm.when instanceof Date ? editForm.when.toISOString() : null,
      })
      setEditId(null)
      await load(true)
    } catch (e2) {
      setEditErr(e2.message)
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div className="min-w-0">
          <h1 className="dashboard-title">Batches</h1>
          <p className="dashboard-subtitle hidden truncate sm:block">
            Production batches with a live shelf-life countdown. Oldest first (FIFO).
          </p>
        </div>
        <RefreshButton onRefresh={() => load(true)} loading={refreshing} />
      </div>

      {isDemo ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Central stock is not available in demo mode.</p>
        </div>
      ) : loading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      ) : (
        <>
          {/* 1. New batch */}
          <div className={CARD}>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">New batch</h2>
            <form onSubmit={submitCreate} className="space-y-3">
              <select
                value={createForm.variant}
                onChange={(e) => setCreateForm({ ...createForm, variant: e.target.value })}
                className="dashboard-select"
              >
                <option value="multigrain">{VARIANTS.multigrain.short}</option>
                <option value="plain">{VARIANTS.plain.short}</option>
              </select>
              <input
                type="number"
                min="1"
                value={createForm.quantity}
                onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })}
                className="dashboard-input"
                placeholder="Quantity"
              />
              <WheelDateTime
                label="Batch start (clock)"
                value={createForm.when}
                onChange={(dt) => setCreateForm({ ...createForm, when: dt })}
              />
              {createErr && <p className="text-sm font-semibold text-rose-400">{createErr}</p>}
              <button type="submit" disabled={createBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50">
                {createBusy ? '…' : 'Create batch'}
              </button>
            </form>
          </div>

          {/* 2. Shelf-life settings */}
          <div className={CARD}>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Shelf life</h2>
            <div className="grid grid-cols-2 gap-3">
              {VARIANT_KEYS.map((v) => (
                <div key={v} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">{VARIANTS[v]?.short || v}</p>
                  <p className="mt-1 font-display text-3xl font-bold text-slate-100">
                    {shelf[v]} <span className="text-base font-normal text-slate-500">day{shelf[v] === 1 ? '' : 's'}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => openShelf(v)}
                    className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>

            {shelfEdit && (
              <form onSubmit={submitShelf} className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-sm font-semibold text-slate-200">
                  Shelf life — {VARIANTS[shelfEdit]?.short || shelfEdit}
                </p>
                <input
                  type="number"
                  min="1"
                  value={shelfValue}
                  onChange={(e) => setShelfValue(e.target.value)}
                  className="dashboard-input"
                  placeholder="Days"
                />
                <p className="text-xs text-slate-500">Changing this recomputes every {VARIANTS[shelfEdit]?.short || shelfEdit} batch&apos;s expiry.</p>
                {shelfErr && <p className="text-sm font-semibold text-rose-400">{shelfErr}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={shelfBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50">
                    {shelfBusy ? '…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setShelfEdit(null)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 3. Available stock — per-batch table, FIFO oldest first, live countdown */}
          <div className={CARD}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-100">Available stock</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {VARIANT_KEYS.map((v) => `${VARIANTS[v]?.short || v}: ${availableByVariant(v)}`).join(' · ')} · non-expired units
                </p>
              </div>
              <div className="flex flex-shrink-0 gap-1">
                {['all', 'multigrain', 'plain'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      filter === f ? 'bg-emerald-600 text-[#fbf3d4]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {f === 'all' ? 'All' : VARIANTS[f]?.short || f}
                  </button>
                ))}
              </div>
            </div>

            {visibleBatches.length === 0 ? (
              <p className="text-sm text-slate-400">No batches yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-3 font-medium">Batch</th>
                      <th className="py-2 pr-3 font-medium">Variant</th>
                      <th className="py-2 pr-3 font-medium">Units</th>
                      <th className="py-2 pr-3 font-medium">Started</th>
                      <th className="py-2 pr-3 font-medium">Countdown</th>
                      <th className="py-2 font-medium text-right">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatches.map((b) => {
                      const exp = b.expiry_at ? new Date(b.expiry_at).getTime() : null
                      const ms = exp != null ? exp - now : null
                      const expired = ms != null && ms <= 0
                      return (
                        <Fragment key={b.id}>
                          <tr className={`border-b border-slate-800/70 ${expired ? 'bg-rose-950/20' : ''}`}>
                            <td className="py-2.5 pr-3 font-medium text-slate-100">#{b.batch_number}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{b.variant_label}</td>
                            <td className="py-2.5 pr-3 text-slate-300">
                              {b.quantity_remaining}<span className="text-slate-500">/{b.quantity}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-slate-400">{formatDateTimeDDMMYY(b.created_at)}</td>
                            <td className={`py-2.5 pr-3 font-semibold ${expired ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {ms == null ? '—' : fmtBatchLeft(ms)}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => (editId === b.id ? setEditId(null) : openEdit(b))}
                                className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                              >
                                {editId === b.id ? 'Close' : 'Edit'}
                              </button>
                            </td>
                          </tr>
                          {editId === b.id && (
                            <tr>
                              <td colSpan={6} className="pb-3">
                                <form onSubmit={submitEdit} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-400">Quantity</label>
                                    <input
                                      type="number"
                                      min="1"
                                      value={editForm.quantity}
                                      onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                                      className="dashboard-input"
                                    />
                                  </div>
                                  <WheelDateTime
                                    label="Batch start (clock)"
                                    value={editForm.when}
                                    onChange={(dt) => setEditForm({ ...editForm, when: dt })}
                                  />
                                  {editErr && <p className="text-sm font-semibold text-rose-400">{editErr}</p>}
                                  <div className="flex gap-2">
                                    <button type="submit" disabled={editBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50">
                                      {editBusy ? '…' : 'Save'}
                                    </button>
                                    <button type="button" onClick={() => setEditId(null)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

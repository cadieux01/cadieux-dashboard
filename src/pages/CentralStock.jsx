import { useEffect, useRef, useState } from 'react'
import { VARIANTS } from '../lib/demoData'
import { useAuth } from '../context/AuthContext'
import { formatDateTimeDDMMYY } from '../lib/date'
import RefreshButton from '../components/RefreshButton'
import {
  getShelfLife,
  updateShelfLife,
  listBatches,
  createBatch,
  editBatch,
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

// Format a millisecond remaining span as "Xd Yh left" / "Yh Zm left" / "Zm left".
function fmtLeft(ms) {
  if (ms <= 0) return 'Expired'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

// Date -> value for <input type="datetime-local"> in LOCAL time.
function toLocalInput(value) {
  const dt = value ? new Date(value) : new Date()
  if (Number.isNaN(dt.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

// datetime-local string (local) -> ISO (UTC) for the RPC; '' -> null (= now()).
function localInputToISO(v) {
  if (!v) return null
  const dt = new Date(v)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

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

  // Create batch
  const [createForm, setCreateForm] = useState({ variant: 'multigrain', quantity: '', createdAt: '' })
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState(null)

  // Edit batch
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({ quantity: '', createdAt: '' })
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
        createdAt: localInputToISO(createForm.createdAt),
      })
      setCreateForm({ variant: createForm.variant, quantity: '', createdAt: '' })
      await load(true)
    } catch (e2) {
      setCreateErr(e2.message)
    } finally {
      setCreateBusy(false)
    }
  }

  const openEdit = (b) => {
    setEditId(b.id)
    setEditForm({ quantity: String(b.quantity), createdAt: toLocalInput(b.created_at) })
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
        createdAt: localInputToISO(editForm.createdAt),
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
          <h1 className="dashboard-title">Central Stock</h1>
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
          {/* Available central stock (non-expired batches) */}
          <div className={CARD}>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Available central stock</h2>
            <div className="grid grid-cols-2 gap-3">
              {VARIANT_KEYS.map((v) => (
                <div key={v} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">{VARIANTS[v]?.short || v}</p>
                  <p className="mt-1 font-display text-4xl font-bold text-slate-100">{availableByVariant(v)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">units · non-expired batches</p>
                </div>
              ))}
            </div>
          </div>

          {/* Shelf-life settings */}
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

          {/* Create batch */}
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
              <div>
                <label className="mb-1 block text-xs text-slate-400">Batch start (clock). Leave blank for now.</label>
                <input
                  type="datetime-local"
                  value={createForm.createdAt}
                  onChange={(e) => setCreateForm({ ...createForm, createdAt: e.target.value })}
                  className="dashboard-input"
                />
              </div>
              {createErr && <p className="text-sm font-semibold text-rose-400">{createErr}</p>}
              <button type="submit" disabled={createBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-[#fbf3d4] hover:bg-emerald-500 disabled:opacity-50">
                {createBusy ? '…' : 'Create batch'}
              </button>
            </form>
          </div>

          {/* Batches list */}
          <div className={CARD}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">Batches</h2>
              <div className="flex gap-1">
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
              <div className="space-y-2">
                {visibleBatches.map((b) => {
                  const exp = b.expiry_at ? new Date(b.expiry_at).getTime() : null
                  const ms = exp != null ? exp - now : null
                  const expired = ms != null && ms <= 0
                  return (
                    <div key={b.id} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100">
                            #{b.batch_number} · {b.variant_label}
                          </p>
                          <p className="text-xs text-slate-500">
                            {b.quantity_remaining}/{b.quantity} left · started {formatDateTimeDDMMYY(b.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <span className={`text-sm font-semibold ${expired ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {ms == null ? '—' : fmtLeft(ms)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      {editId === b.id && (
                        <form onSubmit={submitEdit} className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
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
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">Batch start (clock)</label>
                            <input
                              type="datetime-local"
                              value={editForm.createdAt}
                              onChange={(e) => setEditForm({ ...editForm, createdAt: e.target.value })}
                              className="dashboard-input"
                            />
                          </div>
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
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

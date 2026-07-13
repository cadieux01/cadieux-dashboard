import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, MessageCircle, RefreshCw, User } from 'lucide-react'
import {
  closeConversation,
  getConversation,
  listConversations,
  reopenConversation,
  resolveConversation,
} from '../lib/whatsappChat'
import RefreshButton from '../components/RefreshButton'
import AlertBanner from '../components/AlertBanner'
import useRefreshable from '../lib/useRefreshable'

// Chat — super-admin-only queue for WhatsApp conversations. Displays flagged
// (needs_human) threads at the top, followed by open and closed. Clicking a
// row loads the full message history and lets the admin "Mark resolved",
// which flips status back to `open`. The next automated bot handoff will
// re-flag and fire a fresh email alert.
//
// Access control: route is guarded by <ProtectedRoute requiredRole="admin">
// AND the nav entry is only present in adminNavigation. Sales / partner
// never see the link and cannot reach the page even by URL.
//
// Deep-link: emailed alerts include `?conversation=<id>` — we auto-select
// that thread on mount.

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'needs_human', label: 'Flagged' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
]

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase()
  const map = {
    needs_human: 'border-rose-700 bg-rose-500/10 text-rose-300',
    open: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
    closed: 'border-slate-700 bg-slate-800/40 text-slate-400',
  }
  const label = s === 'needs_human' ? 'Flagged' : s || 'open'
  const cls = map[s] || 'border-slate-700 bg-slate-800 text-slate-400'
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function WindowPill({ open }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        open
          ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
          : 'border-slate-700 bg-slate-800/50 text-slate-400'
      }`}
      title={open ? 'Within 24h free-reply window' : 'Outside 24h free-reply window'}
    >
      24h {open ? 'open' : 'closed'}
    </span>
  )
}

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const opts = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
  return d.toLocaleString(undefined, opts)
}

function labelReason(reason) {
  const map = {
    handoff: 'Bot requested human handoff',
    fallback: 'Bot could not generate a reply',
    send_failed: 'Bot reply failed to send',
    rate_limited: 'Customer rate-limited',
  }
  return map[reason] || reason || 'Needs human attention'
}

function truncate(s, n = 90) {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSelectedRef = useRef(searchParams.get('conversation') || null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [conversations, setConversations] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState(null)

  const [selectedId, setSelectedId] = useState(initialSelectedRef.current)
  const [thread, setThread] = useState(null) // { conversation, messages }
  const [loadingThread, setLoadingThread] = useState(false)
  const [threadError, setThreadError] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const rows = await listConversations(statusFilter)
      setConversations(rows)
      // If we came in with a deep-link but the id isn't in the list yet,
      // keep it selected — the thread fetch will still work.
      if (!selectedId && rows.length > 0) {
        setSelectedId(rows[0].id)
      }
    } catch (err) {
      setListError(err?.message || 'Failed to load conversations')
    } finally {
      setLoadingList(false)
    }
  }, [statusFilter, selectedId])

  const { refresh: refreshList, refreshing } = useRefreshable(loadList, {
    auto: true,
    intervalMs: 30000,
  })

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const loadThread = useCallback(async (id) => {
    if (!id) {
      setThread(null)
      return
    }
    setLoadingThread(true)
    setThreadError(null)
    try {
      const data = await getConversation(id)
      setThread(data)
    } catch (err) {
      setThreadError(err?.message || 'Failed to load messages')
      setThread(null)
    } finally {
      setLoadingThread(false)
    }
  }, [])

  useEffect(() => {
    loadThread(selectedId)
  }, [selectedId, loadThread])

  // Reflect selected id in the URL so a browser refresh keeps context.
  useEffect(() => {
    const current = searchParams.get('conversation')
    if (selectedId && selectedId !== current) {
      const next = new URLSearchParams(searchParams)
      next.set('conversation', selectedId)
      setSearchParams(next, { replace: true })
    }
  }, [selectedId, searchParams, setSearchParams])

  const handleResolve = useCallback(async () => {
    if (!thread?.conversation) return
    setActionBusy(true)
    try {
      await resolveConversation(thread.conversation.id)
      await Promise.all([loadList(), loadThread(thread.conversation.id)])
    } catch (err) {
      setThreadError(err?.message || 'Failed to resolve')
    } finally {
      setActionBusy(false)
    }
  }, [thread, loadList, loadThread])

  const handleClose = useCallback(async () => {
    if (!thread?.conversation) return
    setActionBusy(true)
    try {
      await closeConversation(thread.conversation.id)
      await Promise.all([loadList(), loadThread(thread.conversation.id)])
    } catch (err) {
      setThreadError(err?.message || 'Failed to close')
    } finally {
      setActionBusy(false)
    }
  }, [thread, loadList, loadThread])

  const handleReopen = useCallback(async () => {
    if (!thread?.conversation) return
    setActionBusy(true)
    try {
      await reopenConversation(thread.conversation.id)
      await Promise.all([loadList(), loadThread(thread.conversation.id)])
    } catch (err) {
      setThreadError(err?.message || 'Failed to reopen')
    } finally {
      setActionBusy(false)
    }
  }, [thread, loadList, loadThread])

  const flaggedCount = useMemo(
    () => conversations.filter((c) => c.status === 'needs_human').length,
    [conversations],
  )

  return (
    <div className="dashboard-page px-4 py-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <MessageCircle size={20} className="text-emerald-400" />
            WhatsApp chat
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Flagged conversations appear first. Resolving arms the next
            automatic email alert for this contact.
          </p>
        </div>
        <RefreshButton onRefresh={refreshList} loading={refreshing} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.key
          const showBadge = tab.key === 'needs_human' && flaggedCount > 0
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-emerald-600 bg-emerald-500/15 text-emerald-200'
                  : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
              }`}
            >
              {tab.label}
              {showBadge && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {flaggedCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {listError && (
        <AlertBanner type="error" title="Could not load conversations" message={listError} />
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* List */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {loadingList ? 'Loading…' : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
          </div>
          <ul className="max-h-[70vh] overflow-y-auto">
            {conversations.length === 0 && !loadingList && (
              <li className="px-4 py-6 text-sm text-slate-500">No conversations.</li>
            )}
            {conversations.map((c) => {
              const active = c.id === selectedId
              const name = c.customer?.full_name || c.phone
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full border-b border-slate-800 px-3 py-3 text-left transition-colors ${
                      active ? 'bg-emerald-500/10' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-100">{name}</span>
                          <StatusPill status={c.status} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {c.phone}
                          {c.customer?.full_name ? ` · ${c.customer.full_name}` : ''}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-400">
                          {c.last_message
                            ? `${c.last_message.direction === 'in' ? '↙' : '↗'} ${truncate(c.last_message.body, 60)}`
                            : 'No messages yet'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-[10px] text-slate-500">
                        <span>{formatWhen(c.last_message_at)}</span>
                        <WindowPill open={c.window_open} />
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Thread */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          {!selectedId && (
            <div className="p-10 text-center text-sm text-slate-500">
              Select a conversation to view messages.
            </div>
          )}
          {selectedId && (
            <ThreadView
              thread={thread}
              loading={loadingThread}
              error={threadError}
              actionBusy={actionBusy}
              onResolve={handleResolve}
              onClose={handleClose}
              onReopen={handleReopen}
              onRefresh={() => loadThread(selectedId)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadView({ thread, loading, error, actionBusy, onResolve, onClose, onReopen, onRefresh }) {
  const conv = thread?.conversation
  const messages = thread?.messages || []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <User size={16} className="text-slate-400" />
            <span className="truncate text-sm font-bold text-slate-100">
              {conv?.customer?.full_name || conv?.phone || 'Conversation'}
            </span>
            {conv && <StatusPill status={conv.status} />}
            {conv && <WindowPill open={conv.window_open} />}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {conv?.phone}
            {conv?.last_handoff_at ? ` · Last handoff ${formatWhen(conv.last_handoff_at)} — ${labelReason(conv.handoff_reason)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {conv?.status === 'needs_human' && (
            <button
              type="button"
              onClick={onResolve}
              disabled={actionBusy}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-600 bg-emerald-500/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              Mark resolved
            </button>
          )}
          {conv?.status === 'open' && (
            <button
              type="button"
              onClick={onClose}
              disabled={actionBusy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              Close
            </button>
          )}
          {conv?.status === 'closed' && (
            <button
              type="button"
              onClick={onReopen}
              disabled={actionBusy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 pt-3">
          <AlertBanner type="error" title="Thread error" message={error} />
        </div>
      )}

      <div className="max-h-[65vh] flex-1 overflow-y-auto px-4 py-4">
        {loading && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="py-10 text-center text-sm text-slate-500">No messages in this conversation.</div>
        )}
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }) {
  const inbound = msg.direction === 'in'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          inbound
            ? 'rounded-bl-sm border border-slate-700 bg-slate-800/70 text-slate-100'
            : 'rounded-br-sm border border-emerald-800 bg-emerald-500/15 text-emerald-50'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${inbound ? 'text-slate-500' : 'text-emerald-300/80'}`}>
          <span>{formatWhen(msg.sent_at || msg.created_at)}</span>
          {msg.ai_generated && !inbound && <span>· auto</span>}
          {msg.status && !inbound && <span>· {msg.status}</span>}
        </div>
      </div>
    </div>
  )
}

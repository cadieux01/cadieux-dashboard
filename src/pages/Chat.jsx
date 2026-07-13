import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, MessageCircle, RefreshCw, User } from 'lucide-react'
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

      {/* Mobile-first split-view: on <lg we show either the list OR the thread,
          controlled by whether a conversation is selected. On lg+ both panes
          are always visible side-by-side. */}
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* List */}
        <div
          className={`rounded-xl border border-slate-800 bg-slate-900/60 lg:block ${
            selectedId ? 'hidden' : 'block'
          }`}
        >
          <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {loadingList ? 'Loading…' : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
          </div>
          <ul className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto">
            {conversations.length === 0 && !loadingList && (
              <li className="px-4 py-6 text-sm text-slate-400">No conversations.</li>
            )}
            {conversations.map((c) => {
              const active = c.id === selectedId
              const flagged = c.status === 'needs_human'
              const name = c.customer?.full_name || c.phone
              // Row treatment: flagged rows get a rose left-accent and a
              // subtle rose tint so they read as priority at a glance.
              // Active row wins on background but keeps the flagged accent.
              const base = 'w-full border-l-4 px-3 py-3 text-left transition-colors'
              const accent = flagged ? 'border-l-rose-500' : 'border-l-transparent'
              const bg = active
                ? 'bg-emerald-500/15'
                : flagged
                ? 'bg-rose-500/[0.06] hover:bg-rose-500/10'
                : 'hover:bg-slate-800/40'
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`${base} ${accent} ${bg}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-100">{name}</span>
                          <StatusPill status={c.status} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {c.phone}
                          {c.customer?.full_name ? ` · ${c.customer.full_name}` : ''}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-300">
                          {c.last_message
                            ? `${c.last_message.direction === 'in' ? '↙' : '↗'} ${truncate(c.last_message.body, 60)}`
                            : 'No messages yet'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-[10px] text-slate-400">
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
        <div
          className={`rounded-xl border border-slate-800 bg-slate-900/60 lg:block ${
            selectedId ? 'block' : 'hidden'
          }`}
        >
          {!selectedId && (
            <div className="p-10 text-center text-sm text-slate-400">
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
              onBack={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadView({ thread, loading, error, actionBusy, onResolve, onClose, onReopen, onRefresh, onBack }) {
  const conv = thread?.conversation
  const messages = thread?.messages || []
  // Strip everything except digits so wa.me accepts it (E.164 without the +).
  const waDigits = (conv?.phone || '').replace(/\D+/g, '')
  const waHref = waDigits ? `https://wa.me/${waDigits}` : null

  return (
    <div className="flex h-full flex-col">
      {/* Header — customer identity + status */}
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-start gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 p-1.5 text-slate-200 hover:border-slate-500 lg:hidden"
              aria-label="Back to conversation list"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <User size={16} className="shrink-0 text-slate-400" />
              <span className="truncate text-base font-bold text-slate-100">
                {conv?.customer?.full_name || conv?.phone || 'Conversation'}
              </span>
            </div>
            {conv?.phone && (
              <div className="mt-1 text-xs text-slate-400">{conv.phone}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {conv && <StatusPill status={conv.status} />}
              {conv && <WindowPill open={conv.window_open} />}
            </div>
            {conv?.last_handoff_at && (
              <div className="mt-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Last handoff:</span>{' '}
                {formatWhen(conv.last_handoff_at)} — {labelReason(conv.handoff_reason)}
              </div>
            )}
          </div>
        </div>

        {/* Actions — "Reply on WhatsApp" is the primary action here because
            the operator replies from the business phone, not from this UI.
            "Mark resolved" is emphasised whenever the thread is flagged. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500"
            >
              <ExternalLink size={13} />
              Reply on WhatsApp
            </a>
          )}
          {conv?.status === 'needs_human' && (
            <button
              type="button"
              onClick={onResolve}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-500 bg-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-500/40 disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              Close
            </button>
          )}
          {conv?.status === 'closed' && (
            <button
              type="button"
              onClick={onReopen}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"
            disabled={loading}
            aria-label="Refresh thread"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 pt-3">
          <AlertBanner type="error" title="Thread error" message={error} />
        </div>
      )}

      <div className="max-h-[65vh] flex-1 overflow-y-auto px-4 py-4">
        {loading && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="py-10 text-center text-sm text-slate-400">No messages in this conversation.</div>
        )}
        <div className="space-y-4">
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
  // High-contrast bubbles. Inbound (customer) = light bubble + dark ink;
  // outbound (bot/team) = solid emerald + cream ink. Meta line uses a
  // deliberately visible muted tone on each side so timestamps stop
  // vanishing into the bubble.
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[85%] flex-col ${inbound ? 'items-start' : 'items-end'}`}>
        <span
          className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${
            inbound ? 'text-slate-400' : 'text-emerald-300'
          }`}
        >
          {inbound ? 'Customer' : msg.ai_generated ? 'Bot' : 'Team'}
        </span>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
            inbound
              ? 'rounded-bl-sm bg-slate-100 text-slate-900'
              : 'rounded-br-sm bg-emerald-700 text-emerald-50'
          }`}
        >
          <div className="whitespace-pre-wrap break-words leading-snug">{msg.body}</div>
          <div
            className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] ${
              inbound ? 'text-slate-600' : 'text-emerald-100'
            }`}
          >
            <span>{formatWhen(msg.sent_at || msg.created_at)}</span>
            {msg.ai_generated && !inbound && <span>· auto</span>}
            {msg.status && !inbound && <span>· {msg.status}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

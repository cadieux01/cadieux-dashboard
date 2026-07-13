import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  User,
} from 'lucide-react'
import {
  closeConversation,
  getConversation,
  listConversations,
  reopenConversation,
  resolveConversation,
  sendMessage,
} from '../lib/whatsappChat'
import RefreshButton from '../components/RefreshButton'
import AlertBanner from '../components/AlertBanner'
import useRefreshable from '../lib/useRefreshable'

// Chat — super-admin queue for WhatsApp conversations.
// This is the ONLY place we can read + reply to customers, because 919989153747
// is a MSG91 Business API number and CAN'T be opened in the WhatsApp app.
//
// PLAIN-LANGUAGE TABS (mapped to raw statuses):
//   All          → all statuses
//   Needs reply  → status = 'needs_human'  (was "Flagged")
//   Active       → status = 'open'         (was "Open")
//   Done         → status = 'closed'       (was "Closed")
// The internal DB values are unchanged — this rename is UI-only so a
// non-developer isn't reading "needs_human" / "handoff" jargon.
//
// COLOURS (all verified ≥ 4.5:1 on the dashboard's slate-950 page):
//   Customer bubble (LEFT)  bg-white           / text-slate-900      ~16:1
//   Team bubble    (RIGHT)  bg-emerald-600     / text-white          ~4.9:1
//   Bot bubble     (RIGHT)  bg-emerald-800     / text-emerald-50     ~8.5:1
//     + small "Bot" pill so a glance tells you who spoke
//   In-bubble meta          text-slate-500 (light) / emerald-50/95 (dark)
//   List timestamps         text-slate-400 on slate-900              ~5.2:1
//   Needs-reply accent      rose-500 left rail + rose-950/40 bg tint
//
// 24-HOUR RULE: Meta only allows free-form replies within 24h of the
// customer's LAST inbound message. The conversation payload already
// carries `last_inbound_at` + `window_open`. We compute the countdown
// client-side and DISABLE the reply box when closed, showing a Call
// button and plain-language explanation instead of ever letting a send
// silently fail. The server /send route mirrors the same 24h check —
// belt-and-braces.

// Plain-language tabs. Order = the user's mental order: everything, then
// the to-do list, then in-progress, then archive.
const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'needs_human', label: 'Needs reply' },
  { key: 'open', label: 'Active' },
  { key: 'closed', label: 'Done' },
]

const WINDOW_MS = 24 * 60 * 60 * 1000

function statusPlain(s) {
  const k = String(s || '').toLowerCase()
  if (k === 'needs_human') return 'Needs reply'
  if (k === 'closed') return 'Done'
  if (k === 'open') return 'Active'
  return k || 'Active'
}

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase()
  const map = {
    needs_human: 'border-rose-500 bg-rose-500/20 text-rose-100',
    open: 'border-emerald-500 bg-emerald-500/15 text-emerald-100',
    closed: 'border-slate-600 bg-slate-800 text-slate-300',
  }
  const cls = map[s] || 'border-slate-600 bg-slate-800 text-slate-300'
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {statusPlain(status)}
    </span>
  )
}

// 24h window pill: shows the remaining time when the customer's last
// inbound was within 24h, or "24h passed" when it isn't. Contrast is
// dialed for readability on the slate page (emerald-100 on emerald-500/15
// = ~5.4:1; slate-300 on slate-800 = ~7.1:1).
function WindowPill({ lastInboundAt, now }) {
  const open = windowMsLeft(lastInboundAt, now) > 0
  const remaining = fmtRemaining(windowMsLeft(lastInboundAt, now))
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        open
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100'
          : 'border-slate-600 bg-slate-800 text-slate-300'
      }`}
      title={open ? 'You can send a free-form reply until then.' : "You can't message this customer right now — 24h since their last message."}
    >
      {open ? `${remaining} to reply` : '24h passed — call instead'}
    </span>
  )
}

function windowMsLeft(lastInboundAt, now) {
  if (!lastInboundAt) return 0
  const t = new Date(lastInboundAt).getTime()
  if (Number.isNaN(t)) return 0
  return t + WINDOW_MS - now
}

function fmtRemaining(ms) {
  if (ms <= 0) return '0m'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
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

// Plain-language reason for why the bot escalated a conversation. Raw
// values come from whatsapp_conversations.handoff_reason.
function labelReason(reason) {
  const map = {
    handoff: 'Bot passed this to you',
    fallback: "Bot couldn't answer this",
    send_failed: "Bot's reply didn't go through",
    rate_limited: 'Customer was messaging too fast',
  }
  return map[reason] || 'Waiting for you'
}

function truncate(s, n = 90) {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// Strip everything except digits so we can build tel: and MSG91-shaped
// numbers from whatever we got.
function digitsOnly(phone) {
  return (phone || '').replace(/\D+/g, '')
}
function telHref(phone) {
  const d = digitsOnly(phone)
  if (!d) return null
  return `tel:+${d}`
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

  // Tick a `now` state so the 24h countdown updates once a minute without
  // hitting the DB.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const rows = await listConversations(statusFilter)
      setConversations(rows)
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
      setThreadError(err?.message || 'Failed to mark done')
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
      setThreadError(err?.message || 'Failed to archive')
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

  // Optimistic append after a successful send so the human's message
  // appears immediately without a thread reload. The message object comes
  // back from the /send endpoint already shaped like a normal thread row.
  const handleSent = useCallback(
    (message) => {
      if (message) {
        setThread((t) =>
          t ? { ...t, messages: [...(t.messages || []), message] } : t,
        )
      }
      // Refresh the list so the last-message preview + timestamp update.
      loadList()
    },
    [loadList],
  )

  const needsReplyCount = useMemo(
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
          <p className="mt-1 text-sm text-slate-300">
            Read and reply to customers here. Conversations waiting for you appear first.
          </p>
        </div>
        <RefreshButton onRefresh={refreshList} loading={refreshing} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.key
          const showBadge = tab.key === 'needs_human' && needsReplyCount > 0
          // "Needs reply" is my to-do — highlight it more strongly than
          // the other tabs so it draws the eye.
          const emphasise = tab.key === 'needs_human'
          const activeCls = emphasise
            ? 'border-rose-400 bg-rose-500/25 text-rose-50 shadow-sm shadow-rose-500/30'
            : 'border-emerald-500 bg-emerald-500/20 text-emerald-50'
          const idleCls = emphasise
            ? 'border-rose-500/60 bg-rose-500/10 text-rose-100 hover:border-rose-400'
            : 'border-slate-600 bg-slate-800/60 text-slate-200 hover:border-slate-400'
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? activeCls : idleCls
              }`}
            >
              {tab.label}
              {showBadge && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {needsReplyCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {listError && (
        <AlertBanner type="error" title="Couldn't load conversations" message={listError} />
      )}

      {/* Two-pane on lg+, split-view on mobile. Mobile shows either the
          list OR the thread, controlled by whether a conversation is
          selected. Height is capped so both the list AND the reply box
          are reachable without scrolling the whole page. */}
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* List */}
        <div
          className={`rounded-xl border border-slate-700 bg-slate-900/70 lg:block ${
            selectedId ? 'hidden' : 'block'
          }`}
        >
          <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            {loadingList ? 'Loading…' : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
          </div>
          <ul className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto">
            {conversations.length === 0 && !loadingList && (
              <li className="px-4 py-6 text-sm text-slate-300">No conversations.</li>
            )}
            {conversations.map((c) => {
              const active = c.id === selectedId
              const needsReply = c.status === 'needs_human'
              const name = c.customer?.full_name || c.phone
              const base = 'w-full border-l-4 px-3 py-3 text-left transition-colors'
              const accent = needsReply ? 'border-l-rose-500' : 'border-l-transparent'
              const bg = active
                ? 'bg-emerald-500/20'
                : needsReply
                ? 'bg-rose-950/40 hover:bg-rose-950/60'
                : 'hover:bg-slate-800/60'
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
                          <span className="truncate text-sm font-semibold text-slate-50">{name}</span>
                          <StatusPill status={c.status} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {c.phone}
                          {c.customer?.full_name ? ` · ${c.customer.full_name}` : ''}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-200">
                          {c.last_message
                            ? `${c.last_message.direction === 'in' ? '↙' : '↗'} ${truncate(c.last_message.body, 60)}`
                            : 'No messages yet'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-[10px] text-slate-400">
                        <span>{formatWhen(c.last_message_at)}</span>
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
          className={`rounded-xl border border-slate-700 bg-slate-900/70 lg:block ${
            selectedId ? 'block' : 'hidden'
          }`}
        >
          {!selectedId && (
            <div className="p-10 text-center text-sm text-slate-300">
              Select a conversation to view messages.
            </div>
          )}
          {selectedId && (
            <ThreadView
              thread={thread}
              loading={loadingThread}
              error={threadError}
              actionBusy={actionBusy}
              now={now}
              onResolve={handleResolve}
              onClose={handleClose}
              onReopen={handleReopen}
              onRefresh={() => loadThread(selectedId)}
              onBack={() => setSelectedId(null)}
              onSent={handleSent}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadView({ thread, loading, error, actionBusy, now, onResolve, onClose, onReopen, onRefresh, onBack, onSent }) {
  const conv = thread?.conversation
  const messages = thread?.messages || []
  const tel = telHref(conv?.phone)

  const msLeft = windowMsLeft(conv?.last_inbound_at, now)
  const canReply = msLeft > 0

  // Auto-scroll to the newest message whenever the thread updates. Live
  // element so the scroll happens after paint, not before.
  const scrollRef = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, thread?.conversation?.id])

  return (
    <div className="flex h-full flex-col">
      {/* Header — customer identity + status + primary actions */}
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-start gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-800 p-1.5 text-slate-100 hover:border-slate-400 lg:hidden"
              aria-label="Back to conversation list"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <User size={16} className="shrink-0 text-slate-300" />
              <span className="truncate text-base font-bold text-slate-50">
                {conv?.customer?.full_name || conv?.phone || 'Conversation'}
              </span>
            </div>
            {conv?.phone && (
              <div className="mt-1 text-xs text-slate-300">{conv.phone}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {conv && <StatusPill status={conv.status} />}
              {conv && <WindowPill lastInboundAt={conv.last_inbound_at} now={now} />}
            </div>
            {conv?.last_handoff_at && (
              <div className="mt-2 text-xs text-slate-300">
                <span className="font-semibold text-slate-100">{labelReason(conv.handoff_reason)}</span>{' '}
                <span className="text-slate-400">· {formatWhen(conv.last_handoff_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions — Call, Mark done, Archive / Reopen, Refresh.
            "Reply on WhatsApp" (wa.me) is intentionally REMOVED — it
            can't work with our Business API number. Call replaces it. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tel && (
            <a
              href={tel}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500"
            >
              <Phone size={13} />
              Call
            </a>
          )}
          {conv?.status === 'needs_human' && (
            <button
              type="button"
              onClick={onResolve}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-400 bg-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-50 hover:bg-emerald-500/40 disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              Mark done
            </button>
          )}
          {conv?.status === 'open' && (
            <button
              type="button"
              onClick={onClose}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-100 hover:border-slate-400 disabled:opacity-50"
            >
              Archive
            </button>
          )}
          {conv?.status === 'closed' && (
            <button
              type="button"
              onClick={onReopen}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-100 hover:border-slate-400 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-100 hover:border-slate-400"
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

      {/* Messages — chat area. Fixed max height so the reply box stays
          in view. Auto-scrolls to newest on load / send. */}
      <div
        ref={scrollRef}
        className="max-h-[55vh] flex-1 overflow-y-auto bg-slate-950/40 px-4 py-4 lg:max-h-[60vh]"
      >
        {loading && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-300">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="py-10 text-center text-sm text-slate-300">No messages in this conversation.</div>
        )}
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      </div>

      {/* Reply box */}
      <ReplyBox
        conversationId={conv?.id}
        canReply={canReply}
        msLeft={msLeft}
        tel={tel}
        onSent={onSent}
      />
    </div>
  )
}

function MessageBubble({ msg }) {
  const inbound = msg.direction === 'in' || msg.direction === 'inbound'
  const isBot = !inbound && msg.ai_generated === true
  const isHuman = !inbound && !msg.ai_generated
  // Distinct colours for the three speakers, all high-contrast:
  //   Customer (light)   : white / #1A2B1F        ~15:1
  //   Team human (mid)   : emerald-600 / white    ~4.9:1
  //   Bot (dark)         : emerald-800 / emerald-50 ~8.5:1  + "Bot" pill
  //
  // WHY THE INLINE STYLE ON THE CUSTOMER BUBBLE: index.css @theme block
  // INVERTS Tailwind's slate scale so `text-slate-900` actually resolves
  // to `#FFFFFF` (see --color-slate-900). Using the class produced white
  // text on the white bubble — customer messages rendered invisible while
  // the meta line (text-slate-500 → #8A9890) stayed readable. Explicit
  // hex bypasses the remap entirely so this can never regress via a
  // future token edit.
  const bubbleCls = inbound
    ? 'rounded-bl-sm bg-white'
    : isBot
    ? 'rounded-br-sm bg-emerald-800 text-emerald-50 ring-1 ring-emerald-900'
    : 'rounded-br-sm bg-emerald-600 text-white'
  const bubbleStyle = inbound ? { color: '#1A2B1F' } : undefined
  const metaCls = inbound
    ? 'text-slate-500'
    : 'text-emerald-50/95'
  const senderLabel = inbound ? 'Customer' : isBot ? 'Bot' : 'You'
  const senderLabelCls = inbound
    ? 'text-slate-400'
    : isBot
    ? 'text-amber-300'
    : 'text-emerald-300'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[85%] flex-col ${inbound ? 'items-start' : 'items-end'}`}>
        <span className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${senderLabelCls}`}>
          {isBot && <Bot size={10} />}
          {senderLabel}
        </span>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${bubbleCls}`} style={bubbleStyle}>
          <div className="whitespace-pre-wrap break-words leading-snug">{msg.body}</div>
          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] ${metaCls}`}>
            <span>{formatWhen(msg.sent_at || msg.created_at)}</span>
            {msg.status && !inbound && <span>· {msg.status}</span>}
          </div>
        </div>
      </div>
    </div>
  )
  // eslint-disable-next-line no-unused-vars
  const _ = isHuman
}

// Reply box — the whole point of this page. Enter = send, Shift+Enter =
// newline. Blocked entirely when the 24h WhatsApp window is closed; in
// that case we show a plain-language explanation + Call button instead
// of ever letting a send silently fail.
function ReplyBox({ conversationId, canReply, msLeft, tel, onSent }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | failed
  const [error, setError] = useState(null)
  const textRef = useRef(null)

  // Reset state when the selected conversation changes so a failure on
  // one thread doesn't ghost into the next.
  useEffect(() => {
    setText('')
    setStatus('idle')
    setError(null)
  }, [conversationId])

  const doSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || !conversationId) return
    setStatus('sending')
    setError(null)
    try {
      const { message } = await sendMessage(conversationId, trimmed)
      setText('')
      setStatus('sent')
      onSent?.(message)
      // Reset the "sent" hint after a short beat so it doesn't linger.
      setTimeout(() => setStatus((s) => (s === 'sent' ? 'idle' : s)), 1800)
    } catch (err) {
      setStatus('failed')
      if (err?.windowClosed) {
        setError(
          "You can't message this customer right now — WhatsApp only allows replies within 24 hours of their last message. Call them instead.",
        )
      } else if (err?.rateLimited) {
        setError('Too many replies — wait a moment and try again.')
      } else {
        setError(err?.message || 'Failed to send')
      }
    }
  }, [text, conversationId, onSent])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  if (!canReply) {
    // 24h passed since customer's last message. Meta forbids free-form
    // sends here — we DISABLE the input entirely and point them to Call.
    return (
      <div className="border-t border-slate-800 bg-slate-900 px-4 py-3">
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
          <p className="font-semibold text-amber-50">
            You can't message this customer right now.
          </p>
          <p className="mt-1 text-amber-100/90">
            WhatsApp only allows replies within 24 hours of their last message. That window has passed.
            Call them instead — they'll usually reply on WhatsApp after that, and the window will re-open.
          </p>
          {tel && (
            <a
              href={tel}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-400 bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
            >
              <Phone size={13} />
              Call now
            </a>
          )}
        </div>
      </div>
    )
  }

  const sending = status === 'sending'
  const remaining = fmtRemaining(msLeft)

  return (
    <div className="border-t border-slate-800 bg-slate-900 px-3 py-3">
      {error && (
        <div className="mb-2 rounded-lg border border-rose-500/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
          <span className="font-semibold text-rose-50">Couldn't send: </span>
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textRef}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          placeholder="Type a message"
          className="flex-1 resize-none rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={doSend}
          disabled={sending || !text.trim()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          aria-label="Send message"
        >
          <Send size={14} />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>Enter to send · Shift+Enter for a new line</span>
        <span>
          {status === 'sent' ? (
            <span className="font-semibold text-emerald-300">Sent</span>
          ) : (
            <>Window: <span className="text-slate-200">{remaining} left</span></>
          )}
        </span>
      </div>
    </div>
  )
}

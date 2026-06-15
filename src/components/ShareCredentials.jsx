import { useState } from 'react'

const LOGIN_URL = 'cadieux.in/dashboard'

function roleLabel(role) {
  if (role === 'sales') return 'Sales'
  if (role === 'partner') return 'Partner'
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'User'
}

/**
 * Build the shareable login message.
 *
 * When `password` is present (right after creation) the message includes it.
 * Otherwise (reshare from a list, where the password is gone forever) the
 * password line is omitted — we can only reshare the phone + login URL.
 */
function buildMessage({ name, phone, password, role }) {
  const lines = ['Your Cadieux Dashboard Login 🍞', '']
  if (name) lines.push(`Name: ${name}`)
  if (phone) lines.push(`Phone: ${phone}`)
  if (password) lines.push(`Password: ${password}`)
  lines.push(`Role: ${roleLabel(role)}`)
  lines.push('')
  lines.push(`Login at: ${LOGIN_URL}`)
  return lines.join('\n')
}

/**
 * Share-credentials modal.
 *
 * Props: { name, phone, password, role, onClose }
 *  - password === null/undefined → "reshare" mode: the password is no longer
 *    available, the card shows a notice and the shared message omits it.
 */
export default function ShareCredentials({ name, phone, password, role, onClose }) {
  const [copied, setCopied] = useState(false)

  const message = buildMessage({ name, phone, password, role })
  const encoded = encodeURIComponent(message)
  const hasPassword = Boolean(password)

  const whatsappHref = `https://wa.me/?text=${encoded}`
  const smsHref = `sms:?body=${encoded}`

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const handleNativeShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({ title: 'Cadieux Dashboard Login', text: message })
        return
      } catch (err) {
        // User cancelled the share sheet — do nothing.
        if (err && err.name === 'AbortError') return
        // Any other failure → fall back to copying.
      }
    }
    handleCopy()
  }

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message)
      } else {
        const ta = document.createElement('textarea')
        ta.value = message
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,70,40,0.4)] p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Credential card */}
        <div className="bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 p-6">
          <div className="mb-5 flex items-center gap-2">
            <span className="text-xl">🔐</span>
            <h3 className="text-lg font-semibold text-slate-100">Cadieux Dashboard Login</h3>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            {name && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-wider text-slate-500">Name</span>
                <span className="text-sm font-medium text-slate-100">{name}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-slate-500">Phone</span>
              <span className="text-sm font-medium text-slate-100">{phone || 'N/A'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-slate-500">Password</span>
              {hasPassword ? (
                <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm font-medium text-amber-300">
                  {password}
                </span>
              ) : (
                <span className="text-right text-xs text-slate-400">
                  Set at creation — contact admin to reset
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-slate-500">Role</span>
              <span className="text-sm font-medium text-slate-100">{roleLabel(role)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-800/40 px-4 py-2">
            <span className="text-xs uppercase tracking-wider text-slate-500">Login at</span>
            <span className="text-sm font-medium text-indigo-300">{LOGIN_URL}</span>
          </div>

          {hasPassword && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-amber-300">
                Save or share now — the password cannot be retrieved later.
              </p>
            </div>
          )}
        </div>

        {/* Native share (mobile share sheet; falls back to copy where unsupported) */}
        <div className="border-t border-slate-800 px-4 pt-4">
          <button
            type="button"
            onClick={handleNativeShare}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#024628] px-3 py-3 text-sm font-semibold text-[#fbf3d4] transition-opacity hover:opacity-90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share login details
          </button>
        </div>

        {/* Share buttons */}
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-[#fbf3d4] transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#25D366' }}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.115zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
            </svg>
            WhatsApp
          </a>
          <a
            href={smsHref}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-[#fbf3d4] transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#007AFF' }}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Messages
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-600"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
          >
            Close
          </button>
        </div>

        {copied && (
          <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-[#fbf3d4] shadow-lg">
            Copied!
          </div>
        )}
      </div>
    </div>
  )
}

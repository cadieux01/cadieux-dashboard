/**
 * Admin API utilities for managing dashboard login accounts (sales + partners).
 *
 * LOGIN MODEL — phone + password for both roles.
 *   Users are created with a 10-digit phone; the auth row gets a synthetic
 *   email `<phone>@cadieux.<role>` (role ∈ {sales, partner}). All mutate ops
 *   below address users by phone. Real-email accounts (sunny@gmail.com) are
 *   managed outside this module.
 *
 * SECURITY MODEL
 *   User management needs the Supabase **service-role** key, which MUST NOT
 *   ship in any client bundle. So this module POSTs to a Supabase Edge
 *   Function (`manage-partner`) instead of calling `supabase.auth.admin.*`
 *   from the browser. The function:
 *     1. Verifies the caller's JWT (we forward `session.access_token`).
 *     2. Checks `logistics.profiles` for `admin` or `sales` role.
 *     3. Performs the op with the service-role key on the server and writes
 *        an entry to `logistics.audit_logs`.
 *
 * See: /Users/sunnyraj/Cadieux/supabase/functions/manage-partner/index.ts
 */

import { supabase } from './supabase'
import { isValidPhone, normalizePhone } from './phone'

// Cadieux-Website Supabase project (where the logistics schema lives).
// Override via Vite env (`VITE_MANAGE_PARTNER_URL`) for staging / preview.
const MANAGE_PARTNER_URL =
  import.meta.env?.VITE_MANAGE_PARTNER_URL ||
  'https://uejagupcwevadfhfuadv.supabase.co/functions/v1/manage-partner'

async function callManagePartner(payload) {
  const { data: sessionWrap } = await supabase.auth.getSession()
  const token = sessionWrap?.session?.access_token
  if (!token) {
    throw new Error('Not authenticated')
  }

  // Surface exactly where we're calling and with what so a failed request
  // can be diagnosed from the browser console (URL, action, token presence).
  console.log('[manage-partner] POST', MANAGE_PARTNER_URL, {
    action: payload?.action,
    hasToken: !!token,
    tokenPreview: token ? `${token.slice(0, 8)}…` : null,
    origin: window.location.origin,
  })

  let res
  try {
    res = await fetch(MANAGE_PARTNER_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    // A thrown fetch (TypeError "Load failed" / "Failed to fetch") almost
    // always means the request never got a response: CORS rejection, a
    // blocked preflight, or the function being offline. Surface the URL and
    // the most likely cause so it isn't a dead-end "Network error".
    console.error('[manage-partner] fetch threw:', networkErr)
    throw new Error(
      `Could not reach the user service at ${MANAGE_PARTNER_URL} ` +
        `(${networkErr?.message || 'fetch failed'}). This is usually a CORS block — ` +
        `the Edge Function's ALLOWED_ORIGIN must include "${window.location.origin}" — ` +
        `or the manage-partner function is not deployed.`,
    )
  }

  // The Edge Function always returns JSON, but be defensive in case a
  // gateway error slips through as HTML. Keep the raw text so we can show
  // the EXACT response body when it isn't valid JSON.
  let body = null
  let rawText = null
  try {
    rawText = await res.text()
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    console.error('[manage-partner] HTTP', res.status, rawText)
    // Prefer the function's own error text. Fall back to the raw response
    // body, then status-specific hints, so a misconfigured deployment
    // produces an actionable message instead of a silent failure.
    let msg = (body && (body.error || body.message)) || (rawText && rawText.trim())
    if (!msg) {
      if (res.status === 404) {
        msg =
          'User service not found (HTTP 404). The manage-partner Edge Function may not be deployed.'
      } else if (res.status === 401 || res.status === 403) {
        msg =
          'Not authorised to manage users (HTTP ' +
          res.status +
          '). Your session may have expired — sign out and back in.'
      } else if (res.status >= 500) {
        msg = `User service error (HTTP ${res.status}). Please try again.`
      } else {
        msg = `User service returned HTTP ${res.status}`
      }
    }
    throw new Error(msg)
  }
  return body
}

/**
 * Create a sales exec or partner login.
 *
 * @param {Object} params
 * @param {string} params.phone      10-digit mobile (leading 6-9)
 * @param {string} params.password   >= 6 chars
 * @param {string} params.full_name
 * @param {'sales'|'partner'} params.role
 * @param {string} [params.notes]
 * Returns: { success, userId, email, phone, role }
 */
export async function createUser({ phone, password, full_name, role, notes }) {
  if (!isValidPhone(phone)) {
    throw new Error('Please enter a valid 10-digit Indian mobile number')
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters')
  }
  if (!full_name || !full_name.trim()) {
    throw new Error('Full name is required')
  }
  if (role !== 'sales' && role !== 'partner') {
    throw new Error('role must be "sales" or "partner"')
  }

  const body = await callManagePartner({
    action: 'create',
    phone: normalizePhone(phone),
    password,
    full_name: full_name.trim(),
    role,
    notes: notes || null,
  })
  return {
    success: true,
    userId: body.user_id,
    email: body.email,
    phone: body.phone,
    role: body.role,
  }
}

/** Soft delete: ban the login but keep all data. Profile status -> inactive. */
export async function deactivateUser(phone) {
  if (!isValidPhone(phone)) throw new Error('Valid phone is required')
  return await callManagePartner({ action: 'deactivate', phone: normalizePhone(phone) })
}

/** Hard delete the login (removes auth user) but KEEP the profile + all data. */
export async function deleteUser(phone) {
  if (!isValidPhone(phone)) throw new Error('Valid phone is required')
  return await callManagePartner({ action: 'delete', phone: normalizePhone(phone) })
}

/** Un-ban a previously deactivated login. Profile status -> active. */
export async function reactivateUser(phone) {
  if (!isValidPhone(phone)) throw new Error('Valid phone is required')
  return await callManagePartner({ action: 'reactivate', phone: normalizePhone(phone) })
}

/**
 * Reset a user's password (approving a 'password' change request).
 * The new password is supplied by the approver — it is never stored in
 * the request row. Service-role op, so it goes through the Edge Function.
 *
 * @param {string} userId        target profiles.id / auth user id
 * @param {string} newPassword   >= 6 chars
 */
export async function changePassword(userId, newPassword) {
  if (!userId) throw new Error('User id is required')
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters')
  }
  return await callManagePartner({
    action: 'change-password',
    user_id: userId,
    new_password: newPassword,
  })
}

/**
 * Change a user's phone (approving a 'phone' change request). Rewrites the
 * synthetic auth email `<phone>@cadieux.<role>` and the profile phone, so
 * it must run server-side with the service-role key.
 *
 * @param {Object} params
 * @param {string} params.userId    target profiles.id / auth user id
 * @param {string} params.oldPhone  current 10-digit phone
 * @param {string} params.newPhone  new 10-digit phone
 */
export async function changePhone({ userId, oldPhone, newPhone }) {
  if (!userId) throw new Error('User id is required')
  if (!isValidPhone(newPhone)) {
    throw new Error('Please enter a valid 10-digit Indian mobile number')
  }
  return await callManagePartner({
    action: 'change-phone',
    user_id: userId,
    old_phone: normalizePhone(oldPhone),
    new_phone: normalizePhone(newPhone),
  })
}

/**
 * Admin API utilities for creating / deleting partner users.
 *
 * SECURITY MODEL — January 2026 rewrite
 *
 * The previous version of this file called `supabase.auth.admin.createUser`
 * and `supabase.auth.admin.deleteUser` directly from the browser. Those
 * methods require the Supabase **service-role** key, which MUST NOT ship
 * in any client bundle — anyone with the key can take over every account
 * in the project.
 *
 * This module now POSTs to a Supabase **Edge Function** (`manage-partner`)
 * hosted on the Cadieux-Website project. The Edge Function:
 *   1. Verifies the caller's JWT (we forward `session.access_token` as
 *      `Authorization: Bearer …`).
 *   2. Looks up the caller's role in `logistics.profiles` and rejects
 *      anyone who isn't `admin` or `sales`.
 *   3. Performs the admin operation with the service-role key on the
 *      server, and writes an entry to `logistics.audit_logs`.
 *
 * See `sunny-to-cadieux-migration/edge-functions/manage-partner/index.ts`
 * for the function source and `…/DEPLOY.md` for deploy instructions.
 */

import { supabase } from './supabase'

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

  let res
  try {
    res = await fetch(MANAGE_PARTNER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    throw new Error(`Network error contacting partner service: ${networkErr.message}`)
  }

  // The Edge Function always returns JSON, but be defensive in case a
  // gateway error slips through as HTML.
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const msg =
      (body && (body.error || body.message)) ||
      `Partner service returned HTTP ${res.status}`
    throw new Error(msg)
  }
  return body
}

/**
 * Create a partner user.
 *
 * Required: email, password (>= 8 chars).
 * Optional: full_name, date_of_birth (ISO date), phone_number, notes.
 *
 * Returns: { success: true, userId, email }
 */
export async function createPartnerUser({
  email,
  password,
  full_name,
  date_of_birth,
  phone_number,
  notes,
}) {
  try {
    const body = await callManagePartner({
      action: 'create',
      email,
      password,
      full_name: full_name || '',
      date_of_birth: date_of_birth || null,
      phone: phone_number || null,
      notes: notes || null,
    })
    return {
      success: true,
      userId: body.user_id,
      email: body.email,
    }
  } catch (error) {
    console.error('Error creating partner user:', error)
    throw error
  }
}

/**
 * Delete a partner user (auth + profile + audit log) in one server-side
 * transaction. The Edge Function refuses to delete non-partner accounts
 * and refuses to let the caller delete themselves.
 */
export async function deletePartnerUser(userId) {
  if (!userId) {
    throw new Error('userId is required')
  }
  try {
    await callManagePartner({ action: 'delete', user_id: userId })
    return { success: true }
  } catch (error) {
    console.error('Error deleting partner user:', error)
    throw error
  }
}

/**
 * Profile change-request workflow helpers.
 *
 * Partners and sales execs cannot edit their own name / phone / password
 * directly. They file a row in `logistics.profile_change_requests` with
 * status='pending'; an admin (any request) or a sales exec (partner
 * requests only) later approves or rejects it. RLS on the table enforces
 * who can read/update which rows — these helpers just shape the queries.
 *
 * SECURITY: password requests never store the plaintext the user typed.
 * `requested_value` for a password request is the literal placeholder
 * PASSWORD_PLACEHOLDER; the real new password is supplied by the approver
 * at approval time and applied via the manage-partner Edge Function.
 */

import { supabase } from './supabase'

export const PASSWORD_PLACEHOLDER = 'Password change requested'

export const REQUEST_TYPE_LABELS = {
  name: 'Name',
  phone: 'Phone Number',
  password: 'Password',
  email: 'Login Email',
}

/**
 * File a new change request (status defaults to 'pending' in the DB).
 *
 * @param {Object} params
 * @param {Object} params.profile          the requester's profile row
 * @param {'name'|'phone'|'password'} params.requestType
 * @param {string|null} params.currentValue
 * @param {string|null} params.requestedValue
 */
export async function submitChangeRequest({ profile, requestType, currentValue, requestedValue }) {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .insert({
      requester_id: profile.id,
      requester_name: profile.full_name || '',
      requester_role: profile.role,
      request_type: requestType,
      current_value: currentValue ?? null,
      requested_value: requestedValue ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** The requester's own history, newest first. */
export async function fetchMyRequests(userId) {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .select('*')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Every request the caller is allowed to see, newest first. RLS scopes
 * the result automatically: admins see all rows; sales execs see only
 * rows where requester_role = 'partner'.
 */
export async function fetchManagedRequests() {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Count of pending requests the caller can act on. RLS scopes it: admin
 * gets the global pending count; sales gets only pending partner requests.
 */
export async function fetchPendingCount() {
  const { count, error } = await supabase
    .from('profile_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count || 0
}

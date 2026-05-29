/**
 * Admin API utilities for creating partner users
 * 
 * NOTE: In production, these operations should be performed via a backend API
 * that uses the Supabase service role key. For now, this uses the admin API
 * which requires proper setup.
 * 
 * To use this in production:
 * 1. Create a Supabase Edge Function or backend API endpoint
 * 2. Use service role key on the backend
 * 3. Call that endpoint from the frontend
 */

import { supabase } from './supabase'

/**
 * Create a partner user via Supabase Admin API
 * This requires service role key - should be done via backend in production
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
    // Check if user has admin or sales role
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Not authenticated')
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'sales'].includes(profile.role)) {
      throw new Error('Only admin or sales can create partner users')
    }

    // Create auth user using Supabase Admin API
    // NOTE: This requires service role key. In production, call a backend endpoint instead.
    // For now, we'll use the regular signUp and then update the profile
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: full_name || '',
        role: 'partner',
      },
    })

    if (authError) {
      // If admin API not available, try alternative approach
      // This is a fallback - in production use backend endpoint
      throw new Error(`Failed to create user: ${authError.message}`)
    }

    // Create profile with partner metadata
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: authData.user.email,
        full_name: full_name || '',
        role: 'partner',
        date_of_birth: date_of_birth || null,
        phone_number: phone_number || null,
        notes: notes || null,
      })

    if (profileError) {
      // If profile creation fails, try to delete the auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw new Error(`Failed to create profile: ${profileError.message}`)
    }

    return {
      success: true,
      userId: authData.user.id,
      email: authData.user.email,
    }
  } catch (error) {
    console.error('Error creating partner user:', error)
    throw error
  }
}


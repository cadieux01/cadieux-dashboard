import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  // ============================================
  // 🚨 BYPASS MODE - Change email below to test different users
  // Set BYPASS_MODE to false to use real authentication
  // ============================================
  const BYPASS_MODE = false; // Set to true to enable bypass
  const MOCK_USER_EMAIL = 'sales@gmail.com'; // Change to 'sunny@gmail.com' or 'sales@gmail.com'
  
  if (BYPASS_MODE) {
    const mockRole = MOCK_USER_EMAIL === 'sales@gmail.com' ? 'sales' : 'admin';
    return (
      <AuthContext.Provider value={{
        user: { id: `mock-${mockRole}-id`, email: MOCK_USER_EMAIL },
        profile: { 
          id: `mock-${mockRole}-id`, 
          email: MOCK_USER_EMAIL, 
          full_name: mockRole === 'sales' ? 'Sales Executive' : 'Admin User', 
          role: mockRole 
        },
        role: mockRole,
        loading: false,
        signIn: async () => ({ data: { user: {} }, error: null }),
        signOut: async () => ({ error: null }),
      }}>
        {children}
      </AuthContext.Provider>
    )
  }
  // ============================================
  // END BYPASS MODE - Real authentication below
  // ============================================

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const currentUserIdRef = useRef(null)
  const profileRef = useRef(null)
  const profileFetchInFlightRef = useRef(false)
  const getSessionInFlightRef = useRef(null)
  const fetchProfileInFlightRef = useRef(null)
  const isRestoringSessionRef = useRef(false)

  useEffect(() => {
    let isMounted = true
    
    const initAuth = async () => {
      // Check if Supabase is configured
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

      if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
        console.warn('⚠️ Supabase not configured')
        if (isMounted) {
          setLoading(false)
        }
        return
      }

      try {
        // Single-flight getSession to avoid concurrent calls (StrictMode / refresh races)
        if (!getSessionInFlightRef.current) {
          const p = supabase.auth.getSession()
          getSessionInFlightRef.current = p
          p.finally(() => {
            if (getSessionInFlightRef.current === p) getSessionInFlightRef.current = null
          }).catch(() => {})
        }
        const getSessionPromise = getSessionInFlightRef.current
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout after 8000ms')), 8000))
        const { data, error } = await Promise.race([getSessionPromise, timeoutPromise])

        if (error) {
          console.error('getSession error:', error)
          if (isMounted) {
            setLoading(false)
          }
          return
        }

        if (isMounted) {
          const sessionUser = data?.session?.user ?? null
          setUser(sessionUser)
          
          if (sessionUser) {
            currentUserIdRef.current = sessionUser.id
            await fetchProfile(sessionUser.id)
          } else {
            setLoading(false)
          }
        }
      } catch (error) {
        console.error('Exception in initAuth:', error)
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return
        
        const newUserId = session?.user?.id ?? null
        const previousUserId = currentUserIdRef.current

        // Skip profile fetches during session restoration to avoid race conditions
        // Check both ref and window flag (window flag is set from Onboarding component)
        const isRestoring = isRestoringSessionRef.current || (typeof window !== 'undefined' && window.__isRestoringSession)
        if (isRestoring) {
          // Still update user object but don't fetch profile
          setUser(session?.user ?? null)
          return
        }

        // If tab is hidden, don't kick the UI back into loading or start network calls.
        if (typeof document !== 'undefined' && document.hidden) {
          setUser(session?.user ?? null)
          return
        }

        // Only handle actual user changes, not token refreshes or tab focus events
        // Skip if: same user AND we already have profile loaded AND not a sign-out
        if (event === 'TOKEN_REFRESHED') {
          // Token refresh - don't reload anything, just update user object
          setUser(session?.user ?? null)
          return
        }

        if (event === 'SIGNED_IN' && newUserId === previousUserId && profileRef.current !== null) {
          // Same user re-authenticated (tab focus, etc.) - skip reload
          setUser(session?.user ?? null)
          return
        }

        // Actual auth change - handle it
        setUser(session?.user ?? null)
        
        if (session?.user) {
          // Only show loading and fetch profile if user changed or we don't have profile
          // Also skip if we're already fetching for this user
          const isDifferentUser = newUserId !== previousUserId
          const needsProfile = profileRef.current === null || profileRef.current.id !== newUserId
          const notAlreadyFetching = !profileFetchInFlightRef.current || currentUserIdRef.current !== newUserId
          
          if ((isDifferentUser || needsProfile) && notAlreadyFetching) {
            currentUserIdRef.current = newUserId
            setLoading(true)
            await fetchProfile(session.user.id)
          }
        } else {
          // User signed out
          currentUserIdRef.current = null
          profileRef.current = null
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => {
      isMounted = false
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  const fetchProfile = async (userId) => {
    if (profileFetchInFlightRef.current) {
      return
    }

    try {
      profileFetchInFlightRef.current = true
      
      // Create a fresh query (don't reuse promises - they might be stuck)
      const profileQuery = supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()
      
      // Use a shorter timeout and retry logic
      const timeoutMs = 5000
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`fetchProfile timeout after ${timeoutMs}ms`)), timeoutMs)
      )
      
      const { data, error } = await Promise.race([profileQuery, timeoutPromise])

      if (error) {
        // If profile doesn't exist (PGRST116), that's okay - it might be created by trigger
        if (error.code === 'PGRST116') {
          console.warn('Profile not found, may be created by trigger:', error.message)
          profileRef.current = null
          setProfile(null)
        } else {
        console.warn('Profile query error:', error.message)
        profileRef.current = null
        setProfile(null)
        }
      } else {
        profileRef.current = data
        setProfile(data)
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
      // Don't set profile to null on timeout - might be a temporary issue
      // Only clear if it's a real error (not timeout)
      if (!error.message.includes('timeout')) {
      fetchProfileInFlightRef.current = null
      profileRef.current = null
      setProfile(null)
      }
    } finally {
      profileFetchInFlightRef.current = false
      fetchProfileInFlightRef.current = null
      setLoading(false)
    }
  }

  const signIn = async (email, password) => {
    try {
      const signInPromise = supabase.auth.signInWithPassword({ email, password })
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('signIn timeout after 12000ms')), 12000))
      const { data, error } = await Promise.race([signInPromise, timeoutPromise])
      return { data, error }
    } catch (e) {
      return { data: null, error: { message: e?.message || 'Sign in failed' } }
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (!error) {
      setUser(null)
      setProfile(null)
    }
    return { error }
  }

  const role = profile?.role || null
  const isAdmin = role === 'admin'
  const isSales = role === 'sales'
  const isPartner = role === 'partner'
  const isAdminOrSales = isAdmin || isSales

  const value = {
    user,
    profile,
    role,
    loading,
    isAdmin,
    isSales,
    isPartner,
    isAdminOrSales,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}


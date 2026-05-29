import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, requiredRole = null, allowedRoles = null }) {
  const { user, profile, role, loading } = useAuth()
  const location = useLocation()

  // Check if Supabase is configured
  const supabaseConfigured = import.meta.env.VITE_SUPABASE_URL && 
    !import.meta.env.VITE_SUPABASE_URL.includes('placeholder')

  if (!supabaseConfigured) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Wait for auth to finish loading
  // Also wait a bit if we just finished restoring a session (to allow profile to load)
  const [isRestoringSession, setIsRestoringSession] = React.useState(
    typeof window !== 'undefined' && window.__isRestoringSession
  )
  
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    
    // Check periodically if restoration is in progress
    const interval = setInterval(() => {
      const currentlyRestoring = window.__isRestoringSession
      if (currentlyRestoring !== isRestoringSession) {
        setIsRestoringSession(currentlyRestoring)
      }
    }, 50)
    
    return () => clearInterval(interval)
  }, [isRestoringSession])
  
  // If loading or restoring session, show loading spinner
  // Also show loading if user exists but profile doesn't match (might be transitioning)
  const profileMismatch = user && profile && profile.id !== user.id
  if (loading || isRestoringSession || profileMismatch) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  // If no user, redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check admin status - profile should be loaded by now if loading is false
  // If profile is null after loading completes, it means RLS blocked it or profile doesn't exist
  if (!loading && profile === null) {
    // Profile fetch failed - likely RLS policy issue
    // Show helpful error message with step-by-step instructions
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-8 max-w-lg text-center">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Profile Access Error</h2>
          <p className="text-slate-400 mb-4">
            Unable to load your profile. This is caused by RLS (Row Level Security) policies blocking access.
          </p>
          <div className="text-left bg-slate-800/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-slate-300 font-medium mb-2">To fix this, run these SQL commands in Supabase:</p>
            <div className="text-xs text-slate-400 font-mono space-y-2">
              <p className="text-amber-400">Step 1: Run FIX_PROFILE_RLS.sql</p>
              <p className="text-amber-400">Step 2: Set yourself as admin:</p>
              <code className="block bg-slate-900 p-2 rounded text-emerald-400 overflow-x-auto">
                UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';
              </code>
            </div>
          </div>
          <button
            onClick={() => window.location.href = '/login'}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  // Check role-based access
  if (profile !== null) {
    let hasAccess = true

    if (requiredRole) {
      hasAccess = role === requiredRole
    } else if (allowedRoles && Array.isArray(allowedRoles)) {
      hasAccess = allowedRoles.includes(role)
    }

    if (!hasAccess) {
      const requiredText = allowedRoles 
        ? `Required roles: ${allowedRoles.join(' or ')}`
        : `Required role: ${requiredRole}`
      
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
            <p className="text-slate-400 mb-6">
              You don't have the required privileges to access this page. {requiredText}
            </p>
          <button
            onClick={() => window.location.href = '/login'}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }
  }

  // Allow access if user is authenticated and profile is loaded
  // RLS policies on the backend will enforce actual data access
  return children
}


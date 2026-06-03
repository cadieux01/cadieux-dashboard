import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { isValidPhone, normalizePhone, buildLoginEmail } from '../lib/phone'
import { matchDemoAccount, setDemoSession } from '../lib/demoData'

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = location.state?.from?.pathname || '/overview'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Demo accounts (demo-admin / demo-sales / demo-partner, password demo123)
    // never authenticate against Supabase. We set local demo flags and do a
    // full reload so AuthContext re-initialises from localStorage.
    const demoAccount = matchDemoAccount(identifier, password)
    if (demoAccount) {
      setDemoSession(demoAccount)
      const target =
        demoAccount.role === 'partner'
          ? '/dashboard/partner/dashboard'
          : '/dashboard/admin/overview'
      window.location.href = target
      return
    }

    try {
      // Sales execs and partners log in with a phone number; admin (and any
      // legacy email account) log in with an email. If the input contains an
      // "@" we treat it as an email. Otherwise, if it's a valid 10-digit
      // mobile, we synthesise the `<phone>@cadieux.<role>` email the Edge
      // Function uses at create time — trying sales first, then partner.
      const trimmed = identifier.trim()
      let candidateEmails = []

      if (trimmed.includes('@')) {
        candidateEmails = [trimmed.toLowerCase()]
      } else if (isValidPhone(trimmed)) {
        const phone = normalizePhone(trimmed)
        candidateEmails = [buildLoginEmail(phone, 'sales'), buildLoginEmail(phone, 'partner')]
      } else {
        setError('Enter a valid 10-digit phone number or an email address.')
        setLoading(false)
        return
      }

      // Try each candidate email until one authenticates.
      let data = null
      let error = null
      for (const email of candidateEmails) {
        const res = await signIn(email, password)
        if (!res.error && res.data?.user) {
          data = res.data
          error = null
          break
        }
        error = res.error
      }

      if (error || !data) {
        setError(error?.message || 'Invalid credentials')
        setLoading(false)
        return
      }

      // After successful login, check if profile exists
      const userId = data?.user?.id

      if (userId) {
        // Give it a moment for the auth state to update, then redirect based on role
        setTimeout(async () => {
          // Fetch profile to determine role
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .single()

          if (profileError) {
            console.error('Profile fetch error:', profileError)
            // If profile doesn't exist or RLS blocks access, show error
            if (profileError.code === 'PGRST116') {
              setError('Profile not found. Please contact administrator to create your profile.')
            } else if (profileError.message.includes('permission') || profileError.message.includes('policy')) {
              setError('Access denied. RLS policies may be blocking profile access.')
            } else {
              setError(`Failed to load profile: ${profileError.message}`)
            }
            setLoading(false)
            return
          }

          if (profileData?.role === 'admin') {
            navigate('/admin/overview', { replace: true })
          } else if (profileData?.role === 'sales') {
            navigate('/admin/sales', { replace: true })
          } else if (profileData?.role === 'partner') {
            navigate('/partner/dashboard', { replace: true })
          } else {
            setError('Invalid user role. Please contact administrator.')
            setLoading(false)
          }
        }, 500)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check if Supabase is configured
  const supabaseConfigured = import.meta.env.VITE_SUPABASE_URL &&
    !import.meta.env.VITE_SUPABASE_URL.includes('placeholder')

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-indigo-500/10 via-transparent to-transparent rounded-full blur-3xl"></div>
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-amber-500/10 via-transparent to-transparent rounded-full blur-3xl"></div>
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl shadow-lg shadow-amber-500/30 mb-4">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Sunny</h1>
          <p className="text-slate-400 mt-2">Dashboard</p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Sign in</h2>
          </div>

          {!supabaseConfigured && (
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-amber-400 text-sm font-medium">Supabase missing</p>
                  <p className="text-amber-300/80 text-xs mt-1">Add `.env` keys.</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-rose-400 text-sm">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-slate-300 mb-2">
                Phone Number or Email
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="9876543210 or admin@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 pr-12 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${
                    showPassword ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold rounded-lg shadow-lg shadow-indigo-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800">
            <p className="text-xs text-slate-500 text-center">
              Admin only.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-600 text-sm mt-8">
          © {new Date().getFullYear()} Sunny
        </p>
      </div>
    </div>
  )
}

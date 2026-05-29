// TEMPORARY MOCK - Replace AuthContext.jsx with this to bypass login
import { createContext, useContext } from 'react'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  // Mock sales executive user
  const mockUser = {
    id: 'mock-sales-user-id',
    email: 'sales@gmail.com',
    email_confirmed_at: new Date().toISOString(),
  }

  const mockProfile = {
    id: 'mock-sales-user-id',
    email: 'sales@gmail.com',
    full_name: 'Sales Executive',
    role: 'sales',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const value = {
    user: mockUser,
    profile: mockProfile,
    role: 'sales',
    loading: false,
    signIn: async () => ({ data: { user: mockUser }, error: null }),
    signOut: async () => ({ error: null }),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}




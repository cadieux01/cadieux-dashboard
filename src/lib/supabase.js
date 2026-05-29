import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Missing Supabase environment variables. Please create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

// Create client with fallback empty strings to prevent crashes
// db.schema routes all .from() calls to the logistics schema automatically
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-key', {
  db: { schema: 'logistics' },
})


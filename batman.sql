-- =====================================================
-- BATMAN.SQL - THE COMPLETE DATABASE SETUP
-- =====================================================
-- This is the SINGLE SOURCE OF TRUTH for all database setup.
-- Run this file in Supabase SQL Editor to set up everything.
-- 
-- What this script does:
-- 1. Creates user_role_enum type (admin, sales, partner)
-- 2. Drops ALL existing RLS policies (required for column changes)
-- 3. Sets up profiles table with proper role column
-- 4. Creates all helper functions
-- 5. Creates all triggers (handle_new_user, prevent_role_change)
-- 6. Creates all RLS policies for all tables
-- 7. Sets up the admin user
--
-- IMPORTANT: This script is idempotent - safe to run multiple times
-- =====================================================

-- =====================================================
-- STEP 1: CREATE ENUM TYPE FOR ROLES
-- =====================================================

DO $$
BEGIN
  -- Create enum if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
    CREATE TYPE user_role_enum AS ENUM ('admin', 'sales', 'partner');
    RAISE NOTICE '✓ Created user_role_enum type';
  ELSE
    RAISE NOTICE '✓ user_role_enum already exists';
  END IF;
END $$;

-- =====================================================
-- STEP 2: DROP ALL EXISTING RLS POLICIES
-- (Required before we can modify columns)
-- =====================================================

DO $$
DECLARE
  r RECORD;
  drop_count INTEGER := 0;
BEGIN
  -- Dynamically drop ALL policies on ALL tables in public schema
  FOR r IN (
    SELECT schemaname, tablename, policyname 
    FROM pg_policies 
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    drop_count := drop_count + 1;
  END LOOP;
  
  RAISE NOTICE '✓ Dropped % existing RLS policies', drop_count;
END $$;

-- =====================================================
-- STEP 3: ENSURE PROFILES TABLE EXISTS WITH CORRECT STRUCTURE
-- =====================================================

-- Create profiles table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role text DEFAULT 'partner',
  date_of_birth date,
  phone_number text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Convert role column to enum if it's still text
DO $$
DECLARE
  v_role_type text;
BEGIN
  SELECT data_type INTO v_role_type
  FROM information_schema.columns
  WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'role';
  
  IF v_role_type = 'text' OR v_role_type = 'character varying' THEN
    -- Convert text to enum
    ALTER TABLE public.profiles 
      ALTER COLUMN role TYPE user_role_enum 
      USING CASE 
        WHEN role = 'admin' THEN 'admin'::user_role_enum
        WHEN role = 'sales' THEN 'sales'::user_role_enum
        WHEN role = 'partner' THEN 'partner'::user_role_enum
        WHEN role = 'trainer' THEN 'partner'::user_role_enum
        ELSE 'partner'::user_role_enum
      END;
    RAISE NOTICE '✓ Converted role column to user_role_enum';
  ELSE
    RAISE NOTICE '✓ Role column already uses user_role_enum';
  END IF;
END $$;

-- Set default for role column
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'partner'::user_role_enum;

-- Drop old constraint if exists
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- =====================================================
-- STEP 4: ENSURE OTHER TABLES EXIST
-- =====================================================

-- Sales table
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  units_assigned int DEFAULT 0,
  units_sold int DEFAULT 0,
  retracted_units int DEFAULT 0,
  date_of_assignment date DEFAULT CURRENT_DATE,
  purchase_date date,
  picture_url text,
  qr_code_url text,
  customer_notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- Leads table
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  contact text,
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  action_type text CHECK (action_type IN ('CREATE', 'UPDATE', 'DELETE')),
  entity_type text,
  entity_id uuid,
  description text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Orders table
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  units_assigned int DEFAULT 0,
  units_sold int DEFAULT 0,
  units_retracted int DEFAULT 0,
  unit_price numeric DEFAULT 100,
  status text CHECK (status IN ('pending', 'active', 'completed', 'cancelled')) DEFAULT 'active',
  assigned_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Order invitations table
CREATE TABLE IF NOT EXISTS public.order_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  units_offered int NOT NULL,
  message text,
  status text CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz
);
ALTER TABLE public.order_invitations ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sales_trainer_id ON public.sales(trainer_id);
CREATE INDEX IF NOT EXISTS idx_leads_trainer_id ON public.leads(trainer_id);
CREATE INDEX IF NOT EXISTS idx_orders_partner_id ON public.orders(partner_id);
CREATE INDEX IF NOT EXISTS idx_order_invitations_partner_id ON public.order_invitations(partner_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

DO $$
BEGIN
  RAISE NOTICE '✓ All tables verified/created';
END $$;

-- =====================================================
-- STEP 5: CREATE HELPER FUNCTIONS
-- =====================================================

-- Check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'::user_role_enum
  );
$$;

-- Check if user is sales
CREATE OR REPLACE FUNCTION public.is_sales()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'sales'::user_role_enum
  );
$$;

-- Check if user is partner
CREATE OR REPLACE FUNCTION public.is_partner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'partner'::user_role_enum
  );
$$;

-- Check if user is admin or sales
CREATE OR REPLACE FUNCTION public.is_admin_or_sales()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin'::user_role_enum, 'sales'::user_role_enum)
  );
$$;

-- Check if current operation is from service role
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    OR current_user = 'service_role'
    OR current_user = 'postgres'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '✓ Created all helper functions';
END $$;

-- =====================================================
-- STEP 6: CREATE TRIGGERS
-- =====================================================

-- Trigger function: Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role_text text;
  v_role_enum user_role_enum;
BEGIN
  -- Get role from metadata (if provided during signup)
  v_role_text := COALESCE(NEW.raw_user_meta_data->>'role', '');
  
  -- Map to valid enum value (safe mapping)
  v_role_enum := CASE
    WHEN v_role_text = 'admin' THEN 'admin'::user_role_enum
    WHEN v_role_text = 'sales' THEN 'sales'::user_role_enum
    WHEN v_role_text = 'partner' THEN 'partner'::user_role_enum
    WHEN v_role_text = 'trainer' THEN 'partner'::user_role_enum
    ELSE 'partner'::user_role_enum
  END;

  -- Try to insert profile, but NEVER block signup if it fails
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      v_role_enum
    );
  EXCEPTION WHEN OTHERS THEN
    -- Silently continue - don't block signup
    -- Frontend will handle profile creation if needed
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger function: Prevent unauthorized role changes
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow service role (Supabase dashboard, backend operations)
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  
  -- Allow if no authenticated user (trigger/backend context)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Allow admins to change any role
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'::user_role_enum
  ) THEN
    RETURN NEW;
  END IF;
  
  -- Allow role changes within 10 seconds of profile creation (for onboarding)
  IF OLD.created_at IS NOT NULL AND (EXTRACT(EPOCH FROM (now() - OLD.created_at)) < 10) THEN
    RETURN NEW;
  END IF;
  
  -- Block all other role changes
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Permission denied: Only administrators can change user roles.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger (only fires on UPDATE when role changes)
DROP TRIGGER IF EXISTS prevent_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_role_change_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.prevent_role_change();

DO $$
BEGIN
  RAISE NOTICE '✓ Created all triggers';
END $$;

-- =====================================================
-- STEP 7: CREATE RLS POLICIES
-- =====================================================

-- ==================== PROFILES ====================

-- Everyone can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- Sales can read all profiles
CREATE POLICY "Sales can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_sales());

-- Service role and triggers can insert profiles
CREATE POLICY "Service and triggers can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (
    public.is_service_role() 
    OR auth.uid() IS NULL 
    OR public.is_admin()
    OR (public.is_sales() AND role = 'partner'::user_role_enum)
    OR auth.uid() = id  -- Users can create their own profile
  );

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Sales can update partner profiles
CREATE POLICY "Sales can update partner profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_sales() AND role = 'partner'::user_role_enum)
  WITH CHECK (public.is_sales() AND role = 'partner'::user_role_enum);

-- Admins can delete non-admin profiles
CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE
  USING (public.is_admin() AND role != 'admin'::user_role_enum);

-- Sales can delete partner profiles
CREATE POLICY "Sales can delete partner profiles"
  ON public.profiles FOR DELETE
  USING (public.is_sales() AND role = 'partner'::user_role_enum);

-- ==================== SALES ====================

-- Admins and Sales can read all sales records
CREATE POLICY "Admin and Sales can read sales"
  ON public.sales FOR SELECT
  USING (public.is_admin_or_sales());

-- Partners can read their own sales
CREATE POLICY "Partners can read own sales"
  ON public.sales FOR SELECT
  USING (public.is_partner() AND trainer_id = auth.uid());

-- Admins and Sales can insert sales
CREATE POLICY "Admin and Sales can insert sales"
  ON public.sales FOR INSERT
  WITH CHECK (public.is_admin_or_sales());

-- Partners can insert their own sales
CREATE POLICY "Partners can insert own sales"
  ON public.sales FOR INSERT
  WITH CHECK (public.is_partner() AND trainer_id = auth.uid());

-- Admins and Sales can update all sales
CREATE POLICY "Admin and Sales can update sales"
  ON public.sales FOR UPDATE
  USING (public.is_admin_or_sales())
  WITH CHECK (public.is_admin_or_sales());

-- Partners can update their own sales
CREATE POLICY "Partners can update own sales"
  ON public.sales FOR UPDATE
  USING (public.is_partner() AND trainer_id = auth.uid())
  WITH CHECK (public.is_partner() AND trainer_id = auth.uid());

-- Admins and Sales can delete sales
CREATE POLICY "Admin and Sales can delete sales"
  ON public.sales FOR DELETE
  USING (public.is_admin_or_sales());

-- Partners can delete their own sales
CREATE POLICY "Partners can delete own sales"
  ON public.sales FOR DELETE
  USING (public.is_partner() AND trainer_id = auth.uid());

-- ==================== LEADS ====================

-- Admins and Sales can read all leads
CREATE POLICY "Admin and Sales can read leads"
  ON public.leads FOR SELECT
  USING (public.is_admin_or_sales());

-- Admins and Sales can insert leads
CREATE POLICY "Admin and Sales can insert leads"
  ON public.leads FOR INSERT
  WITH CHECK (public.is_admin_or_sales());

-- Admins and Sales can update leads
CREATE POLICY "Admin and Sales can update leads"
  ON public.leads FOR UPDATE
  USING (public.is_admin_or_sales())
  WITH CHECK (public.is_admin_or_sales());

-- Admins and Sales can delete leads
CREATE POLICY "Admin and Sales can delete leads"
  ON public.leads FOR DELETE
  USING (public.is_admin_or_sales());

-- ==================== AUDIT LOGS ====================

-- Only admins can read audit logs
CREATE POLICY "Admins can read audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_admin());

-- All authenticated users can insert audit logs
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ==================== ORDERS ====================

-- Admins and Sales can read all orders
CREATE POLICY "Admin and Sales can read orders"
  ON public.orders FOR SELECT
  USING (public.is_admin_or_sales());

-- Partners can read their own orders
CREATE POLICY "Partners can read own orders"
  ON public.orders FOR SELECT
  USING (public.is_partner() AND partner_id = auth.uid());

-- Admins and Sales can insert orders
CREATE POLICY "Admin and Sales can insert orders"
  ON public.orders FOR INSERT
  WITH CHECK (public.is_admin_or_sales());

-- Admins and Sales can update orders
CREATE POLICY "Admin and Sales can update orders"
  ON public.orders FOR UPDATE
  USING (public.is_admin_or_sales())
  WITH CHECK (public.is_admin_or_sales());

-- Partners can update their own orders
CREATE POLICY "Partners can update own orders"
  ON public.orders FOR UPDATE
  USING (public.is_partner() AND partner_id = auth.uid())
  WITH CHECK (public.is_partner() AND partner_id = auth.uid());

-- Only admins can delete orders
CREATE POLICY "Admins can delete orders"
  ON public.orders FOR DELETE
  USING (public.is_admin());

-- ==================== ORDER INVITATIONS ====================

-- Admins and Sales can read all invitations
CREATE POLICY "Admin and Sales can read invitations"
  ON public.order_invitations FOR SELECT
  USING (public.is_admin_or_sales());

-- Partners can read their own invitations
CREATE POLICY "Partners can read own invitations"
  ON public.order_invitations FOR SELECT
  USING (public.is_partner() AND partner_id = auth.uid());

-- Admins and Sales can insert invitations
CREATE POLICY "Admin and Sales can insert invitations"
  ON public.order_invitations FOR INSERT
  WITH CHECK (public.is_admin_or_sales());

-- Admins and Sales can update invitations
CREATE POLICY "Admin and Sales can update invitations"
  ON public.order_invitations FOR UPDATE
  USING (public.is_admin_or_sales())
  WITH CHECK (public.is_admin_or_sales());

-- Partners can respond to their invitations
CREATE POLICY "Partners can respond to invitations"
  ON public.order_invitations FOR UPDATE
  USING (public.is_partner() AND partner_id = auth.uid())
  WITH CHECK (public.is_partner() AND partner_id = auth.uid());

-- Admins and Sales can delete invitations
CREATE POLICY "Admin and Sales can delete invitations"
  ON public.order_invitations FOR DELETE
  USING (public.is_admin_or_sales());

DO $$
BEGIN
  RAISE NOTICE '✓ Created all RLS policies';
END $$;

-- =====================================================
-- STEP 8: ENSURE ADMIN USER EXISTS
-- =====================================================

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Find admin user by email
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE email = 'sunny@gmail.com';
  
  IF v_admin_id IS NOT NULL THEN
    -- Ensure profile exists with admin role
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (v_admin_id, 'sunny@gmail.com', 'Admin', 'admin'::user_role_enum)
    ON CONFLICT (id) DO UPDATE 
    SET role = 'admin'::user_role_enum;
    
    RAISE NOTICE '✓ Admin user (sunny@gmail.com) configured';
  ELSE
    RAISE NOTICE '⚠ Admin user (sunny@gmail.com) not found in auth.users';
    RAISE NOTICE '  Create this user in Supabase Dashboard first';
  END IF;
END $$;

-- =====================================================
-- STEP 9: SETUP SALES USER (if exists)
-- =====================================================

DO $$
DECLARE
  v_sales_id uuid;
BEGIN
  -- Find sales user by email
  SELECT id INTO v_sales_id
  FROM auth.users
  WHERE email = 'sales@gmail.com';
  
  IF v_sales_id IS NOT NULL THEN
    -- Ensure profile exists with sales role
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (v_sales_id, 'sales@gmail.com', 'Sales Executive', 'sales'::user_role_enum)
    ON CONFLICT (id) DO UPDATE 
    SET role = 'sales'::user_role_enum;
    
    RAISE NOTICE '✓ Sales user (sales@gmail.com) configured';
  ELSE
    RAISE NOTICE '⚠ Sales user (sales@gmail.com) not found in auth.users';
    RAISE NOTICE '  To create: Go to Supabase Dashboard → Authentication → Users → Add user';
    RAISE NOTICE '  Email: sales@gmail.com, Password: qwerty1234, Auto Confirm: Yes';
    RAISE NOTICE '  Then run this script again to set up the profile';
  END IF;
END $$;

-- =====================================================
-- FINAL SUMMARY
-- =====================================================

DO $$
DECLARE
  profile_count INTEGER;
  sales_count INTEGER;
  leads_count INTEGER;
  orders_count INTEGER;
  invitations_count INTEGER;
  audit_count INTEGER;
BEGIN
  -- Count policies per table
  SELECT COUNT(*) INTO profile_count FROM pg_policies WHERE tablename = 'profiles';
  SELECT COUNT(*) INTO sales_count FROM pg_policies WHERE tablename = 'sales';
  SELECT COUNT(*) INTO leads_count FROM pg_policies WHERE tablename = 'leads';
  SELECT COUNT(*) INTO orders_count FROM pg_policies WHERE tablename = 'orders';
  SELECT COUNT(*) INTO invitations_count FROM pg_policies WHERE tablename = 'order_invitations';
  SELECT COUNT(*) INTO audit_count FROM pg_policies WHERE tablename = 'audit_logs';
  
  RAISE NOTICE '';
  RAISE NOTICE '╔══════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║           🦇 BATMAN.SQL COMPLETE 🦇                      ║';
  RAISE NOTICE '╠══════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║ Database Setup:                                          ║';
  RAISE NOTICE '║   ✓ user_role_enum type (admin, sales, partner)          ║';
  RAISE NOTICE '║   ✓ All tables created/verified                          ║';
  RAISE NOTICE '║   ✓ Helper functions (is_admin, is_sales, etc.)          ║';
  RAISE NOTICE '║   ✓ Triggers (handle_new_user, prevent_role_change)      ║';
  RAISE NOTICE '╠══════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║ RLS Policies Created:                                    ║';
  RAISE NOTICE '║   • profiles: % policies', profile_count;
  RAISE NOTICE '║   • sales: % policies', sales_count;
  RAISE NOTICE '║   • leads: % policies', leads_count;
  RAISE NOTICE '║   • orders: % policies', orders_count;
  RAISE NOTICE '║   • order_invitations: % policies', invitations_count;
  RAISE NOTICE '║   • audit_logs: % policies', audit_count;
  RAISE NOTICE '╠══════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║ User Roles:                                              ║';
  RAISE NOTICE '║   • admin: Full access to everything                     ║';
  RAISE NOTICE '║   • sales: Manage partners, sales, leads, invitations    ║';
  RAISE NOTICE '║   • partner: Access own data only                        ║';
  RAISE NOTICE '╠══════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║ Next Steps:                                              ║';
  RAISE NOTICE '║   1. Create users in Supabase Dashboard → Auth → Users   ║';
  RAISE NOTICE '║   2. Run this script again to set up their profiles      ║';
  RAISE NOTICE '║   3. Login and test!                                     ║';
  RAISE NOTICE '╚══════════════════════════════════════════════════════════╝';
END $$;

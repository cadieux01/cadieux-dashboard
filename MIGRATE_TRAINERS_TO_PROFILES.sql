-- =====================================================
-- MIGRATION: trainers -> profiles
-- =====================================================
-- Goal:
-- 1) move sales/leads ownership from public.trainers to public.profiles
-- 2) keep existing trainer_id columns (now pointing to profiles.id)
-- 3) update partner sales RLS to use trainer_id = auth.uid()
-- 4) drop public.trainers (and dependent legacy objects)
--
-- Safe to run multiple times.

BEGIN;

-- Ensure required columns exist (legacy DB safety)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS trainer_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS trainer_id uuid;

-- Remove old FKs that pointed to public.trainers
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_trainer_id_fkey;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_trainer_id_fkey;

-- Backfill trainer_id values to profile ids using best-effort matching
DO $$
BEGIN
  IF to_regclass('public.trainers') IS NOT NULL THEN
    CREATE TEMP TABLE tmp_trainer_profile_map ON COMMIT DROP AS
    SELECT
      t.id AS trainer_id,
      COALESCE(
        p_by_id.id,
        p_by_phone.id,
        p_by_email.id,
        p_by_name.id
      ) AS profile_id
    FROM public.trainers t
    LEFT JOIN public.profiles p_by_id
      ON p_by_id.id = t.id
      AND p_by_id.role::text = 'partner'
    LEFT JOIN public.profiles p_by_phone
      ON t.contact IS NOT NULL
      AND p_by_phone.phone_number = t.contact
      AND p_by_phone.role::text = 'partner'
    LEFT JOIN public.profiles p_by_email
      ON t.contact IS NOT NULL
      AND lower(p_by_email.email) = lower(t.contact)
      AND p_by_email.role::text = 'partner'
    LEFT JOIN public.profiles p_by_name
      ON t.name IS NOT NULL
      AND p_by_name.full_name = t.name
      AND p_by_name.role::text = 'partner';

    UPDATE public.sales s
    SET trainer_id = m.profile_id
    FROM tmp_trainer_profile_map m
    WHERE s.trainer_id = m.trainer_id
      AND m.profile_id IS NOT NULL;

    UPDATE public.leads l
    SET trainer_id = m.profile_id
    FROM tmp_trainer_profile_map m
    WHERE l.trainer_id = m.trainer_id
      AND m.profile_id IS NOT NULL;
  END IF;
END $$;

-- Remove unresolved/non-partner links so FK creation succeeds
UPDATE public.sales s
SET trainer_id = NULL
WHERE trainer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = s.trainer_id
      AND p.role::text = 'partner'
  );

UPDATE public.leads l
SET trainer_id = NULL
WHERE trainer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = l.trainer_id
      AND p.role::text = 'partner'
  );

-- Recreate FKs to public.profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_trainer_id_fkey'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_trainer_id_fkey
      FOREIGN KEY (trainer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_trainer_id_fkey'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_trainer_id_fkey
      FOREIGN KEY (trainer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Keep indexes
CREATE INDEX IF NOT EXISTS idx_sales_trainer_id ON public.sales(trainer_id);
CREATE INDEX IF NOT EXISTS idx_leads_trainer_id ON public.leads(trainer_id);

-- Replace partner sales policies with direct ownership checks
DROP POLICY IF EXISTS "Partners can read own sales" ON public.sales;
DROP POLICY IF EXISTS "Partners can insert own sales" ON public.sales;
DROP POLICY IF EXISTS "Partners can update own sales" ON public.sales;
DROP POLICY IF EXISTS "Partners can delete own sales" ON public.sales;

CREATE POLICY "Partners can read own sales"
  ON public.sales FOR SELECT
  USING (public.is_partner() AND trainer_id = auth.uid());

CREATE POLICY "Partners can insert own sales"
  ON public.sales FOR INSERT
  WITH CHECK (public.is_partner() AND trainer_id = auth.uid());

CREATE POLICY "Partners can update own sales"
  ON public.sales FOR UPDATE
  USING (public.is_partner() AND trainer_id = auth.uid())
  WITH CHECK (public.is_partner() AND trainer_id = auth.uid());

CREATE POLICY "Partners can delete own sales"
  ON public.sales FOR DELETE
  USING (public.is_partner() AND trainer_id = auth.uid());

-- Legacy objects that depended on trainers
DROP VIEW IF EXISTS public.trainer_rankings;

-- Finally drop trainers table
DROP TABLE IF EXISTS public.trainers CASCADE;

COMMIT;

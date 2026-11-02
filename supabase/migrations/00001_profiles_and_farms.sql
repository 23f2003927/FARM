-- Migration: Core identity and farm structure
-- Tables: profiles, farms, farm_memberships
-- Includes: RLS policies, triggers, helper functions

-- ============================================================
-- BASE UTILITY FUNCTIONS
-- ============================================================

-- Reusable updated_at trigger function
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  preferred_language text NOT NULL DEFAULT 'en',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- 2. FARMS (Table structure created before membership helpers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_farms_updated_at ON public.farms;
CREATE TRIGGER set_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- 3. FARM MEMBERSHIPS (Table created BEFORE helper functions query it)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.farm_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roles text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'revoked')),
  assigned_by uuid REFERENCES public.profiles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, user_id)
);

-- Validate roles array values
CREATE OR REPLACE FUNCTION public.fn_validate_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  r text;
  valid_roles text[] := ARRAY['owner', 'agronomist', 'procurement', 'supervisor', 'verifier'];
BEGIN
  IF array_length(NEW.roles, 1) IS NULL OR array_length(NEW.roles, 1) = 0 THEN
    RAISE EXCEPTION 'At least one role must be assigned';
  END IF;
  FOREACH r IN ARRAY NEW.roles LOOP
    IF r != ALL(valid_roles) THEN
      RAISE EXCEPTION 'Invalid role: %. Valid roles: owner, agronomist, procurement, supervisor, verifier', r;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_membership_roles ON public.farm_memberships;
CREATE TRIGGER validate_membership_roles
  BEFORE INSERT OR UPDATE ON public.farm_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_roles();

ALTER TABLE public.farm_memberships ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_farm_memberships_updated_at ON public.farm_memberships;
CREATE TRIGGER set_farm_memberships_updated_at
  BEFORE UPDATE ON public.farm_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_farm_memberships_user ON public.farm_memberships(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_farm_memberships_farm ON public.farm_memberships(farm_id) WHERE status = 'active';

-- ============================================================
-- 4. HELPER FUNCTIONS (Created AFTER farm_memberships table exists)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_user_farm_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT farm_id
  FROM public.farm_memberships
  WHERE user_id = auth.uid()
    AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_has_farm_role(
  p_farm_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.farm_memberships
    WHERE user_id = auth.uid()
      AND farm_id = p_farm_id
      AND status = 'active'
      AND p_role = ANY(roles)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_has_any_farm_role(
  p_farm_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.farm_memberships
    WHERE user_id = auth.uid()
      AND farm_id = p_farm_id
      AND status = 'active'
      AND roles && p_roles
  );
END;
$$;

-- ============================================================
-- 5. RLS POLICIES (Applied now that helper functions exist)
-- ============================================================

-- Farms Policies
DROP POLICY IF EXISTS "farms_select" ON public.farms;
CREATE POLICY "farms_select" ON public.farms
  FOR SELECT USING (id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "farms_insert" ON public.farms;
CREATE POLICY "farms_insert" ON public.farms
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "farms_update" ON public.farms;
CREATE POLICY "farms_update" ON public.farms
  FOR UPDATE USING (public.fn_user_has_farm_role(id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(id, 'owner'));

-- Farm Memberships Policies
DROP POLICY IF EXISTS "fm_select" ON public.farm_memberships;
CREATE POLICY "fm_select" ON public.farm_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.fn_user_has_farm_role(farm_id, 'owner')
  );

DROP POLICY IF EXISTS "fm_insert" ON public.farm_memberships;
CREATE POLICY "fm_insert" ON public.farm_memberships
  FOR INSERT WITH CHECK (
    public.fn_user_has_farm_role(farm_id, 'owner')
    AND assigned_by = auth.uid()
  );

DROP POLICY IF EXISTS "fm_update" ON public.farm_memberships;
CREATE POLICY "fm_update" ON public.farm_memberships
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

-- ============================================================
-- 6. BOOTSTRAP: Function to create first farm + owner membership
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_bootstrap_farm(
  p_user_id uuid,
  p_farm_name text,
  p_farm_location text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_farm_id uuid;
BEGIN
  -- Ensure profile exists
  INSERT INTO public.profiles (id, full_name)
  VALUES (p_user_id, 'Farm Owner')
  ON CONFLICT (id) DO NOTHING;

  -- Create the farm
  INSERT INTO public.farms (name, location, owner_id)
  VALUES (p_farm_name, p_farm_location, p_user_id)
  RETURNING id INTO v_farm_id;

  -- Create owner membership
  INSERT INTO public.farm_memberships (farm_id, user_id, roles, assigned_by)
  VALUES (v_farm_id, p_user_id, ARRAY['owner'], p_user_id)
  ON CONFLICT (farm_id, user_id) DO UPDATE
  SET roles = ARRAY['owner'], status = 'active';

  RETURN v_farm_id;
END;
$$;

-- Migration: Core identity and farm structure
-- Tables: profiles, farms, farm_memberships
-- Includes: RLS policies, triggers, helper functions

-- ============================================================
-- HELPER FUNCTIONS (used by RLS policies)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_user_farm_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT farm_id
  FROM public.farm_memberships
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.fn_user_has_farm_role(
  p_farm_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.farm_memberships
    WHERE user_id = auth.uid()
      AND farm_id = p_farm_id
      AND status = 'active'
      AND p_role = ANY(roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_user_has_any_farm_role(
  p_farm_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.farm_memberships
    WHERE user_id = auth.uid()
      AND farm_id = p_farm_id
      AND status = 'active'
      AND roles && p_roles
  );
$$;

-- ============================================================
-- PROFILES
-- ============================================================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  preferred_language text NOT NULL DEFAULT 'en',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

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
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function (reused across tables)
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

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- FARMS
-- ============================================================

CREATE TABLE public.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "farms_select" ON public.farms
  FOR SELECT USING (id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "farms_insert" ON public.farms
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "farms_update" ON public.farms
  FOR UPDATE USING (public.fn_user_has_farm_role(id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(id, 'owner'));

CREATE TRIGGER set_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- FARM MEMBERSHIPS
-- ============================================================

CREATE TABLE public.farm_memberships (
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

CREATE TRIGGER validate_membership_roles
  BEFORE INSERT OR UPDATE ON public.farm_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_roles();

ALTER TABLE public.farm_memberships ENABLE ROW LEVEL SECURITY;

-- Users can see their own memberships; owners can see all farm memberships
CREATE POLICY "fm_select" ON public.farm_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.fn_user_has_farm_role(farm_id, 'owner')
  );

-- Only owners can create memberships
CREATE POLICY "fm_insert" ON public.farm_memberships
  FOR INSERT WITH CHECK (
    public.fn_user_has_farm_role(farm_id, 'owner')
    AND assigned_by = auth.uid()
  );

-- Only owners can update memberships
CREATE POLICY "fm_update" ON public.farm_memberships
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE TRIGGER set_farm_memberships_updated_at
  BEFORE UPDATE ON public.farm_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Index for performance
CREATE INDEX idx_farm_memberships_user ON public.farm_memberships(user_id) WHERE status = 'active';
CREATE INDEX idx_farm_memberships_farm ON public.farm_memberships(farm_id) WHERE status = 'active';

-- ============================================================
-- BOOTSTRAP: Function to create first farm + owner membership
-- Run this AFTER creating a user via Supabase Auth dashboard
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
  -- Create the farm
  INSERT INTO public.farms (name, location, owner_id)
  VALUES (p_farm_name, p_farm_location, p_user_id)
  RETURNING id INTO v_farm_id;

  -- Create owner membership
  INSERT INTO public.farm_memberships (farm_id, user_id, roles, assigned_by)
  VALUES (v_farm_id, p_user_id, ARRAY['owner'], p_user_id);

  RETURN v_farm_id;
END;
$$;
-- Migration: Farm structure (polyhouses, zones, crop cycles)
-- Tables: houses, zones, crop_cycles

-- ============================================================
-- HOUSES (Polyhouses)
-- ============================================================

CREATE TABLE public.houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  area_sqm numeric(10,2),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name)
);

ALTER TABLE public.houses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "houses_select" ON public.houses
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "houses_insert" ON public.houses
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE POLICY "houses_update" ON public.houses
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE TRIGGER set_houses_updated_at
  BEFORE UPDATE ON public.houses
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_houses_farm ON public.houses(farm_id);

-- ============================================================
-- ZONES
-- ============================================================

CREATE TABLE public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_id, name)
);

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zones_select" ON public.zones
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "zones_insert" ON public.zones
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE POLICY "zones_update" ON public.zones
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE TRIGGER set_zones_updated_at
  BEFORE UPDATE ON public.zones
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_zones_house ON public.zones(house_id);
CREATE INDEX idx_zones_farm ON public.zones(farm_id);

-- ============================================================
-- CROP CYCLES
-- ============================================================

CREATE TABLE public.crop_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.zones(id),
  crop_name text NOT NULL,
  variety text,
  planting_date date NOT NULL,
  growth_stage text,
  expected_harvest_start date,
  expected_harvest_end date,
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'harvesting', 'completed', 'abandoned')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crop_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crop_cycles_select" ON public.crop_cycles
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "crop_cycles_insert" ON public.crop_cycles
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE POLICY "crop_cycles_update" ON public.crop_cycles
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

CREATE TRIGGER set_crop_cycles_updated_at
  BEFORE UPDATE ON public.crop_cycles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_crop_cycles_farm ON public.crop_cycles(farm_id);
CREATE INDEX idx_crop_cycles_house ON public.crop_cycles(house_id);
CREATE INDEX idx_crop_cycles_status ON public.crop_cycles(farm_id, status);

-- ============================================================
-- SEED DATA: Sample farm structure
-- ============================================================

-- NOTE: This seed data will be inserted using fn_bootstrap_farm
-- after the first user is created. The seed insert below is
-- a helper for development and will use a placeholder user_id.
-- The actual bootstrap is done via SQL after first signup.
-- Migration: Product Master Catalogue & Aliases
-- Tables: product_catalog, product_aliases, product_documents
-- Includes: RLS policies, triggers, indexes

-- ============================================================
-- PRODUCT CATALOGUE
-- ============================================================

CREATE TABLE public.product_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN (
      'pesticide',
      'fungicide',
      'insecticide',
      'fertilizer',
      'biological',
      'nutrient',
      'plant_growth_regulator',
      'adjuvant',
      'other'
    )
  ),
  trade_name text NOT NULL,
  brand text,
  active_ingredient text,
  concentration text,
  formulation text,
  manufacturer text,
  target_crops_pests text,
  label_reference text,
  standard_package_size numeric(12,4),
  package_unit text CHECK (package_unit IN ('mg', 'g', 'kg', 'ml', 'L', 'pieces')),
  stock_unit text NOT NULL CHECK (stock_unit IN ('mg', 'g', 'kg', 'ml', 'L', 'pieces')),
  minimum_stock_level numeric(12,4) NOT NULL DEFAULT 0,
  storage_instructions text,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'pending_verification', 'verified', 'rejected')
  ),
  verified_by uuid REFERENCES public.profiles(id),
  verified_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, trade_name, concentration, formulation)
);

ALTER TABLE public.product_catalog ENABLE ROW LEVEL SECURITY;

-- Farm members can view active products
CREATE POLICY "product_catalog_select" ON public.product_catalog
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

-- Owners and Agronomists can create products
CREATE POLICY "product_catalog_insert" ON public.product_catalog
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

-- Owner can update unverified products; Agronomist can verify/update products
CREATE POLICY "product_catalog_update" ON public.product_catalog
  FOR UPDATE USING (
    (public.fn_user_has_farm_role(farm_id, 'owner') AND verification_status != 'verified')
    OR public.fn_user_has_farm_role(farm_id, 'agronomist')
  )
  WITH CHECK (
    (public.fn_user_has_farm_role(farm_id, 'owner') AND verification_status != 'verified')
    OR public.fn_user_has_farm_role(farm_id, 'agronomist')
  );

CREATE TRIGGER set_product_catalog_updated_at
  BEFORE UPDATE ON public.product_catalog
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_products_farm ON public.product_catalog(farm_id);
CREATE INDEX idx_products_category ON public.product_catalog(farm_id, category);
CREATE INDEX idx_products_status ON public.product_catalog(farm_id, verification_status);

-- ============================================================
-- PRODUCT ALIASES
-- ============================================================

CREATE TABLE public.product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product_catalog(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  alias_type text CHECK (
    alias_type IN ('commercial', 'supplier', 'agronomist', 'local_language', 'handwritten')
  ),
  language text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, alias_name)
);

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_aliases_select" ON public.product_aliases
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "product_aliases_insert" ON public.product_aliases
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE POLICY "product_aliases_update" ON public.product_aliases
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE POLICY "product_aliases_delete" ON public.product_aliases
  FOR DELETE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE INDEX idx_aliases_product ON public.product_aliases(product_id);
CREATE INDEX idx_aliases_farm_name ON public.product_aliases(farm_id, alias_name);

-- ============================================================
-- PRODUCT DOCUMENTS (Labels, Leaflets, SDS)
-- ============================================================

CREATE TABLE public.product_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product_catalog(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('label', 'leaflet', 'sds', 'other')),
  file_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_documents_select" ON public.product_documents
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "product_documents_insert" ON public.product_documents
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );
-- Migration: Optional Seed Data for Polyhouses & Standard Products
-- Run this function after running fn_bootstrap_farm to populate initial demo data

CREATE OR REPLACE FUNCTION public.fn_seed_demo_data(p_farm_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_h1 uuid;
  v_h2 uuid;
  v_h3 uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_p4 uuid;
BEGIN
  -- 1. Create Polyhouses
  INSERT INTO public.houses (farm_id, name, description, area_sqm, status)
  VALUES (p_farm_id, 'Polyhouse A (North)', 'Naturally ventilated polyhouse - 1000 sqm', 1000.00, 'active')
  RETURNING id INTO v_h1;

  INSERT INTO public.houses (farm_id, name, description, area_sqm, status)
  VALUES (p_farm_id, 'Polyhouse B (South)', 'High-tunnel climate controlled polyhouse - 1500 sqm', 1500.00, 'active')
  RETURNING id INTO v_h2;

  INSERT INTO public.houses (farm_id, name, description, area_sqm, status)
  VALUES (p_farm_id, 'Polyhouse C (East)', 'Experimental polyhouse - 500 sqm', 500.00, 'active')
  RETURNING id INTO v_h3;

  -- 2. Create Zones
  INSERT INTO public.zones (house_id, farm_id, name, description)
  VALUES 
    (v_h1, p_farm_id, 'Zone A1', 'Rows 1-10 (Left Bay)'),
    (v_h1, p_farm_id, 'Zone A2', 'Rows 11-20 (Right Bay)'),
    (v_h2, p_farm_id, 'Zone B1', 'Complete Bay');

  -- 3. Create Sample Crop Cycles
  INSERT INTO public.crop_cycles (
    farm_id, house_id, crop_name, variety, planting_date, growth_stage, status, notes
  )
  VALUES 
    (p_farm_id, v_h1, 'Capsicum (Bell Pepper)', 'Inspiration F1', CURRENT_DATE - INTERVAL '25 days', 'Vegetative / Flowering', 'active', 'Targeting high yield colored capsicum'),
    (p_farm_id, v_h2, 'English Cucumber', 'King Star RZ', CURRENT_DATE - INTERVAL '15 days', 'Early Fruit Development', 'active', 'Drip fertigation twice weekly');

  -- 4. Create Standard Canonical Products
  INSERT INTO public.product_catalog (
    farm_id, category, trade_name, brand, active_ingredient, concentration, formulation,
    manufacturer, target_crops_pests, standard_package_size, package_unit, stock_unit,
    minimum_stock_level, verification_status
  )
  VALUES (
    p_farm_id, 'insecticide', 'Confidor 200 SL', 'Bayer CropScience', 'Imidacloprid', '17.8% SL', 'Soluble Liquid (SL)',
    'Bayer', 'Aphids, Whiteflies, Thrips in Vegetables', 250.0000, 'ml', 'ml',
    500.0000, 'verified'
  ) RETURNING id INTO v_p1;

  INSERT INTO public.product_catalog (
    farm_id, category, trade_name, brand, active_ingredient, concentration, formulation,
    manufacturer, target_crops_pests, standard_package_size, package_unit, stock_unit,
    minimum_stock_level, verification_status
  )
  VALUES (
    p_farm_id, 'fungicide', 'Ridomil Gold MZ', 'Syngenta', 'Metalaxyl-M 4% + Mancozeb 64%', '68% WP', 'Wettable Powder (WP)',
    'Syngenta', 'Downy mildew, Late blight, Phytophthora', 500.0000, 'g', 'g',
    1000.0000, 'verified'
  ) RETURNING id INTO v_p2;

  INSERT INTO public.product_catalog (
    farm_id, category, trade_name, brand, active_ingredient, concentration, formulation,
    manufacturer, target_crops_pests, standard_package_size, package_unit, stock_unit,
    minimum_stock_level, verification_status
  )
  VALUES (
    p_farm_id, 'fertilizer', '19-19-19 100% Water Soluble', 'Mahadhan', 'NPK (19:19:19)', '19:19:19', 'Water Soluble Crystals',
    'Deepak Fertilisers', 'Balanced vegetative fertigation', 25.0000, 'kg', 'kg',
    50.0000, 'verified'
  ) RETURNING id INTO v_p3;

  INSERT INTO public.product_catalog (
    farm_id, category, trade_name, brand, active_ingredient, concentration, formulation,
    manufacturer, target_crops_pests, standard_package_size, package_unit, stock_unit,
    minimum_stock_level, verification_status
  )
  VALUES (
    p_farm_id, 'biological', 'Trichoderma Viride Bio-Fungicide', 'Kisan Bio', 'Trichoderma viride 1.5% WP', '2x10^8 CFU/g', 'Powder',
    'Kisan Bio-Tech', 'Damping off, Root rot, Fusarium wilt', 1.0000, 'kg', 'kg',
    5.0000, 'verified'
  ) RETURNING id INTO v_p4;

  -- 5. Add Product Aliases
  INSERT INTO public.product_aliases (product_id, farm_id, alias_name, alias_type, notes)
  VALUES
    (v_p1, p_farm_id, 'Confidor', 'commercial', 'Common agronomist shorthand'),
    (v_p1, p_farm_id, 'Imida', 'handwritten', 'Frequently encountered handwritten spelling'),
    (v_p2, p_farm_id, 'Ridomil', 'commercial', 'Trade name shorthand'),
    (v_p3, p_farm_id, '19:19:19 NPK', 'commercial', 'Standard fertigation grade');

END;
$$;
-- Migration: Treatment Plans & Line Items
-- Tables: treatment_plans, treatment_plan_lines, treatment_plan_documents
-- Includes: RLS policies, revision triggers, status validation

-- ============================================================
-- TREATMENT PLANS (Header / Agronomist Visit Schedule)
-- ============================================================

CREATE TABLE public.treatment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  agronomist_name text,
  plan_start_date date,
  plan_end_date date,
  original_document_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'active', 'completed', 'cancelled')
  ),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatment_plans_select" ON public.treatment_plans
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "treatment_plans_insert" ON public.treatment_plans
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE POLICY "treatment_plans_update" ON public.treatment_plans
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE TRIGGER set_treatment_plans_updated_at
  BEFORE UPDATE ON public.treatment_plans
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_treatment_plans_farm ON public.treatment_plans(farm_id);
CREATE INDEX idx_treatment_plans_status ON public.treatment_plans(farm_id, status);

-- ============================================================
-- TREATMENT PLAN LINES (Discrete Chemical / Nutritional Instructions)
-- ============================================================

CREATE TABLE public.treatment_plan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.treatment_plans(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  line_number integer NOT NULL DEFAULT 1,
  
  -- Handwritten / Transcribed Record
  original_product_name text,
  corrected_product_name text,
  
  -- Matched Canonical Product
  product_id uuid REFERENCES public.product_catalog(id),
  product_match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    product_match_status IN ('unmatched', 'suggested', 'confirmed', 'rejected')
  ),
  
  -- Target Location & Crop
  house_id uuid REFERENCES public.houses(id),
  zone_id uuid REFERENCES public.zones(id),
  crop_cycle_id uuid REFERENCES public.crop_cycles(id),
  scheduled_date date NOT NULL,
  target_issue text,
  
  -- Agronomic Application Instructions
  original_instruction text,
  application_method text,
  
  -- Rate vs Total Quantity Distinction (Agricultural Safety)
  recommended_quantity numeric(12,4),
  quantity_unit text,
  rate_value numeric(12,4),
  rate_unit text,
  rate_basis text CHECK (
    rate_basis IN ('per_litre', 'per_tank', 'per_plant', 'per_area', 'per_hectare', 'other')
  ),
  approved_total_quantity numeric(12,4),
  approved_quantity_unit text,
  water_volume numeric(12,4),
  water_volume_unit text,
  
  -- Safety & Waiting Periods
  label_reference text,
  phi_days integer,
  rei_hours numeric(6,2),
  safety_precautions text,
  clarification_notes text,
  
  -- State Machine Status
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'needs_clarification',
      'pending_approval',
      'approved',
      'released',
      'in_progress',
      'completed',
      'verified',
      'rejected',
      'cancelled'
    )
  ),
  
  -- Approval & Version Tracking
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  revision_number integer NOT NULL DEFAULT 1,
  parent_line_id uuid REFERENCES public.treatment_plan_lines(id),
  is_current_revision boolean NOT NULL DEFAULT true,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_plan_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatment_lines_select" ON public.treatment_plan_lines
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "treatment_lines_insert" ON public.treatment_plan_lines
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

-- Owner can edit drafts; Agronomist can approve/clarify/reject; Owner can release approved
CREATE POLICY "treatment_lines_update" ON public.treatment_plan_lines
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE TRIGGER set_treatment_plan_lines_updated_at
  BEFORE UPDATE ON public.treatment_plan_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_treatment_lines_plan ON public.treatment_plan_lines(plan_id);
CREATE INDEX idx_treatment_lines_farm ON public.treatment_plan_lines(farm_id);
CREATE INDEX idx_treatment_lines_status ON public.treatment_plan_lines(farm_id, status);
CREATE INDEX idx_treatment_lines_date ON public.treatment_plan_lines(farm_id, scheduled_date);

-- ============================================================
-- TREATMENT PLAN DOCUMENTS (Original Handwritten Notes / PDFs)
-- ============================================================

CREATE TABLE public.treatment_plan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.treatment_plans(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (
    document_type IN ('original_handwritten', 'pdf', 'supporting')
  ),
  file_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_plan_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatment_docs_select" ON public.treatment_plan_documents
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "treatment_docs_insert" ON public.treatment_plan_documents
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );
-- Migration: Inventory Management, Batches & Append-Only Stock Movements
-- Tables: suppliers, product_batches, stock_movements
-- Views: v_stock_balances, v_usable_stock, v_expiring_batches
-- Functions: fn_record_stock_movement

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select" ON public.suppliers
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "suppliers_insert" ON public.suppliers
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE POLICY "suppliers_update" ON public.suppliers
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE TRIGGER set_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- PRODUCT BATCHES (Lot Tracking & Expiry)
-- ============================================================

CREATE TABLE public.product_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product_catalog(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  manufacturing_date date,
  expiry_date date,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid REFERENCES public.suppliers(id),
  purchase_invoice_ref text,
  package_size numeric(12,4),
  package_unit text,
  initial_quantity numeric(12,4) NOT NULL,
  quantity_unit text NOT NULL,
  storage_location text,
  status text NOT NULL DEFAULT 'available' CHECK (
    status IN ('available', 'quarantined', 'expired', 'damaged', 'depleted')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, product_id, batch_number)
);

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batches_select" ON public.product_batches
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "batches_insert" ON public.product_batches
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE POLICY "batches_update" ON public.product_batches
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE TRIGGER set_product_batches_updated_at
  BEFORE UPDATE ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_batches_product ON public.product_batches(product_id);
CREATE INDEX idx_batches_expiry ON public.product_batches(farm_id, expiry_date);

-- ============================================================
-- STOCK MOVEMENTS (APPEND-ONLY LEDGER)
-- ============================================================

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.product_catalog(id),
  batch_id uuid NOT NULL REFERENCES public.product_batches(id),
  movement_type text NOT NULL CHECK (
    movement_type IN (
      'opening_stock',
      'purchase_receipt',
      'issue',
      'return',
      'disposal',
      'adjustment'
    )
  ),
  quantity numeric(12,4) NOT NULL, -- Positive for in (+), Negative for out (-)
  unit text NOT NULL,
  reference_type text, -- e.g. 'work_order', 'purchase_order', 'physical_count'
  reference_id uuid,
  reason text,
  performed_by uuid NOT NULL REFERENCES public.profiles(id),
  authorized_by uuid REFERENCES public.profiles(id),
  movement_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- STRICT APPEND-ONLY: No UPDATE, No DELETE policies
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT WITH CHECK (
    farm_id IN (SELECT public.fn_user_farm_ids())
    AND performed_by = auth.uid()
    AND (
      (movement_type IN ('opening_stock', 'disposal', 'adjustment')
        AND public.fn_user_has_farm_role(farm_id, 'owner'))
      OR (movement_type = 'purchase_receipt'
        AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement']))
      OR (movement_type IN ('issue', 'return')
        AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor']))
    )
  );

CREATE INDEX idx_movements_batch ON public.stock_movements(batch_id);
CREATE INDEX idx_movements_product ON public.stock_movements(product_id);
CREATE INDEX idx_movements_farm ON public.stock_movements(farm_id);
CREATE INDEX idx_movements_date ON public.stock_movements(farm_id, movement_date);

-- ============================================================
-- VIEWS: CALCULATED STOCK BALANCES
-- ============================================================

-- Current calculated balance per batch from immutable ledger
CREATE OR REPLACE VIEW public.v_stock_balances AS
SELECT
  b.id AS batch_id,
  b.farm_id,
  b.product_id,
  b.batch_number,
  b.manufacturing_date,
  b.expiry_date,
  b.status AS batch_status,
  b.quantity_unit AS unit,
  b.storage_location,
  COALESCE(SUM(sm.quantity), 0) AS current_balance,
  p.trade_name,
  p.active_ingredient,
  p.category
FROM public.product_batches b
JOIN public.product_catalog p ON p.id = b.product_id
LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
GROUP BY
  b.id,
  b.farm_id,
  b.product_id,
  b.batch_number,
  b.manufacturing_date,
  b.expiry_date,
  b.status,
  b.quantity_unit,
  b.storage_location,
  p.trade_name,
  p.active_ingredient,
  p.category;

-- Usable stock per product (only available and unexpired batches with positive balance)
CREATE OR REPLACE VIEW public.v_usable_stock AS
SELECT
  product_id,
  farm_id,
  trade_name,
  category,
  unit,
  SUM(current_balance) AS total_usable_quantity,
  COUNT(batch_id) AS usable_batch_count
FROM public.v_stock_balances
WHERE batch_status = 'available'
  AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
  AND current_balance > 0
GROUP BY product_id, farm_id, trade_name, category, unit;

-- Expiring stock (within next 60 days)
CREATE OR REPLACE VIEW public.v_expiring_batches AS
SELECT
  batch_id,
  farm_id,
  product_id,
  trade_name,
  batch_number,
  expiry_date,
  current_balance,
  unit,
  expiry_date - CURRENT_DATE AS days_until_expiry
FROM public.v_stock_balances
WHERE expiry_date IS NOT NULL
  AND expiry_date >= CURRENT_DATE
  AND expiry_date <= CURRENT_DATE + INTERVAL '60 days'
  AND current_balance > 0
ORDER BY expiry_date ASC;

-- ============================================================
-- DATABASE FUNCTION: SECURE TRANSACTIONAL STOCK MOVEMENT
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_record_stock_movement(
  p_farm_id uuid,
  p_product_id uuid,
  p_batch_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit text,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_balance numeric;
  v_movement_id uuid;
  v_batch_unit text;
BEGIN
  -- 1. Check unit consistency with batch
  SELECT quantity_unit INTO v_batch_unit
  FROM public.product_batches
  WHERE id = p_batch_id AND farm_id = p_farm_id;

  IF v_batch_unit IS NULL THEN
    RAISE EXCEPTION 'Product batch not found or does not belong to farm';
  END IF;

  IF v_batch_unit != p_unit THEN
    RAISE EXCEPTION 'Unit mismatch: Batch is tracked in %, requested movement in %', v_batch_unit, p_unit;
  END IF;

  -- 2. Prevent negative stock on deduction operations
  IF p_movement_type IN ('issue', 'disposal') OR (p_movement_type = 'adjustment' AND p_quantity < 0) THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_current_balance
    FROM public.stock_movements
    WHERE batch_id = p_batch_id;

    IF v_current_balance + p_quantity < 0 THEN
      RAISE EXCEPTION 'Insufficient stock. Current batch balance is %, attempted deduction is %',
        v_current_balance, ABS(p_quantity);
    END IF;
  END IF;

  -- 3. Insert append-only movement
  INSERT INTO public.stock_movements (
    farm_id,
    product_id,
    batch_id,
    movement_type,
    quantity,
    unit,
    reference_type,
    reference_id,
    reason,
    performed_by
  )
  VALUES (
    p_farm_id,
    p_product_id,
    p_batch_id,
    p_movement_type,
    p_quantity,
    p_unit,
    p_reference_type,
    p_reference_id,
    p_reason,
    auth.uid()
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;
-- Migration: Procurement, Purchase Orders, and Demand Aggregation
-- Tables: purchase_orders, purchase_order_lines, goods_receipts
-- Views: v_procurement_demand, v_confirmed_incoming_stock

-- ============================================================
-- PURCHASE ORDERS
-- ============================================================

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'pending_approval',
      'approved',
      'ordered',
      'partially_received',
      'received',
      'cancelled'
    )
  ),
  total_amount numeric(14,2) DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  ordered_date date,
  expected_delivery_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, po_number)
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_select" ON public.purchase_orders
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "po_insert" ON public.purchase_orders
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

-- Procurement can edit drafts; only Owner can approve
CREATE POLICY "po_update" ON public.purchase_orders
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE TRIGGER set_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_po_farm ON public.purchase_orders(farm_id);
CREATE INDEX idx_po_status ON public.purchase_orders(farm_id, status);

-- ============================================================
-- PURCHASE ORDER LINES
-- ============================================================

CREATE TABLE public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.product_catalog(id),
  quantity_ordered numeric(12,4) NOT NULL,
  unit text NOT NULL,
  packages_ordered integer NOT NULL DEFAULT 1,
  package_size numeric(12,4) NOT NULL,
  unit_price numeric(14,2),
  total_price numeric(14,2),
  quantity_received numeric(12,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'partially_received', 'received', 'cancelled')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_lines_select" ON public.purchase_order_lines
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "po_lines_insert" ON public.purchase_order_lines
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE POLICY "po_lines_update" ON public.purchase_order_lines
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

CREATE TRIGGER set_purchase_order_lines_updated_at
  BEFORE UPDATE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_po_lines_order ON public.purchase_order_lines(purchase_order_id);
CREATE INDEX idx_po_lines_product ON public.purchase_order_lines(product_id);

-- ============================================================
-- GOODS RECEIPTS (PO Fulfillment Record)
-- ============================================================

CREATE TABLE public.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  purchase_order_id uuid REFERENCES public.purchase_orders(id),
  po_line_id uuid REFERENCES public.purchase_order_lines(id),
  product_id uuid NOT NULL REFERENCES public.product_catalog(id),
  batch_id uuid NOT NULL REFERENCES public.product_batches(id),
  quantity_received numeric(12,4) NOT NULL,
  unit text NOT NULL,
  received_by uuid NOT NULL REFERENCES public.profiles(id),
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  invoice_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goods_receipts_select" ON public.goods_receipts
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "goods_receipts_insert" ON public.goods_receipts
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

-- ============================================================
-- VIEWS: PROCUREMENT DEMAND & INCOMING STOCK
-- ============================================================

-- Aggregates upcoming approved treatments by product
CREATE OR REPLACE VIEW public.v_procurement_demand AS
SELECT
  tpl.product_id,
  tpl.farm_id,
  p.trade_name,
  p.category,
  p.stock_unit,
  p.standard_package_size,
  p.package_unit,
  COALESCE(SUM(tpl.approved_total_quantity), 0) AS total_planned_demand,
  COUNT(tpl.id) AS treatment_count,
  MIN(tpl.scheduled_date) AS earliest_treatment_date,
  MAX(tpl.scheduled_date) AS latest_treatment_date
FROM public.treatment_plan_lines tpl
JOIN public.product_catalog p ON p.id = tpl.product_id
WHERE tpl.status IN ('approved', 'pending_approval')
  AND tpl.scheduled_date >= CURRENT_DATE
GROUP BY
  tpl.product_id,
  tpl.farm_id,
  p.trade_name,
  p.category,
  p.stock_unit,
  p.standard_package_size,
  p.package_unit;

-- Aggregates confirmed incoming stock from ordered / partially received POs
CREATE OR REPLACE VIEW public.v_confirmed_incoming_stock AS
SELECT
  pol.product_id,
  pol.farm_id,
  pol.unit,
  COALESCE(SUM(pol.quantity_ordered - pol.quantity_received), 0) AS incoming_quantity
FROM public.purchase_order_lines pol
JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
WHERE po.status IN ('ordered', 'partially_received', 'approved')
  AND pol.status IN ('pending', 'partially_received')
GROUP BY pol.product_id, pol.farm_id, pol.unit;
-- Migration: Work Orders, Application Records, Checklists, Evidence & Equipment
-- Tables: work_orders, application_records, application_checklists, application_evidence, equipment, equipment_calibrations
-- Functions: fn_release_treatment_line, fn_complete_application

-- ============================================================
-- EQUIPMENT & SPRAYERS
-- ============================================================

CREATE TABLE public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  equipment_type text NOT NULL, -- e.g. 'Knapsack Sprayer', 'Battery Sprayer', 'HTP Power Sprayer', 'Drip System'
  name text NOT NULL,
  brand_model text,
  house_id uuid REFERENCES public.houses(id),
  purchase_date date,
  status text NOT NULL DEFAULT 'operational' CHECK (
    status IN ('operational', 'needs_maintenance', 'under_repair', 'retired')
  ),
  maintenance_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipment_select" ON public.equipment
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "equipment_insert" ON public.equipment
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor'])
  );

CREATE POLICY "equipment_update" ON public.equipment
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor'])
  );

CREATE TRIGGER set_equipment_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- WORK ORDERS (Generated from Released Treatment Lines)
-- ============================================================

CREATE TABLE public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  treatment_line_id uuid NOT NULL REFERENCES public.treatment_plan_lines(id) ON DELETE RESTRICT,
  house_id uuid NOT NULL REFERENCES public.houses(id),
  zone_id uuid REFERENCES public.zones(id),
  crop_cycle_id uuid REFERENCES public.crop_cycles(id),
  product_id uuid NOT NULL REFERENCES public.product_catalog(id),
  planned_date date NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  required_quantity numeric(12,4) NOT NULL,
  quantity_unit text NOT NULL,
  application_method text NOT NULL DEFAULT 'Foliar spray',
  water_volume numeric(12,4),
  water_volume_unit text DEFAULT 'L',
  safety_precautions text,
  phi_days integer,
  rei_hours numeric(6,2),
  equipment_requirements text,
  instructions_hindi text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'assigned', 'in_progress', 'completed', 'verified', 'rejected', 'cancelled')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Owner, Agronomist, Verifier see all; Supervisor sees assigned work orders
CREATE POLICY "work_orders_select" ON public.work_orders
  FOR SELECT USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'verifier'])
    OR (
      public.fn_user_has_farm_role(farm_id, 'supervisor')
      AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    )
  );

CREATE POLICY "work_orders_insert" ON public.work_orders
  FOR INSERT WITH CHECK (
    public.fn_user_has_farm_role(farm_id, 'owner')
  );

CREATE POLICY "work_orders_update" ON public.work_orders
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor', 'verifier'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor', 'verifier'])
  );

CREATE TRIGGER set_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_wo_farm ON public.work_orders(farm_id);
CREATE INDEX idx_wo_status ON public.work_orders(farm_id, status);
CREATE INDEX idx_wo_assigned ON public.work_orders(assigned_to);

-- ============================================================
-- APPLICATION RECORDS (Execution Log with Discrepancy Detection)
-- ============================================================

CREATE TABLE public.application_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES public.profiles(id),
  application_date date NOT NULL DEFAULT CURRENT_DATE,
  start_time timestamptz,
  end_time timestamptz,
  product_id uuid NOT NULL REFERENCES public.product_catalog(id),
  batch_id uuid NOT NULL REFERENCES public.product_batches(id),
  planned_quantity numeric(12,4) NOT NULL,
  actual_quantity numeric(12,4) NOT NULL,
  quantity_unit text NOT NULL,
  measuring_instrument text,
  water_quantity numeric(12,4),
  water_unit text DEFAULT 'L',
  equipment_id uuid REFERENCES public.equipment(id),
  tank_count integer,
  area_covered text,
  coverage_assessment text,
  stock_issued numeric(12,4) NOT NULL,
  stock_returned numeric(12,4) NOT NULL DEFAULT 0,
  notes text,
  deviations text,
  supervisor_signoff boolean NOT NULL DEFAULT true,
  supervisor_signoff_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (
    verification_status IN ('pending', 'verified', 'rejected')
  ),
  verified_by uuid REFERENCES public.profiles(id),
  verified_at timestamptz,
  verification_notes text,
  has_discrepancy boolean GENERATED ALWAYS AS (actual_quantity IS DISTINCT FROM planned_quantity) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_records_select" ON public.application_records
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "app_records_insert" ON public.application_records
  FOR INSERT WITH CHECK (
    operator_id = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor'])
  );

-- Only Verifier or Owner can update verification status
CREATE POLICY "app_records_update" ON public.application_records
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'verifier'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'verifier'])
  );

CREATE TRIGGER set_application_records_updated_at
  BEFORE UPDATE ON public.application_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_app_wo ON public.application_records(work_order_id);
CREATE INDEX idx_app_farm ON public.application_records(farm_id);
CREATE INDEX idx_app_verification ON public.application_records(farm_id, verification_status);

-- ============================================================
-- APPLICATION CHECKLISTS
-- ============================================================

CREATE TABLE public.application_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.application_records(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('pre_application', 'during_application', 'post_application')),
  item_key text NOT NULL,
  item_label text NOT NULL,
  is_checked boolean NOT NULL DEFAULT false,
  notes text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_checklists_select" ON public.application_checklists
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "app_checklists_insert" ON public.application_checklists
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'supervisor'])
  );

-- ============================================================
-- DATABASE FUNCTIONS
-- ============================================================

-- Function 1: Release approved treatment line to create Work Order
CREATE OR REPLACE FUNCTION public.fn_release_treatment_line(
  p_line_id uuid,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_line record;
  v_wo_id uuid;
  v_prod record;
BEGIN
  -- 1. Fetch line details
  SELECT * INTO v_line
  FROM public.treatment_plan_lines
  WHERE id = p_line_id;

  IF v_line IS NULL THEN
    RAISE EXCEPTION 'Treatment line item not found';
  END IF;

  IF v_line.status != 'approved' THEN
    RAISE EXCEPTION 'Only agronomist-approved treatment lines can be released into work orders. Current status: %', v_line.status;
  END IF;

  IF v_line.product_id IS NULL THEN
    RAISE EXCEPTION 'Cannot release line without a verified canonical product ID';
  END IF;

  -- 2. Validate product verification status
  SELECT * INTO v_prod
  FROM public.product_catalog
  WHERE id = v_line.product_id;

  IF v_prod.verification_status != 'verified' THEN
    RAISE EXCEPTION 'Agricultural Safety Rule: Product "%" identity is not verified. Unverified products cannot be released to supervisors.', v_prod.trade_name;
  END IF;

  IF v_line.approved_total_quantity IS NULL OR v_line.approved_total_quantity <= 0 THEN
    RAISE EXCEPTION 'Approved total quantity must be explicitly specified before release';
  END IF;

  -- 3. Create Work Order
  INSERT INTO public.work_orders (
    farm_id,
    treatment_line_id,
    house_id,
    zone_id,
    crop_cycle_id,
    product_id,
    planned_date,
    assigned_to,
    required_quantity,
    quantity_unit,
    application_method,
    water_volume,
    water_volume_unit,
    instructions_hindi,
    status
  )
  VALUES (
    v_line.farm_id,
    v_line.id,
    v_line.house_id,
    v_line.zone_id,
    v_line.crop_cycle_id,
    v_line.product_id,
    v_line.scheduled_date,
    p_assigned_to,
    v_line.approved_total_quantity,
    v_line.approved_quantity_unit,
    COALESCE(v_line.application_method, 'Foliar spray'),
    v_line.water_volume,
    COALESCE(v_line.water_volume_unit, 'L'),
    v_line.original_instruction,
    CASE WHEN p_assigned_to IS NOT NULL THEN 'assigned' ELSE 'pending' END
  )
  RETURNING id INTO v_wo_id;

  -- 4. Update Line status to released
  UPDATE public.treatment_plan_lines
  SET status = 'released'
  WHERE id = p_line_id;

  RETURN v_wo_id;
END;
$$;
-- Migration: Crop Health, Scouting Rounds, Observations & Response Tracking
-- Tables: scouting_rounds, crop_observations, crop_observation_attachments, follow_up_tasks
-- Views: v_unresolved_observations, v_overdue_followups

-- ============================================================
-- SCOUTING ROUNDS
-- ============================================================

CREATE TABLE public.scouting_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES public.houses(id),
  zone_id uuid REFERENCES public.zones(id),
  crop_cycle_id uuid REFERENCES public.crop_cycles(id),
  scouting_date date NOT NULL DEFAULT CURRENT_DATE,
  scouting_time time DEFAULT CURRENT_TIME,
  scout_id uuid NOT NULL REFERENCES public.profiles(id),
  growth_stage text,
  sampling_method text DEFAULT 'Zig-zag random sampling across 5 beds',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scouting_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scouting_rounds_select" ON public.scouting_rounds
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "scouting_rounds_insert" ON public.scouting_rounds
  FOR INSERT WITH CHECK (
    scout_id = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE POLICY "scouting_rounds_update" ON public.scouting_rounds
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE TRIGGER set_scouting_rounds_updated_at
  BEFORE UPDATE ON public.scouting_rounds
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_scouting_farm ON public.scouting_rounds(farm_id);
CREATE INDEX idx_scouting_date ON public.scouting_rounds(farm_id, scouting_date);

-- ============================================================
-- CROP OBSERVATIONS (Incidence, Severity & Response Tracking)
-- ============================================================

CREATE TABLE public.crop_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scouting_round_id uuid NOT NULL REFERENCES public.scouting_rounds(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  plants_checked integer NOT NULL CHECK (plants_checked >= 0),
  plants_affected integer NOT NULL DEFAULT 0 CHECK (plants_affected >= 0),
  
  -- Incidence Percentage computed with zero-division protection
  incidence_pct numeric(5,2) GENERATED ALWAYS AS (
    CASE 
      WHEN plants_checked > 0 THEN ROUND((plants_affected::numeric / plants_checked) * 100, 2)
      ELSE 0.00
    END
  ) STORED,
  
  symptoms text,
  suspected_issue text,
  diagnosis_status text NOT NULL DEFAULT 'suspected' CHECK (
    diagnosis_status IN ('suspected', 'confirmed', 'ruled_out')
  ),
  severity text NOT NULL DEFAULT 'low',
  severity_scale text DEFAULT '0-10',
  leaves_affected text,
  flower_condition text,
  fruit_condition text,
  pest_observations text,
  agronomist_assessment text,
  follow_up_date date,
  
  -- Linking to treatment for Before/After Response Verification
  linked_work_order_id uuid REFERENCES public.work_orders(id),
  response_vs_previous text CHECK (response_vs_previous IN ('improved', 'same', 'worsened')),
  
  is_escalated boolean NOT NULL DEFAULT false,
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crop_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crop_obs_select" ON public.crop_observations
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "crop_obs_insert" ON public.crop_observations
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE POLICY "crop_obs_update" ON public.crop_observations
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE TRIGGER set_crop_observations_updated_at
  BEFORE UPDATE ON public.crop_observations
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX idx_obs_farm ON public.crop_observations(farm_id);
CREATE INDEX idx_obs_unresolved ON public.crop_observations(farm_id) WHERE is_resolved = false;
CREATE INDEX idx_obs_escalated ON public.crop_observations(farm_id) WHERE is_escalated = true;

-- ============================================================
-- CROP OBSERVATION ATTACHMENTS (Photographic Evidence)
-- ============================================================

CREATE TABLE public.crop_observation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES public.crop_observations(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  caption text,
  observation_phase text NOT NULL DEFAULT 'general' CHECK (
    observation_phase IN ('before_treatment', 'after_treatment', 'general')
  ),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crop_observation_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obs_attachments_select" ON public.crop_observation_attachments
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "obs_attachments_insert" ON public.crop_observation_attachments
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

-- ============================================================
-- FOLLOW-UP TASKS
-- ============================================================

CREATE TABLE public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.crop_observations(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (
    task_type IN ('follow_up_assessment', 'agronomist_review', 'escalation', 'general')
  ),
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.profiles(id),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'in_progress', 'completed', 'cancelled')
  ),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_ups_select" ON public.follow_up_tasks
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

CREATE POLICY "follow_ups_insert" ON public.follow_up_tasks
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE POLICY "follow_ups_update" ON public.follow_up_tasks
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

CREATE TRIGGER set_follow_up_tasks_updated_at
  BEFORE UPDATE ON public.follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- VIEWS: UNRESOLVED ANOMALIES & OVERDUE FOLLOW-UPS
-- ============================================================

CREATE OR REPLACE VIEW public.v_unresolved_observations AS
SELECT
  co.id AS observation_id,
  co.farm_id,
  sr.house_id,
  h.name AS house_name,
  sr.crop_cycle_id,
  cc.crop_name,
  co.suspected_issue,
  co.symptoms,
  co.incidence_pct,
  co.severity,
  co.is_escalated,
  co.created_at AS observed_at
FROM public.crop_observations co
JOIN public.scouting_rounds sr ON sr.id = co.scouting_round_id
JOIN public.houses h ON h.id = sr.house_id
LEFT JOIN public.crop_cycles cc ON cc.id = sr.crop_cycle_id
WHERE co.is_resolved = false
ORDER BY co.is_escalated DESC, co.incidence_pct DESC;

CREATE OR REPLACE VIEW public.v_overdue_followups AS
SELECT
  fut.id AS task_id,
  fut.farm_id,
  fut.title,
  fut.due_date,
  fut.task_type,
  CURRENT_DATE - fut.due_date AS days_overdue,
  p.full_name AS assigned_to_name
FROM public.follow_up_tasks fut
LEFT JOIN public.profiles p ON p.id = fut.assigned_to
WHERE fut.status IN ('pending', 'in_progress')
  AND fut.due_date < CURRENT_DATE
ORDER BY fut.due_date ASC;

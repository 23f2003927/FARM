-- Migration: Farm structure (polyhouses, zones, crop cycles)
-- Tables: houses, zones, crop_cycles

-- ============================================================
-- HOUSES (Polyhouses)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.houses (
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

DROP POLICY IF EXISTS "houses_select" ON public.houses;
CREATE POLICY "houses_select" ON public.houses
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "houses_insert" ON public.houses;
CREATE POLICY "houses_insert" ON public.houses
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP POLICY IF EXISTS "houses_update" ON public.houses;
CREATE POLICY "houses_update" ON public.houses
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP TRIGGER IF EXISTS set_houses_updated_at ON public.houses;
CREATE TRIGGER set_houses_updated_at
  BEFORE UPDATE ON public.houses
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_houses_farm ON public.houses(farm_id);

-- ============================================================
-- ZONES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zones (
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

DROP POLICY IF EXISTS "zones_select" ON public.zones;
CREATE POLICY "zones_select" ON public.zones
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "zones_insert" ON public.zones;
CREATE POLICY "zones_insert" ON public.zones
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP POLICY IF EXISTS "zones_update" ON public.zones;
CREATE POLICY "zones_update" ON public.zones
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP TRIGGER IF EXISTS set_zones_updated_at ON public.zones;
CREATE TRIGGER set_zones_updated_at
  BEFORE UPDATE ON public.zones
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_zones_house ON public.zones(house_id);
CREATE INDEX IF NOT EXISTS idx_zones_farm ON public.zones(farm_id);

-- ============================================================
-- CROP CYCLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crop_cycles (
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

DROP POLICY IF EXISTS "crop_cycles_select" ON public.crop_cycles;
CREATE POLICY "crop_cycles_select" ON public.crop_cycles
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "crop_cycles_insert" ON public.crop_cycles;
CREATE POLICY "crop_cycles_insert" ON public.crop_cycles
  FOR INSERT WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP POLICY IF EXISTS "crop_cycles_update" ON public.crop_cycles;
CREATE POLICY "crop_cycles_update" ON public.crop_cycles
  FOR UPDATE USING (public.fn_user_has_farm_role(farm_id, 'owner'))
  WITH CHECK (public.fn_user_has_farm_role(farm_id, 'owner'));

DROP TRIGGER IF EXISTS set_crop_cycles_updated_at ON public.crop_cycles;
CREATE TRIGGER set_crop_cycles_updated_at
  BEFORE UPDATE ON public.crop_cycles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_crop_cycles_farm ON public.crop_cycles(farm_id);
CREATE INDEX IF NOT EXISTS idx_crop_cycles_house ON public.crop_cycles(house_id);
CREATE INDEX IF NOT EXISTS idx_crop_cycles_status ON public.crop_cycles(farm_id, status);

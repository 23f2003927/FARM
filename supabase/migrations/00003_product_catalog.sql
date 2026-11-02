-- Migration: Product Master Catalogue & Aliases
-- Tables: product_catalog, product_aliases, product_documents
-- Includes: RLS policies, triggers, indexes

-- ============================================================
-- PRODUCT CATALOGUE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_catalog (
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
DROP POLICY IF EXISTS "product_catalog_select" ON public.product_catalog;
CREATE POLICY "product_catalog_select" ON public.product_catalog
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

-- Owners and Agronomists can create products
DROP POLICY IF EXISTS "product_catalog_insert" ON public.product_catalog;
CREATE POLICY "product_catalog_insert" ON public.product_catalog
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

-- Owner can update unverified products; Agronomist can verify/update products
DROP POLICY IF EXISTS "product_catalog_update" ON public.product_catalog;
CREATE POLICY "product_catalog_update" ON public.product_catalog
  FOR UPDATE USING (
    (public.fn_user_has_farm_role(farm_id, 'owner') AND verification_status != 'verified')
    OR public.fn_user_has_farm_role(farm_id, 'agronomist')
  )
  WITH CHECK (
    (public.fn_user_has_farm_role(farm_id, 'owner') AND verification_status != 'verified')
    OR public.fn_user_has_farm_role(farm_id, 'agronomist')
  );

DROP TRIGGER IF EXISTS set_product_catalog_updated_at ON public.product_catalog;
CREATE TRIGGER set_product_catalog_updated_at
  BEFORE UPDATE ON public.product_catalog
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_products_farm ON public.product_catalog(farm_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.product_catalog(farm_id, category);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.product_catalog(farm_id, verification_status);

-- ============================================================
-- PRODUCT ALIASES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_aliases (
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

DROP POLICY IF EXISTS "product_aliases_select" ON public.product_aliases;
CREATE POLICY "product_aliases_select" ON public.product_aliases
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "product_aliases_insert" ON public.product_aliases;
CREATE POLICY "product_aliases_insert" ON public.product_aliases
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

DROP POLICY IF EXISTS "product_aliases_update" ON public.product_aliases;
CREATE POLICY "product_aliases_update" ON public.product_aliases
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

DROP POLICY IF EXISTS "product_aliases_delete" ON public.product_aliases;
CREATE POLICY "product_aliases_delete" ON public.product_aliases
  FOR DELETE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

CREATE INDEX IF NOT EXISTS idx_aliases_product ON public.product_aliases(product_id);
CREATE INDEX IF NOT EXISTS idx_aliases_farm_name ON public.product_aliases(farm_id, alias_name);

-- ============================================================
-- PRODUCT DOCUMENTS (Labels, Leaflets, SDS)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_documents (
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

DROP POLICY IF EXISTS "product_documents_select" ON public.product_documents;
CREATE POLICY "product_documents_select" ON public.product_documents
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "product_documents_insert" ON public.product_documents;
CREATE POLICY "product_documents_insert" ON public.product_documents
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

DROP POLICY IF EXISTS "product_documents_delete" ON public.product_documents;
CREATE POLICY "product_documents_delete" ON public.product_documents
  FOR DELETE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist'])
  );

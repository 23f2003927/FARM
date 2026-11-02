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

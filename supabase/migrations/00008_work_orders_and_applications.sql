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

-- Migration: Inventory Management, Batches & Append-Only Stock Movements
-- Tables: suppliers, product_batches, stock_movements
-- Views: v_stock_balances, v_usable_stock, v_expiring_batches
-- Functions: fn_record_stock_movement

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
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

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers;
CREATE POLICY "suppliers_insert" ON public.suppliers
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers;
CREATE POLICY "suppliers_update" ON public.suppliers
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

DROP TRIGGER IF EXISTS set_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER set_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- PRODUCT BATCHES (Lot Tracking & Expiry)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_batches (
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

DROP POLICY IF EXISTS "batches_select" ON public.product_batches;
CREATE POLICY "batches_select" ON public.product_batches
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "batches_insert" ON public.product_batches;
CREATE POLICY "batches_insert" ON public.product_batches
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

DROP POLICY IF EXISTS "batches_update" ON public.product_batches;
CREATE POLICY "batches_update" ON public.product_batches
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'procurement'])
  );

DROP TRIGGER IF EXISTS set_product_batches_updated_at ON public.product_batches;
CREATE TRIGGER set_product_batches_updated_at
  BEFORE UPDATE ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_batches_product ON public.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.product_batches(farm_id, expiry_date);

-- ============================================================
-- STOCK MOVEMENTS (APPEND-ONLY LEDGER)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stock_movements (
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

DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
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

CREATE INDEX IF NOT EXISTS idx_movements_batch ON public.stock_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_farm ON public.stock_movements(farm_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON public.stock_movements(farm_id, movement_date);

-- ============================================================
-- VIEWS: CALCULATED STOCK BALANCES
-- ============================================================

DROP VIEW IF EXISTS public.v_expiring_batches CASCADE;
DROP VIEW IF EXISTS public.v_usable_stock CASCADE;
DROP VIEW IF EXISTS public.v_stock_balances CASCADE;

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
  (expiry_date - CURRENT_DATE) AS days_until_expiry
FROM public.v_stock_balances
WHERE expiry_date IS NOT NULL
  AND expiry_date >= CURRENT_DATE
  AND expiry_date <= (CURRENT_DATE + 60)
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
  p_reason text DEFAULT NULL,
  p_performed_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_balance numeric;
  v_movement_id uuid;
  v_batch_unit text;
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(p_performed_by, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: neither p_performed_by nor auth.uid() provided';
  END IF;

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
    v_user_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

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

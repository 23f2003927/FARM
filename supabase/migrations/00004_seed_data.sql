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

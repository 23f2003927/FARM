import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MEASUREMENT_UNITS } from '@/types/enums'

export default async function NewTreatmentPlanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canCreate = memberships?.roles?.some((r: string) => ['owner', 'agronomist'].includes(r))
  if (!canCreate) {
    redirect('/dashboard/treatment-plans')
  }

  // Pre-load houses, crop cycles, and products for dropdowns
  const [{ data: houses }, { data: cycles }, { data: products }] = await Promise.all([
    supabase.from('houses').select('id, name').eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('crop_cycles').select('id, crop_name, variety, house_id').eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('product_catalog').select('id, trade_name, stock_unit, verification_status').eq('farm_id', farmId).eq('is_archived', false),
  ])

  // Server Action: Create Plan and Initial Line
  async function createPlan(formData: FormData) {
    'use server'
    const title = formData.get('title') as string
    const agronomistName = formData.get('agronomist_name') as string
    const startDate = formData.get('plan_start_date') as string
    const endDate = formData.get('plan_end_date') as string
    const description = formData.get('description') as string

    // Line 1 details
    const scheduledDate = formData.get('line_scheduled_date') as string
    const originalProductName = formData.get('line_original_name') as string
    const productId = (formData.get('line_product_id') as string) || null
    const houseId = (formData.get('line_house_id') as string) || null
    const cropCycleId = (formData.get('line_crop_cycle_id') as string) || null
    const targetIssue = formData.get('line_target_issue') as string
    const method = formData.get('line_method') as string
    const rateValue = formData.get('line_rate_value') ? parseFloat(formData.get('line_rate_value') as string) : null
    const rateUnit = formData.get('line_rate_unit') as string
    const rateBasis = formData.get('line_rate_basis') as string
    const approvedTotalQty = formData.get('line_total_qty') ? parseFloat(formData.get('line_total_qty') as string) : null
    const approvedUnit = formData.get('line_total_unit') as string
    const waterVolume = formData.get('line_water_volume') ? parseFloat(formData.get('line_water_volume') as string) : null
    const originalInstruction = formData.get('line_instruction') as string

    if (!title?.trim() || !scheduledDate) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    // 1. Insert Plan Header
    const { data: plan, error: planError } = await supabase
      .from('treatment_plans')
      .insert({
        farm_id: m.farm_id,
        title: title.trim(),
        agronomist_name: agronomistName?.trim() || null,
        plan_start_date: startDate || null,
        plan_end_date: endDate || null,
        description: description?.trim() || null,
        status: 'draft',
        created_by: user?.id,
      })
      .select('id')
      .single()

    if (planError || !plan) return

    // 2. Insert First Line
    await supabase.from('treatment_plan_lines').insert({
      farm_id: m.farm_id,
      plan_id: plan.id,
      line_number: 1,
      scheduled_date: scheduledDate,
      original_product_name: originalProductName?.trim() || null,
      product_id: productId || null,
      product_match_status: productId ? 'confirmed' : 'unmatched',
      house_id: houseId || null,
      crop_cycle_id: cropCycleId || null,
      target_issue: targetIssue?.trim() || null,
      application_method: method || 'Foliar spray',
      rate_value: rateValue,
      rate_unit: rateUnit || null,
      rate_basis: rateBasis || 'per_litre',
      approved_total_quantity: approvedTotalQty,
      approved_quantity_unit: approvedUnit || null,
      water_volume: waterVolume,
      water_volume_unit: waterVolume ? 'L' : null,
      original_instruction: originalInstruction?.trim() || null,
      status: 'draft',
    })

    redirect(`/dashboard/treatment-plans/${plan.id}`)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Create Treatment Plan"
        description="Convert agronomist visit notes into structured schedules with discrete treatment line items"
        actions={
          <Link
            href="/dashboard/treatment-plans"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Plans
          </Link>
        }
      />

      <form action={createPlan} className="space-y-8">
        {/* Plan Header Card */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
            1. Treatment Schedule Header
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Plan Title / Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="title"
                placeholder="e.g. 15-Day Preventive & Nutritional Schedule - November 2026"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Visiting Agronomist Name
              </label>
              <input
                type="text"
                name="agronomist_name"
                placeholder="e.g. Dr. Patil / Agronomist Sharma"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  name="plan_start_date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  name="plan_end_date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                General Visit Observations
              </label>
              <textarea
                name="description"
                rows={2}
                placeholder="e.g. Early symptoms of powdery mildew in Capsicum; high humidity in Polyhouse B."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
        </div>

        {/* First Line Item Card */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              2. Initial Treatment Instruction (Line 1)
            </h2>
            <span className="text-xs text-gray-400">You can add more lines after saving.</span>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Scheduled Application Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="line_scheduled_date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Target Polyhouse
                </label>
                <select
                  name="line_house_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Polyhouse</option>
                  {houses?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Target Crop Cycle
                </label>
                <select
                  name="line_crop_cycle_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Crop Cycle</option>
                  {cycles?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.crop_name} {c.variety ? `(${c.variety})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Product Matching */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Handwritten / Transcribed Product Name
                </label>
                <input
                  type="text"
                  name="line_original_name"
                  placeholder="Exact spelling from notes (e.g. Confidor, Ridomil)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Match with Canonical Product Catalogue
                </label>
                <select
                  name="line_product_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium text-gray-800 outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">-- Match Later (Unmatched) --</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.trade_name} ({p.stock_unit}) {p.verification_status === 'verified' ? '✓' : '⚠️ Unverified'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Application Method & Target */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Target Pest / Disease / Deficiency
                </label>
                <input
                  type="text"
                  name="line_target_issue"
                  placeholder="e.g. Thrips, Downy Mildew, Nitrogen Deficiency"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Application Method
                </label>
                <select
                  name="line_method"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="Foliar spray">Foliar spray</option>
                  <option value="Drip fertigation">Drip fertigation</option>
                  <option value="Soil drench">Soil drench</option>
                  <option value="Root dipping">Root dipping</option>
                  <option value="Fogging / Fumigation">Fogging / Fumigation</option>
                </select>
              </div>
            </div>

            {/* Rate vs Total Quantity */}
            <div className="bg-gray-50/70 p-4 rounded-lg border border-gray-200 mt-2 space-y-3">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                Dosage & Carrier Calculation (Agricultural Safety)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Application Rate (Dose)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      name="line_rate_value"
                      placeholder="e.g. 2, 0.5"
                      className="w-2/3 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <select
                      name="line_rate_unit"
                      className="w-1/3 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                    >
                      <option value="ml">ml</option>
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Rate Basis
                  </label>
                  <select
                    name="line_rate_basis"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="per_litre">Per Litre of Water</option>
                    <option value="per_tank">Per Tank (16L/20L)</option>
                    <option value="per_plant">Per Plant</option>
                    <option value="per_area">Per Acre / 1000 sqm</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Total Carrier Water Volume (L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="line_water_volume"
                    placeholder="e.g. 200, 400"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200/60 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Approved Total Product Quantity
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      name="line_total_qty"
                      placeholder="e.g. 400"
                      className="w-2/3 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-mono font-bold outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <select
                      name="line_total_unit"
                      className="w-1/3 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-mono outline-none focus:ring-1 focus:ring-green-500"
                    >
                      {Object.values(MEASUREMENT_UNITS).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[10px] text-gray-500 mt-0.5 block">
                    Must be total chemical issued from stock (not rate per litre).
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Original Handwritten Instruction Text
                  </label>
                  <input
                    type="text"
                    name="line_instruction"
                    placeholder="e.g. Spray in evening after 4 PM, focus on leaf underside"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pb-8">
          <Link
            href="/dashboard/treatment-plans"
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
          >
            Create Plan & Line 1
          </button>
        </div>
      </form>
    </div>
  )
}

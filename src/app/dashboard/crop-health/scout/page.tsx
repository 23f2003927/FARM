import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function NewScoutingRoundPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canScout = memberships?.roles?.some((r: string) => ['owner', 'agronomist', 'supervisor'].includes(r))
  if (!canScout) {
    redirect('/dashboard/crop-health')
  }

  const [{ data: houses }, { data: cycles }, { data: completedWorkOrders }] = await Promise.all([
    supabase.from('houses').select('id, name').eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('crop_cycles').select('id, crop_name, variety, house_id').eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('work_orders').select('id, planned_date, product_catalog(trade_name), houses(name)').eq('farm_id', farmId).eq('status', 'completed'),
  ])

  // Server Action: Create Scouting Round and First Observation
  async function createScoutingRound(formData: FormData) {
    'use server'
    const houseId = formData.get('house_id') as string
    const cropCycleId = (formData.get('crop_cycle_id') as string) || null
    const samplingMethod = formData.get('sampling_method') as string
    const growthStage = formData.get('growth_stage') as string

    // Observation details
    const plantsChecked = formData.get('plants_checked') ? parseInt(formData.get('plants_checked') as string) : 0
    const plantsAffected = formData.get('plants_affected') ? parseInt(formData.get('plants_affected') as string) : 0
    const suspectedIssue = formData.get('suspected_issue') as string
    const symptoms = formData.get('symptoms') as string
    const severity = formData.get('severity') as string
    const linkedWoId = (formData.get('linked_wo_id') as string) || null
    const responseVsPrev = (formData.get('response_vs_previous') as string) || null
    const isEscalated = formData.get('is_escalated') === 'on'

    if (!houseId || plantsChecked < 0) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    // 1. Create Scouting Round
    const { data: round, error: roundError } = await supabase
      .from('scouting_rounds')
      .insert({
        farm_id: m.farm_id,
        house_id: houseId,
        crop_cycle_id: cropCycleId,
        scout_id: user?.id,
        sampling_method: samplingMethod?.trim() || 'Random sampling',
        growth_stage: growthStage || 'Vegetative',
      })
      .select('id')
      .single()

    if (roundError || !round) return

    // 2. Insert Observation (Incidence % is auto-generated in DB)
    await supabase.from('crop_observations').insert({
      farm_id: m.farm_id,
      scouting_round_id: round.id,
      plants_checked: plantsChecked,
      plants_affected: plantsAffected,
      suspected_issue: suspectedIssue?.trim() || null,
      symptoms: symptoms?.trim() || null,
      severity: severity || 'low',
      linked_work_order_id: linkedWoId,
      response_vs_previous: responseVsPrev,
      is_escalated: isEscalated,
      is_resolved: false,
    })

    redirect('/dashboard/crop-health')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Record Crop Scouting Round"
        description="Inspect polyhouse beds, measure pest/disease incidence, and evaluate response to previous treatments"
        actions={
          <Link
            href="/dashboard/crop-health"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Crop Health
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
        <form action={createScoutingRound} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Polyhouse <span className="text-red-500">*</span>
              </label>
              <select
                name="house_id"
                required
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
                Crop Cycle
              </label>
              <select
                name="crop_cycle_id"
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

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Growth Stage
              </label>
              <select
                name="growth_stage"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="Transplanting">Transplanting</option>
                <option value="Vegetative">Vegetative</option>
                <option value="Flowering">Flowering</option>
                <option value="Fruit Setting">Fruit Setting</option>
                <option value="Harvesting">Harvesting</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Sampling Method / Protocol
            </label>
            <input
              type="text"
              name="sampling_method"
              defaultValue="Zig-zag inspection across 5 beds, 20 plants per bed"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Plant Count & Automated Incidence */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
              Observation & Incidence Metric
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Plants Checked (Sample Size) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="1"
                  name="plants_checked"
                  placeholder="e.g. 50, 100"
                  required
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-green-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Plants Affected (Showing Symptoms)
                </label>
                <input
                  type="number"
                  step="1"
                  name="plants_affected"
                  defaultValue="0"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-green-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Severity Rating
                </label>
                <select
                  name="severity"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="low">Low (Trace / isolated spots)</option>
                  <option value="moderate">Moderate (Noticeable spread)</option>
                  <option value="high">High (Extensive yellowing / damage)</option>
                  <option value="critical">Critical (Immediate crop loss risk)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Suspected Issue / Disease / Deficiency
                </label>
                <input
                  type="text"
                  name="suspected_issue"
                  placeholder="e.g. Thrips, Late Blight, Phosphorus Deficiency"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Observed Symptoms
                </label>
                <input
                  type="text"
                  name="symptoms"
                  placeholder="e.g. Upward leaf curling, silvery streaks on underside"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Before/After Treatment Response Tracking */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
              Treatment Efficacy & Response Tracking
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Link to Previous Treatment Work Order
                </label>
                <select
                  name="linked_wo_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">None (Routine General Scouting)</option>
                  {completedWorkOrders?.map((wo) => {
                    const prod = Array.isArray(wo.product_catalog) ? wo.product_catalog[0] : wo.product_catalog
                    const house = Array.isArray(wo.houses) ? wo.houses[0] : wo.houses
                    return (
                      <option key={wo.id} value={wo.id}>
                        {prod?.trade_name || 'Treatment'} on {new Date(wo.planned_date).toLocaleDateString('en-IN')} ({house?.name || 'House'})
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Observed Response vs Previous Condition
                </label>
                <select
                  name="response_vs_previous"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Not Applicable / First Observation</option>
                  <option value="improved">Improved (Disease arrested / new healthy growth)</option>
                  <option value="same">Same (No change observed)</option>
                  <option value="worsened">Worsened (Symptoms expanded / spread to new plants)</option>
                </select>
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded cursor-pointer text-xs text-red-900">
                <input type="checkbox" name="is_escalated" className="rounded text-red-600 focus:ring-red-500" />
                <span className="font-semibold">
                  Escalate this issue immediately to Agronomist (Flags on Dashboard)
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link
              href="/dashboard/crop-health"
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              Save Scouting Round
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

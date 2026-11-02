import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { MEASUREMENT_UNITS } from '@/types/enums'

export default async function TreatmentPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const roles = (memberships?.roles || []) as string[]
  const isAgronomist = roles.includes('agronomist')
  const isOwner = roles.includes('owner')

  const [{ data: plan }, { data: lines }, { data: products }, { data: houses }, { data: cycles }] = await Promise.all([
    supabase
      .from('treatment_plans')
      .select('*, profiles!created_by(full_name)')
      .eq('id', id)
      .eq('farm_id', farmId)
      .single(),
    supabase
      .from('treatment_plan_lines')
      .select('*, product_catalog(*), houses(*), crop_cycles(*), zones(*)')
      .eq('plan_id', id)
      .eq('farm_id', farmId)
      .order('line_number', { ascending: true }),
    supabase
      .from('product_catalog')
      .select('id, trade_name, stock_unit, verification_status')
      .eq('farm_id', farmId)
      .eq('is_archived', false),
    supabase.from('houses').select('id, name').eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('crop_cycles').select('id, crop_name, variety').eq('farm_id', farmId).eq('status', 'active'),
  ])

  if (!plan) {
    notFound()
  }

  // Server Action: Submit Plan for Approval
  async function submitForApproval() {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && (m.roles.includes('owner') || m.roles.includes('agronomist'))) {
      await supabase
        .from('treatment_plans')
        .update({ status: 'pending_approval' })
        .eq('id', id)
        .eq('farm_id', m.farm_id)

      await supabase
        .from('treatment_plan_lines')
        .update({ status: 'pending_approval' })
        .eq('plan_id', id)
        .eq('farm_id', m.farm_id)
        .eq('status', 'draft')

      revalidatePath(`/dashboard/treatment-plans/${id}`)
    }
  }

  // Server Action: Agronomist approves specific line
  async function approveLine(formData: FormData) {
    'use server'
    const lineId = formData.get('line_id') as string
    if (!lineId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('agronomist')) {
      await supabase
        .from('treatment_plan_lines')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', lineId)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/treatment-plans/${id}`)
    }
  }

  // Server Action: Agronomist flags line for clarification
  async function requestClarification(formData: FormData) {
    'use server'
    const lineId = formData.get('line_id') as string
    const notes = formData.get('clarification_notes') as string
    if (!lineId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('agronomist')) {
      await supabase
        .from('treatment_plan_lines')
        .update({
          status: 'needs_clarification',
          clarification_notes: notes?.trim() || 'Missing critical dosage or active ingredient verification',
        })
        .eq('id', lineId)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/treatment-plans/${id}`)
    }
  }

  // Server Action: Add another line
  async function addLine(formData: FormData) {
    'use server'
    const scheduledDate = formData.get('line_scheduled_date') as string
    const originalProductName = formData.get('line_original_name') as string
    const productId = (formData.get('line_product_id') as string) || null
    const houseId = (formData.get('line_house_id') as string) || null
    const cropCycleId = (formData.get('line_crop_cycle_id') as string) || null
    const targetIssue = formData.get('line_target_issue') as string
    const method = formData.get('line_method') as string
    const rateValue = formData.get('line_rate_value') ? parseFloat(formData.get('line_rate_value') as string) : null
    const rateUnit = formData.get('line_rate_unit') as string
    const approvedTotalQty = formData.get('line_total_qty') ? parseFloat(formData.get('line_total_qty') as string) : null
    const approvedUnit = formData.get('line_total_unit') as string
    const waterVolume = formData.get('line_water_volume') ? parseFloat(formData.get('line_water_volume') as string) : null
    const instruction = formData.get('line_instruction') as string

    if (!scheduledDate) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && (m.roles.includes('owner') || m.roles.includes('agronomist'))) {
      const nextLineNumber = (lines?.length || 0) + 1

      await supabase.from('treatment_plan_lines').insert({
        farm_id: m.farm_id,
        plan_id: id,
        line_number: nextLineNumber,
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
        rate_basis: 'per_litre',
        approved_total_quantity: approvedTotalQty,
        approved_quantity_unit: approvedUnit || null,
        water_volume: waterVolume,
        water_volume_unit: waterVolume ? 'L' : null,
        original_instruction: instruction?.trim() || null,
        status: 'draft',
      })

      revalidatePath(`/dashboard/treatment-plans/${id}`)
    }
  }

  // Count lines by approval status
  const pendingCount = lines?.filter((l) => l.status === 'pending_approval').length || 0
  const approvedCount = lines?.filter((l) => l.status === 'approved').length || 0
  const clarificationCount = lines?.filter((l) => l.status === 'needs_clarification').length || 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={plan.title}
        description={`Agronomist: ${plan.agronomist_name || 'N/A'} | Status: ${plan.status.toUpperCase()}`}
        actions={
          <div className="flex gap-2">
            <Link
              href="/dashboard/treatment-plans"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
            >
              ← Plans List
            </Link>
            {isOwner && plan.status === 'draft' && (
              <form action={submitForApproval}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold rounded-md shadow-xs transition-colors"
                >
                  Submit for Agronomist Approval
                </button>
              </form>
            )}
          </div>
        }
      />

      {/* Plan Status Banner */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-gray-400 block">Schedule Period</span>
            <span className="font-semibold text-gray-800">
              {plan.plan_start_date ? new Date(plan.plan_start_date).toLocaleDateString('en-IN') : 'Unset'} to{' '}
              {plan.plan_end_date ? new Date(plan.plan_end_date).toLocaleDateString('en-IN') : 'Unset'}
            </span>
          </div>
          <div>
            <span className="text-gray-400 block">Approved Lines</span>
            <span className="font-bold text-emerald-700 font-mono text-sm">
              {approvedCount} / {lines?.length || 0}
            </span>
          </div>
          {clarificationCount > 0 && (
            <div>
              <span className="text-orange-500 font-bold block">Needs Clarification</span>
              <span className="font-bold text-orange-700 font-mono text-sm">{clarificationCount}</span>
            </div>
          )}
        </div>

        <StatusBadge status={plan.status} />
      </div>

      {/* Treatment Line Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">
            Prescribed Treatment Instructions ({lines?.length || 0})
          </h2>
          <span className="text-xs text-gray-500">Each line enforces discrete approval & work order release</span>
        </div>

        {!lines || lines.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
            <p className="font-medium text-gray-700">No treatment lines in this plan.</p>
          </div>
        ) : (
          lines.map((line) => {
            const isLineApproved = line.status === 'approved'
            const isLineClarification = line.status === 'needs_clarification'
            const hasMatchedProduct = !!line.product_catalog

            return (
              <div
                key={line.id}
                className={`bg-white border rounded-lg shadow-xs overflow-hidden transition-all ${
                  isLineApproved
                    ? 'border-emerald-300 ring-1 ring-emerald-100'
                    : isLineClarification
                    ? 'border-orange-300 bg-orange-50/20'
                    : 'border-gray-200'
                }`}
              >
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/60">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-mono text-xs font-bold">
                      {line.line_number}
                    </span>
                    <div>
                      <span className="font-bold text-sm text-gray-900">
                        {line.product_catalog ? line.product_catalog.trade_name : line.original_product_name || 'Unspecified Product'}
                      </span>
                      {line.target_issue && (
                        <span className="text-xs text-gray-500 ml-2">Target: <strong>{line.target_issue}</strong></span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">
                      Date: {new Date(line.scheduled_date).toLocaleDateString('en-IN')}
                    </span>
                    <StatusBadge status={line.status} />
                  </div>
                </div>

                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Polyhouse & Crop</span>
                    <span className="text-gray-900 font-semibold mt-0.5 block">
                      {line.houses?.name || 'Unassigned House'}
                    </span>
                    <span className="text-gray-500 text-[11px] block">
                      {line.crop_cycles ? `${line.crop_cycles.crop_name} (${line.crop_cycles.variety || ''})` : ''}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-400 block font-medium">Application Method</span>
                    <span className="text-gray-800 font-medium mt-0.5 block">{line.application_method || 'Foliar spray'}</span>
                    {line.water_volume && (
                      <span className="text-gray-500 text-[11px] font-mono block">Carrier: {line.water_volume} L Water</span>
                    )}
                  </div>

                  <div>
                    <span className="text-gray-400 block font-medium">Dosage / Rate</span>
                    <span className="text-gray-800 font-mono mt-0.5 block">
                      {line.rate_value ? `${line.rate_value} ${line.rate_unit || ''} / L` : 'Not specified'}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-400 block font-medium">Approved Total Quantity</span>
                    <span className="font-bold text-sm text-emerald-700 font-mono mt-0.5 block">
                      {line.approved_total_quantity ? `${line.approved_total_quantity} ${line.approved_quantity_unit || ''}` : 'Pending Calc'}
                    </span>
                  </div>

                  {line.original_instruction && (
                    <div className="sm:col-span-4 pt-2 border-t border-gray-100 text-gray-600">
                      <span className="text-gray-400 font-medium">Agronomist Instruction: </span>
                      <span className="italic">{line.original_instruction}</span>
                    </div>
                  )}

                  {line.clarification_notes && (
                    <div className="sm:col-span-4 p-2 bg-orange-100/60 border border-orange-200 rounded text-orange-900">
                      <strong>Clarification Required:</strong> {line.clarification_notes}
                    </div>
                  )}
                </div>

                {/* Agronomist Actions Bar */}
                {isAgronomist && line.status !== 'approved' && line.status !== 'released' && (
                  <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
                    <form action={requestClarification} className="flex gap-2">
                      <input type="hidden" name="line_id" value={line.id} />
                      <input
                        type="text"
                        name="clarification_notes"
                        placeholder="Reason for clarification..."
                        className="px-2 py-1 text-xs border border-gray-300 rounded bg-white outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1 bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-semibold rounded transition-colors"
                      >
                        Request Clarification
                      </button>
                    </form>

                    <form action={approveLine}>
                      <input type="hidden" name="line_id" value={line.id} />
                      <button
                        type="submit"
                        className="px-4 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs transition-colors"
                      >
                        ✓ Approve Line
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Add Line Form (if draft or owner/agronomist) */}
      {(isOwner || isAgronomist) && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
          <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
            + Add Another Treatment Line Item
          </h3>

          <form action={addLine} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Scheduled Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="line_scheduled_date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Product from Catalogue
                </label>
                <select
                  name="line_product_id"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Select Product</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.trade_name} ({p.stock_unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Polyhouse
                </label>
                <select
                  name="line_house_id"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
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
                  name="line_crop_cycle_id"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Select Crop</option>
                  {cycles?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.crop_name} {c.variety ? `(${c.variety})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Target Pest / Disease
                </label>
                <input
                  type="text"
                  name="line_target_issue"
                  placeholder="e.g. Powdery Mildew, Mites"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Rate (Dose / L)
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.0001"
                    name="line_rate_value"
                    placeholder="e.g. 2.0"
                    className="w-2/3 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <select
                    name="line_rate_unit"
                    className="w-1/3 px-1 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="ml">ml</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Water Volume (L)
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="line_water_volume"
                  placeholder="e.g. 200"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-800 mb-1">
                  Approved Total Qty
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.0001"
                    name="line_total_qty"
                    placeholder="e.g. 400"
                    className="w-2/3 px-2 py-1.5 border border-gray-300 rounded text-xs font-bold font-mono outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <select
                    name="line_total_unit"
                    className="w-1/3 px-1 py-1.5 border border-gray-300 rounded text-xs bg-white font-mono outline-none focus:ring-1 focus:ring-green-500"
                  >
                    {Object.values(MEASUREMENT_UNITS).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded transition-colors"
              >
                + Append Line Item
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}


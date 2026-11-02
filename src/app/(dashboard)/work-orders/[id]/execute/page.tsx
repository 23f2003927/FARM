import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ExecuteWorkOrderPage({
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

  const [{ data: wo }, { data: batches }, { data: equipmentList }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*, product_catalog(*), houses(*), crop_cycles(*)')
      .eq('id', id)
      .eq('farm_id', farmId)
      .single(),
    // FEFO: available batches with balance
    supabase
      .from('v_stock_balances')
      .select('*')
      .eq('farm_id', farmId)
      .eq('batch_status', 'available')
      .gt('current_balance', 0)
      .order('expiry_date', { ascending: true }),
    supabase
      .from('equipment')
      .select('id, name, equipment_type')
      .eq('farm_id', farmId)
      .eq('status', 'operational'),
  ])

  if (!wo) {
    notFound()
  }

  // Filter batches for this work order's product
  const relevantBatches = batches?.filter((b) => b.product_id === wo.product_id) || []

  // Server Action: Submit Application Execution Record
  async function submitExecution(formData: FormData) {
    'use server'
    const batchId = formData.get('batch_id') as string
    const actualQty = formData.get('actual_quantity') ? parseFloat(formData.get('actual_quantity') as string) : null
    const stockIssued = formData.get('stock_issued') ? parseFloat(formData.get('stock_issued') as string) : null
    const stockReturned = formData.get('stock_returned') ? parseFloat(formData.get('stock_returned') as string) : 0
    const equipmentId = (formData.get('equipment_id') as string) || null
    const instrument = formData.get('measuring_instrument') as string
    const waterQty = formData.get('water_quantity') ? parseFloat(formData.get('water_quantity') as string) : null
    const tankCount = formData.get('tank_count') ? parseInt(formData.get('tank_count') as string) : 1
    const areaCovered = formData.get('area_covered') as string
    const notes = formData.get('notes') as string
    const deviations = formData.get('deviations') as string

    if (!batchId || actualQty === null || stockIssued === null) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    // 1. Record stock issue (negative quantity)
    await supabase.rpc('fn_record_stock_movement', {
      p_farm_id: m.farm_id,
      p_product_id: wo.product_id,
      p_batch_id: batchId,
      p_movement_type: 'issue',
      p_quantity: -Math.abs(stockIssued),
      p_unit: wo.quantity_unit,
      p_reference_type: 'work_order',
      p_reference_id: id,
      p_reason: `Issued to Work Order ${wo.id}`,
    })

    // 2. Record stock return if any (positive quantity)
    if (stockReturned > 0) {
      await supabase.rpc('fn_record_stock_movement', {
        p_farm_id: m.farm_id,
        p_product_id: wo.product_id,
        p_batch_id: batchId,
        p_movement_type: 'return',
        p_quantity: Math.abs(stockReturned),
        p_unit: wo.quantity_unit,
        p_reference_type: 'work_order',
        p_reference_id: id,
        p_reason: `Returned unused from Work Order ${wo.id}`,
      })
    }

    // 3. Create Application Record
    await supabase.from('application_records').insert({
      farm_id: m.farm_id,
      work_order_id: id,
      operator_id: user?.id,
      product_id: wo.product_id,
      batch_id: batchId,
      planned_quantity: wo.required_quantity,
      actual_quantity: actualQty,
      quantity_unit: wo.quantity_unit,
      measuring_instrument: instrument?.trim() || null,
      water_quantity: waterQty,
      equipment_id: equipmentId,
      tank_count: tankCount,
      area_covered: areaCovered?.trim() || null,
      stock_issued: stockIssued,
      stock_returned: stockReturned,
      notes: notes?.trim() || null,
      deviations: deviations?.trim() || null,
      supervisor_signoff: true,
      verification_status: 'pending',
    })

    // 4. Update Work Order status to completed
    await supabase
      .from('work_orders')
      .update({ status: 'completed' })
      .eq('id', id)
      .eq('farm_id', m.farm_id)

    redirect('/dashboard/applications')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <PageHeader
        title="Execute Application Work Order"
        description="Record exact measurements, select physical batch, and reconcile inventory ledger"
        actions={
          <Link
            href="/dashboard/work-orders"
            className="px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 rounded font-medium"
          >
            ← Cancel
          </Link>
        }
      />

      {/* Target Spec Summary Banner */}
      <div className="bg-white border-2 border-green-600 rounded-xl p-5 shadow-xs">
        <span className="text-xs font-bold uppercase tracking-wider text-green-700 block mb-1">
          Approved Target Instruction
        </span>
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-gray-100 pb-3 mb-3">
          <h2 className="text-xl font-extrabold text-gray-900">
            {wo.product_catalog?.trade_name}
          </h2>
          <span className="font-mono text-base font-bold text-emerald-800">
            Planned Qty: {wo.required_quantity} {wo.quantity_unit}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-gray-400 block">Polyhouse</span>
            <span className="font-semibold text-gray-900">{wo.houses?.name}</span>
          </div>
          <div>
            <span className="text-gray-400 block">Water Volume</span>
            <span className="font-semibold text-gray-900 font-mono">{wo.water_volume ? `${wo.water_volume} L` : 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-400 block">Method</span>
            <span className="font-semibold text-gray-900">{wo.application_method}</span>
          </div>
        </div>
      </div>

      <form action={submitExecution} className="space-y-6">
        {/* Step 1: Pre-Application Safety Checklist */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">
            1. Pre-Application Checklist (सुरक्षा और उपकरण जांच)
          </h3>
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-gray-100 cursor-pointer">
              <input type="checkbox" required className="rounded text-green-600" />
              <span>Correct product trade name and concentration confirmed against bottle label</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-gray-100 cursor-pointer">
              <input type="checkbox" required className="rounded text-green-600" />
              <span>Personal Protective Equipment (PPE: Mask, Gloves, Apron) worn by operator</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-gray-100 cursor-pointer">
              <input type="checkbox" required className="rounded text-green-600" />
              <span>Sprayer tank clean, no chemical residue, nozzle and filter inspected for leaks</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-gray-100 cursor-pointer">
              <input type="checkbox" required className="rounded text-green-600" />
              <span>Polyhouse ventilation/curtain conditions reviewed according to label safety</span>
            </label>
          </div>
        </div>

        {/* Step 2: Batch Selection (FEFO) */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">
            2. Physical Batch Selection (FEFO Recommended)
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Select the exact batch lot number being removed from the chemical store.
          </p>

          {relevantBatches.length === 0 ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800">
              ⚠️ Warning: No usable stock available in inventory for this product. Record a goods receipt first.
            </div>
          ) : (
            <div className="space-y-2">
              {relevantBatches.map((b, idx) => (
                <label
                  key={b.batch_id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-green-600 cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="batch_id"
                      value={b.batch_id}
                      defaultChecked={idx === 0}
                      required
                      className="text-green-600"
                    />
                    <div>
                      <span className="font-bold text-gray-900 font-mono text-sm block">
                        Batch: {b.batch_number}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Location: {b.storage_location || 'General Store'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono font-bold text-emerald-800 block">
                      Balance: {b.current_balance} {b.unit}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono block">
                      Expiry: {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString('en-IN') : 'None'}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Step 3: Exact Measurements & Stock Reconciliation */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">
            3. Actual Measurements & Stock Reconciliation
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Stock Issued from Store <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                name="stock_issued"
                defaultValue={wo.required_quantity}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-[10px] text-gray-400 mt-0.5 block">Quantity physically taken</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-green-900 mb-1">
                Actual Measured / Applied <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                name="actual_quantity"
                defaultValue={wo.required_quantity}
                required
                className="w-full px-3 py-2 border-2 border-green-600 rounded-md text-sm font-mono font-extrabold outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-[10px] text-gray-400 mt-0.5 block">Amount put in water tank</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Unused Stock Returned
              </label>
              <input
                type="number"
                step="0.0001"
                name="stock_returned"
                defaultValue="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-[10px] text-gray-400 mt-0.5 block">Returned back to storage</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Measuring Instrument
              </label>
              <input
                type="text"
                name="measuring_instrument"
                placeholder="e.g. 50ml Measuring cylinder"
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Equipment Used
              </label>
              <select
                name="equipment_id"
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="">Select Sprayer</option>
                {equipmentList?.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.equipment_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Number of Tanks / Passes
              </label>
              <input
                type="number"
                step="1"
                name="tank_count"
                defaultValue="1"
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Area / Rows Covered
              </label>
              <input
                type="text"
                name="area_covered"
                placeholder="e.g. Rows 1 to 20, Complete House"
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Water Carrier Quantity (L)
              </label>
              <input
                type="number"
                step="0.01"
                name="water_quantity"
                defaultValue={wo.water_volume || ''}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Deviations or Anomalies Observed
            </label>
            <input
              type="text"
              name="deviations"
              placeholder="e.g. Sprayed 10% less due to early rain; nozzle clogged during 3rd row"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition-colors"
        >
          ✓ Complete Work Order & Reconcile Stock
        </button>
      </form>
    </div>
  )
}

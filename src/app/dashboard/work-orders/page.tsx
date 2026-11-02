import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
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
  const isOwner = roles.includes('owner')
  const isSupervisor = roles.includes('supervisor')

  let query = supabase
    .from('work_orders')
    .select('*, product_catalog(trade_name, concentration), houses(name), crop_cycles(crop_name), profiles!assigned_to(full_name)')
    .eq('farm_id', farmId)
    .order('planned_date', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const [{ data: workOrders }, { data: approvedLines }, { data: supervisors }] = await Promise.all([
    query,
    // Approved lines waiting for work order release
    supabase
      .from('treatment_plan_lines')
      .select('*, product_catalog(trade_name), houses(name)')
      .eq('farm_id', farmId)
      .eq('status', 'approved'),
    // Eligible supervisors
    supabase
      .from('farm_memberships')
      .select('user_id, profiles(full_name)')
      .eq('farm_id', farmId)
      .contains('roles', ['supervisor']),
  ])

  // Server Action: Release approved line to Work Order
  async function releaseLine(formData: FormData) {
    'use server'
    const lineId = formData.get('line_id') as string
    const supervisorId = (formData.get('assigned_to') as string) || null

    if (!lineId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('owner')) {
      await supabase.rpc('fn_release_treatment_line', {
        p_line_id: lineId,
        p_assigned_to: supervisorId || null,
      })

      revalidatePath('/dashboard/work-orders')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application Work Orders"
        description="Every released treatment generates an immutable work order with exact chemical and measurement instructions"
        actions={
          isSupervisor && (
            <Link
              href="/dashboard/work-orders/supervisor"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-md shadow-xs transition-colors"
            >
              📱 Supervisor Mobile View
            </Link>
          )
        }
      />

      {/* Release Ready Banner for Owner */}
      {isOwner && approvedLines && approvedLines.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-emerald-950">
                {approvedLines.length} Approved Treatment Line{approvedLines.length === 1 ? '' : 's'} Ready for Release
              </h3>
              <p className="text-xs text-emerald-700 mt-0.5">
                These lines have been confirmed by the agronomist and are ready to be dispatched as work orders.
              </p>
            </div>
            <span className="text-xl">🚀</span>
          </div>

          <div className="space-y-2">
            {approvedLines.map((line) => (
              <form
                key={line.id}
                action={releaseLine}
                className="bg-white p-3 rounded border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <input type="hidden" name="line_id" value={line.id} />
                <div>
                  <span className="font-bold text-gray-900">{line.product_catalog?.trade_name}</span>
                  <span className="text-gray-500 ml-2">
                    Date: {new Date(line.scheduled_date).toLocaleDateString('en-IN')} | {line.houses?.name || 'House'}
                  </span>
                  <span className="font-mono text-emerald-800 font-bold ml-2">
                    Qty: {line.approved_total_quantity} {line.approved_quantity_unit}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    name="assigned_to"
                    className="px-2 py-1 bg-white border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Assign Supervisor (Optional)</option>
                    {supervisors?.map((s) => {
                      const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles
                      return (
                        <option key={s.user_id} value={s.user_id}>
                          {profile?.full_name || s.user_id}
                        </option>
                      )
                    })}
                  </select>

                  <button
                    type="submit"
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded transition-colors whitespace-nowrap"
                  >
                    Release Work Order →
                  </button>
                </div>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* Work Orders List */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Work Orders Ledger</h2>
          <span className="text-xs text-gray-500 font-mono">Total Orders: {workOrders?.length || 0}</span>
        </div>

        {!workOrders || workOrders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">📝</span>
            <p className="font-medium text-gray-700">No work orders issued yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Release approved treatment lines to generate active work orders for supervisors.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Scheduled Date</th>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Polyhouse / Crop</th>
                  <th className="px-4 py-3">Required Dosage & Carrier</th>
                  <th className="px-4 py-3">Assigned Operator</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {workOrders.map((wo) => (
                  <tr key={wo.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-gray-700 font-medium">
                      {new Date(wo.planned_date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900 block">{wo.product_catalog?.trade_name}</span>
                      <span className="text-[11px] text-gray-500">{wo.product_catalog?.concentration}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800 block">{wo.houses?.name}</span>
                      <span className="text-[11px] text-gray-500">{wo.crop_cycles?.crop_name}</span>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <span className="font-bold text-gray-900 block">
                        {wo.required_quantity} {wo.quantity_unit}
                      </span>
                      {wo.water_volume && (
                        <span className="text-[11px] text-gray-500 block">in {wo.water_volume} L Water</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {wo.profiles?.full_name || <span className="text-gray-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={wo.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {wo.status !== 'completed' && wo.status !== 'verified' && (
                        <Link
                          href={`/dashboard/work-orders/${wo.id}/execute`}
                          className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                        >
                          Execute →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

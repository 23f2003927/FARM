import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import Link from 'next/link'
import { calculateProcurementRequirement } from '@/lib/calculations/procurement'

export default async function ProcurementPlanningPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canOrder = memberships?.roles?.some((r: string) => ['owner', 'procurement'].includes(r))

  // Fetch Demand, Usable Stock, and Incoming Stock
  const [{ data: demandList }, { data: usableList }, { data: incomingList }] = await Promise.all([
    supabase.from('v_procurement_demand').select('*').eq('farm_id', farmId),
    supabase.from('v_usable_stock').select('*').eq('farm_id', farmId),
    supabase.from('v_confirmed_incoming_stock').select('*').eq('farm_id', farmId),
  ])

  // Build procurement calculation rows
  const planningRows = (demandList || []).map((dem) => {
    const usable = usableList?.find((u) => u.product_id === dem.product_id)?.total_usable_quantity || 0
    const incoming = incomingList?.find((i) => i.product_id === dem.product_id)?.incoming_quantity || 0

    const calc = calculateProcurementRequirement({
      productTradeName: dem.trade_name,
      demandQuantity: Number(dem.total_planned_demand),
      demandUnit: dem.stock_unit,
      usableStockQuantity: Number(usable),
      stockUnit: dem.stock_unit,
      confirmedIncomingQuantity: Number(incoming),
      desiredEndingStock: 0,
      standardPackageSize: dem.standard_package_size ? Number(dem.standard_package_size) : 1,
      packageUnit: dem.package_unit || dem.stock_unit,
    })

    return {
      productId: dem.product_id,
      tradeName: dem.trade_name,
      category: dem.category,
      unit: dem.stock_unit,
      plannedDemand: dem.total_planned_demand,
      treatmentCount: dem.treatment_count,
      usableStock: usable,
      incomingStock: incoming,
      calc,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement Planning & Calculator"
        description="Automated demand planning comparing upcoming approved treatments against usable stock and inbound orders"
        actions={
          <div className="flex gap-2">
            <Link
              href="/dashboard/procurement/orders"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
            >
              📋 Purchase Orders
            </Link>
            {canOrder && (
              <Link
                href="/dashboard/procurement/orders/new"
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                + Create Purchase Order
              </Link>
            )}
          </div>
        }
      />

      {/* Transparent Calculation Explainer */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700">
        <span className="font-bold text-gray-900 block mb-1">Procurement Calculation Logic (Transparent):</span>
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-gray-600">
          <span>Net Requirement = MAX(0, Planned Demand - Usable Stock - Confirmed Incoming)</span>
          <span>Packages to Order = CEILING(Net Requirement / Package Size)</span>
          <span>Projected Leftover = Total Ordered - Net Requirement</span>
        </div>
      </div>

      {/* Automated Planning Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Treatment Demand vs Inventory Availability</h2>
          <span className="text-xs text-gray-500 font-mono">Products with Demand: {planningRows.length}</span>
        </div>

        {planningRows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">🛒</span>
            <p className="font-medium text-gray-700">No active treatment demand.</p>
            <p className="text-xs text-gray-400 mt-1">
              Upcoming approved or pending treatment plan lines will automatically populate this procurement table.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Planned Demand</th>
                  <th className="px-4 py-3">Usable Stock</th>
                  <th className="px-4 py-3">Incoming Orders</th>
                  <th className="px-4 py-3">Net Shortfall</th>
                  <th className="px-4 py-3">Pack Size</th>
                  <th className="px-4 py-3">Order Recommendation</th>
                  <th className="px-4 py-3">Projected Leftover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {planningRows.map((row) => {
                  const { calc } = row
                  const needsOrder = calc.packagesToOrder > 0

                  return (
                    <tr key={row.productId} className={`hover:bg-gray-50/50 ${needsOrder ? 'bg-amber-50/20' : ''}`}>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 block">{row.tradeName}</span>
                        <span className="text-[11px] text-gray-500 font-mono">
                          {row.category} | {row.treatmentCount} treatment{row.treatmentCount === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-gray-900">
                        {row.plannedDemand} {row.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-700 font-medium">
                        {row.usableStock} {row.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-blue-700 font-medium">
                        {row.incomingStock} {row.unit}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-gray-900">
                        {calc.netRequirement} {row.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600">
                        {calc.packageSize} {row.unit}
                      </td>
                      <td className="px-4 py-3">
                        {needsOrder ? (
                          <div className="font-mono">
                            <span className="font-bold text-amber-800 text-sm block">
                              {calc.packagesToOrder} pkg{calc.packagesToOrder === 1 ? '' : 's'}
                            </span>
                            <span className="text-[11px] text-gray-500 block">
                              (= {calc.totalOrderQuantity} {row.unit})
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                            Sufficient Stock
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-500">
                        {calc.projectedExcess > 0 ? `+${calc.projectedExcess} ${row.unit}` : '0'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

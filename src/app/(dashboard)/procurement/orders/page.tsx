import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'

export default async function PurchaseOrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canCreate = memberships?.roles?.some((r: string) => ['owner', 'procurement'].includes(r))

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_lines(id, quantity_ordered, quantity_received)')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description="Supplier purchase orders, approval workflows, and multi-stage delivery tracking"
        actions={
          <div className="flex gap-2">
            <Link
              href="/dashboard/procurement"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
            >
              ← Procurement Calculator
            </Link>
            {canCreate && (
              <Link
                href="/dashboard/procurement/orders/new"
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                + New Purchase Order
              </Link>
            )}
          </div>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Purchase Order Records</h2>
          <span className="text-xs text-gray-500 font-mono">Total Orders: {orders?.length || 0}</span>
        </div>

        {!orders || orders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">📦</span>
            <p className="font-medium text-gray-700">No purchase orders created yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Create a purchase order based on recommended quantities from the procurement calculator.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Created / Ordered Date</th>
                  <th className="px-4 py-3">Total Amount</th>
                  <th className="px-4 py-3">Fulfillment Progress</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {orders.map((po) => {
                  const lineCount = po.purchase_order_lines?.length || 0
                  const totalOrdered = po.purchase_order_lines?.reduce((sum: number, l: { quantity_ordered: number }) => sum + Number(l.quantity_ordered), 0) || 0
                  const totalReceived = po.purchase_order_lines?.reduce((sum: number, l: { quantity_received: number }) => sum + Number(l.quantity_received), 0) || 0
                  const progressPct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0

                  return (
                    <tr key={po.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/procurement/orders/${po.id}`}
                          className="font-bold text-green-700 hover:text-green-800 font-mono"
                        >
                          {po.po_number}
                        </Link>
                        <span className="text-[11px] text-gray-400 block">{lineCount} item{lineCount === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {po.suppliers?.name || 'Direct'}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600">
                        {new Date(po.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-gray-900">
                        {po.currency} {po.total_amount ? Number(po.total_amount).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-32">
                          <div className="flex justify-between text-[10px] text-gray-500 font-mono mb-1">
                            <span>{totalReceived}/{totalOrdered}</span>
                            <span>{progressPct}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-green-600 h-1.5 rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={po.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/procurement/orders/${po.id}`}
                          className="text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded"
                        >
                          Details →
                        </Link>
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

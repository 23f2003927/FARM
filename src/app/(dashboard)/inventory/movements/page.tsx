import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import Link from 'next/link'

export default async function StockMovementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id

  const { data: movements } = await supabase
    .from('stock_movements')
    .select('*, product_catalog(trade_name, category), product_batches(batch_number), profiles!performed_by(full_name)')
    .eq('farm_id', farmId)
    .order('movement_date', { ascending: false })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Movement Ledger (Audit Trail)"
        description="Append-only record of all chemical receipts, issues to work orders, returns, and physical adjustments"
        actions={
          <Link
            href="/dashboard/inventory"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Inventory
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Historical Movements</h2>
          <span className="text-xs text-gray-500 font-mono">Total Transactions: {movements?.length || 0}</span>
        </div>

        {!movements || movements.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">📜</span>
            <p className="font-medium text-gray-700">No stock movements recorded yet.</p>
            <p className="text-xs text-gray-400 mt-1">Every stock transaction will be permanently recorded here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Product & Batch</th>
                  <th className="px-4 py-3">Movement Type</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Reason / Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {movements.map((m) => {
                  const isPositive = Number(m.quantity) > 0
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-gray-500 whitespace-nowrap">
                        {new Date(m.movement_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 block">{m.product_catalog?.trade_name}</span>
                        <span className="text-[11px] text-gray-500 font-mono">
                          Batch: {m.product_batches?.batch_number || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-800">
                          {m.movement_type.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold whitespace-nowrap">
                        <span className={isPositive ? 'text-emerald-700' : 'text-red-600'}>
                          {isPositive ? `+${m.quantity}` : m.quantity} {m.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {m.profiles?.full_name || 'System / Owner'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                        {m.reason || 'None provided'}
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


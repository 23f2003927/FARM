import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'

export default async function InventoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canReceive = memberships?.roles?.some((r: string) => ['owner', 'procurement'].includes(r))

  // Fetch Usable Stock, Batches, and Expiring Batches
  const [{ data: usableStock }, { data: batches }, { data: expiringBatches }] = await Promise.all([
    supabase.from('v_usable_stock').select('*').eq('farm_id', farmId),
    supabase.from('v_stock_balances').select('*').eq('farm_id', farmId).order('trade_name', { ascending: true }),
    supabase.from('v_expiring_batches').select('*').eq('farm_id', farmId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory & Batch Ledger"
        description="Immutable FEFO stock balances calculated dynamically from append-only movements"
        actions={
          <div className="flex gap-2">
            <Link
              href="/dashboard/inventory/movements"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
            >
              📜 Audit Ledger
            </Link>
            {canReceive && (
              <Link
                href="/dashboard/inventory/receive"
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                + Receive Stock / Opening
              </Link>
            )}
          </div>
        }
      />

      {/* FEFO Expiry Alert Banner */}
      {expiringBatches && expiringBatches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">⚠️</span>
            <h3 className="text-sm font-bold text-amber-900">
              FEFO Expiry Warnings ({expiringBatches.length} batch{expiringBatches.length === 1 ? '' : 'es'} expiring within 60 days)
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {expiringBatches.map((eb) => (
              <div key={eb.batch_id} className="bg-white/80 border border-amber-200 rounded p-2 text-xs">
                <span className="font-semibold text-gray-900 block">{eb.trade_name}</span>
                <span className="text-gray-500 font-mono text-[11px] block">
                  Batch: {eb.batch_number} | Bal: {eb.current_balance} {eb.unit}
                </span>
                <span className="text-amber-800 font-semibold text-[11px] block mt-0.5">
                  Expires in {eb.days_until_expiry} days ({new Date(eb.expiry_date).toLocaleDateString('en-IN')})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usable Stock Summary Grid */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Available Usable Stock</h2>
        {!usableStock || usableStock.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
            <p className="font-medium text-gray-700">No stock on hand.</p>
            <p className="text-xs text-gray-400 mt-1">Record an opening balance or purchase receipt to stock inputs.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {usableStock.map((item) => (
              <div key={item.product_id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
                <div className="flex items-start justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{item.category}</span>
                  <span className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">
                    {item.usable_batch_count} batch{item.usable_batch_count === 1 ? '' : 'es'}
                  </span>
                </div>
                <h3 className="font-bold text-gray-900 mt-1 text-sm truncate">{item.trade_name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold font-mono text-emerald-700">{item.total_usable_quantity}</span>
                  <span className="text-xs font-mono font-medium text-gray-500">{item.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batch Breakdown Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Batch-Level Inventory Breakdown</h2>
          <span className="text-xs text-gray-500 font-mono">Total Batches: {batches?.length || 0}</span>
        </div>

        {!batches || batches.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">No batches registered.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Batch / Lot #</th>
                  <th className="px-4 py-3">Current Balance</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3">Storage Location</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {batches.map((b) => (
                  <tr key={b.batch_id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900 block">{b.trade_name}</span>
                      {b.active_ingredient && (
                        <span className="text-[11px] text-gray-500 font-mono">{b.active_ingredient}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-gray-800">
                      {b.batch_number}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">
                      {b.current_balance} {b.unit}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600">
                      {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString('en-IN') : 'No Expiry'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {b.storage_location || 'General Store'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.batch_status} />
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


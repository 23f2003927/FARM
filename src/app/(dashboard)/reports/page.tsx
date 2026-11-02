import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id

  // Summary counts for reports
  const [
    { count: stockCount },
    { count: movementCount },
    { count: appCount },
    { count: obsCount },
  ] = await Promise.all([
    supabase.from('product_batches').select('id', { count: 'exact', head: true }).eq('farm_id', farmId),
    supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('farm_id', farmId),
    supabase.from('application_records').select('id', { count: 'exact', head: true }).eq('farm_id', farmId),
    supabase.from('crop_observations').select('id', { count: 'exact', head: true }).eq('farm_id', farmId),
  ])

  const reportCards = [
    {
      title: 'Current Inventory & Batch Balances',
      type: 'inventory',
      description: 'Calculated batch balances, FEFO expiry dates, and usable product totals.',
      count: stockCount || 0,
      icon: '📦',
    },
    {
      title: 'Immutable Stock Movement Ledger',
      type: 'movements',
      description: 'Historical audit trail of all receipts, issues, returns, and physical adjustments.',
      count: movementCount || 0,
      icon: '📜',
    },
    {
      title: 'Application Execution & Discrepancies',
      type: 'applications',
      description: 'Completed work order measurements, planned vs actual variance, and verification logs.',
      count: appCount || 0,
      icon: '✅',
    },
    {
      title: 'Crop Health Observations & Response',
      type: 'crop_health',
      description: 'Scouting incidence percentages, severity ratings, and treatment response efficacy.',
      count: obsCount || 0,
      icon: '🌱',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Reports & Data Export"
        description="Download audit-ready CSV datasets filtered strictly to your authorized farm scope"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportCards.map((r) => (
          <div
            key={r.type}
            className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl">{r.icon}</span>
                <span className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-medium">
                  {r.count} Records
                </span>
              </div>
              <h3 className="text-base font-bold text-gray-900 mt-2">{r.title}</h3>
              <p className="text-xs text-gray-500 mt-1">{r.description}</p>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
              <a
                href={`/api/export?type=${r.type}`}
                download
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
              >
                <span>Download CSV</span>
                <span>↓</span>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

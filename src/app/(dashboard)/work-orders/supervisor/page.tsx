import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import Link from 'next/link'

export default async function SupervisorPortalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id

  // Fetch pending or assigned work orders
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('*, product_catalog(trade_name, concentration, category, storage_instructions), houses(name), crop_cycles(crop_name)')
    .eq('farm_id', farmId)
    .in('status', ['pending', 'assigned', 'in_progress'])
    .order('planned_date', { ascending: true })

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-12">
      <PageHeader
        title="Supervisor Operations Portal"
        description="दैनिक स्प्रे और खाद कार्य आदेश (Daily Application Work Orders)"
        actions={
          <Link
            href="/dashboard/work-orders"
            className="px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 rounded font-medium"
          >
            Desktop View
          </Link>
        }
      />

      <div className="bg-green-700 text-white rounded-xl p-4 shadow-sm">
        <h2 className="text-base font-bold">आज के कार्य (Pending Today)</h2>
        <p className="text-xs text-green-100 mt-0.5">
          केवल स्वीकृत मात्रा का उपयोग करें। दवा बदलते समय पर्यवेक्षक की अनुमति आवश्यक है।
        </p>
      </div>

      {!workOrders || workOrders.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
          <span className="text-4xl block mb-2">🎉</span>
          <p className="font-semibold text-gray-800 text-base">कोई लंबित कार्य आदेश नहीं है।</p>
          <p className="text-xs text-gray-400 mt-1">No pending work orders assigned for application.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workOrders.map((wo) => (
            <div
              key={wo.id}
              className="bg-white border-2 border-gray-200 rounded-xl p-5 shadow-sm hover:border-green-600 transition-all"
            >
              <div className="flex items-start justify-between border-b border-gray-100 pb-3 mb-3">
                <div>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                    पॉलीहाउस (Polyhouse)
                  </span>
                  <span className="text-base font-bold text-gray-900 block mt-0.5">
                    {wo.houses?.name}
                  </span>
                  {wo.crop_cycles && (
                    <span className="text-xs text-gray-500 block">फसल: {wo.crop_cycles.crop_name}</span>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">तारीख</span>
                  <span className="text-xs font-mono font-bold text-gray-800">
                    {new Date(wo.planned_date).toLocaleDateString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Product Details */}
              <div className="space-y-2 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <span className="text-[11px] font-semibold text-gray-500 block">दवा का नाम (Required Input)</span>
                  <span className="text-lg font-extrabold text-green-800 block">
                    {wo.product_catalog?.trade_name}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">
                    {wo.product_catalog?.concentration}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-emerald-50/70 p-2.5 rounded border border-emerald-200">
                    <span className="text-gray-500 block text-[11px]">कुल मात्रा (Total Qty)</span>
                    <span className="font-mono font-bold text-base text-emerald-900">
                      {wo.required_quantity} {wo.quantity_unit}
                    </span>
                  </div>

                  <div className="bg-blue-50/70 p-2.5 rounded border border-blue-200">
                    <span className="text-gray-500 block text-[11px]">पानी की मात्रा (Water)</span>
                    <span className="font-mono font-bold text-base text-blue-900">
                      {wo.water_volume ? `${wo.water_volume} L` : 'N/A'}
                    </span>
                  </div>
                </div>

                {wo.instructions_hindi && (
                  <div className="p-2.5 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-900">
                    <strong>विशेष निर्देश:</strong> {wo.instructions_hindi}
                  </div>
                )}
              </div>

              {/* Large Mobile Execution Action */}
              <Link
                href={`/dashboard/work-orders/${wo.id}/execute`}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-sm rounded-lg shadow-sm transition-colors"
              >
                <span>स्प्रे शुरू करें (Execute Application)</span>
                <span>→</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

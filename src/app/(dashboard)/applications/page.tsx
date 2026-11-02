import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { revalidatePath } from 'next/cache'

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ verification?: string }>
}) {
  const { verification } = await searchParams
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
  const isVerifier = roles.includes('verifier') || roles.includes('owner')

  let query = supabase
    .from('application_records')
    .select('*, product_catalog(trade_name), product_batches(batch_number), profiles!operator_id(full_name), work_orders(houses(name))')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })

  if (verification) {
    query = query.eq('verification_status', verification)
  }

  const { data: applications } = await query

  // Server Action: Verify Application
  async function verifyApp(formData: FormData) {
    'use server'
    const appId = formData.get('app_id') as string
    const status = formData.get('status') as 'verified' | 'rejected'
    const notes = formData.get('notes') as string

    if (!appId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.some((r: string) => ['verifier', 'owner'].includes(r))) {
      await supabase
        .from('application_records')
        .update({
          verification_status: status,
          verified_by: user?.id,
          verified_at: new Date().toISOString(),
          verification_notes: notes?.trim() || null,
        })
        .eq('id', appId)
        .eq('farm_id', m.farm_id)

      revalidatePath('/dashboard/applications')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application Records & Verification"
        description="Formal inspection of completed work orders, discrepancy tracking, and verifier signoffs"
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Application Execution History</h2>
          <span className="text-xs text-gray-500 font-mono">Total Records: {applications?.length || 0}</span>
        </div>

        {!applications || applications.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">✅</span>
            <p className="font-medium text-gray-700">No applications recorded yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Executed supervisor work orders will be submitted here for verification.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Applied Date</th>
                  <th className="px-4 py-3">Product & Batch</th>
                  <th className="px-4 py-3">Polyhouse</th>
                  <th className="px-4 py-3">Planned vs Actual</th>
                  <th className="px-4 py-3">Discrepancy</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Verification</th>
                  {isVerifier && <th className="px-4 py-3 text-right">Verification Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {applications.map((app) => {
                  const hasDiscrepancy = app.has_discrepancy || Number(app.actual_quantity) !== Number(app.planned_quantity)

                  return (
                    <tr key={app.id} className={`hover:bg-gray-50/50 ${hasDiscrepancy ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-4 py-3 font-mono text-gray-700">
                        {new Date(app.application_date).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 block">{app.product_catalog?.trade_name}</span>
                        <span className="text-[11px] text-gray-500 font-mono">
                          Batch: {app.product_batches?.batch_number}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {app.work_orders?.houses?.name || 'Polyhouse'}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className="text-gray-500 block text-[11px]">Plan: {app.planned_quantity} {app.quantity_unit}</span>
                        <span className="font-bold text-gray-900 block text-sm">Act: {app.actual_quantity} {app.quantity_unit}</span>
                      </td>
                      <td className="px-4 py-3">
                        {hasDiscrepancy ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            ⚠️ Discrepancy
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Exact Match</span>
                        )}
                        {app.deviations && (
                          <span className="text-gray-500 text-[10px] block mt-0.5 max-w-xs truncate">
                            Note: {app.deviations}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {app.profiles?.full_name || 'Supervisor'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={app.verification_status} />
                      </td>
                      {isVerifier && (
                        <td className="px-4 py-3 text-right">
                          {app.verification_status === 'pending' ? (
                            <form action={verifyApp} className="flex items-center justify-end gap-1">
                              <input type="hidden" name="app_id" value={app.id} />
                              <button
                                type="submit"
                                name="status"
                                value="verified"
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-[11px] transition-colors"
                              >
                                ✓ Verify
                              </button>
                              <button
                                type="submit"
                                name="status"
                                value="rejected"
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold text-[11px] transition-colors"
                              >
                                ✕ Reject
                              </button>
                            </form>
                          ) : (
                            <span className="text-gray-400 text-[11px] italic">Completed</span>
                          )}
                        </td>
                      )}
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


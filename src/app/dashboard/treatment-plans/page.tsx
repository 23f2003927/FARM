import { createClient } from '@/lib/supabase/server'
import { getCachedUser, getCachedFarmMembership } from '@/lib/supabase/cached'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'

export default async function TreatmentPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const user = await getCachedUser()
  const membership = await getCachedFarmMembership(user?.id)

  const farmId = membership?.farm_id
  const canCreate = membership?.roles?.some((r: string) => ['owner', 'agronomist'].includes(r))

  const supabase = await createClient()

  let query = supabase
    .from('treatment_plans')
    .select('*, treatment_plan_lines(count)')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data: plans } = await query

  return (
    <div>
      <PageHeader
        title="Agronomist Treatment Plans"
        description="Structured schedules from handwritten agronomist visits, chemical matching, and approval lifecycles"
        actions={
          canCreate && (
            <Link
              href="/dashboard/treatment-plans/new"
              className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              + New Treatment Plan
            </Link>
          )
        }
      />

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 pb-2">
        <Link
          href="/dashboard/treatment-plans"
          className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
            !status ? 'bg-green-100 text-green-800' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          All Plans
        </Link>
        <Link
          href="/dashboard/treatment-plans?status=draft"
          className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
            status === 'draft' ? 'bg-green-100 text-green-800' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Drafts
        </Link>
        <Link
          href="/dashboard/treatment-plans?status=pending_approval"
          className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
            status === 'pending_approval' ? 'bg-yellow-100 text-yellow-800' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Awaiting Approval
        </Link>
        <Link
          href="/dashboard/treatment-plans?status=approved"
          className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
            status === 'approved' ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Approved
        </Link>
      </div>

      {/* Plans List */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        {!plans || plans.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">📋</span>
            <p className="font-medium text-gray-700">No treatment schedules found.</p>
            <p className="text-xs text-gray-400 mt-1">
              Create a new plan when your visiting agronomist provides a 15-20 day treatment schedule.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {plans.map((p) => {
              const lineCount = p.treatment_plan_lines?.[0]?.count || 0
              return (
                <div
                  key={p.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/50"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/dashboard/treatment-plans/${p.id}`}
                        className="text-base font-bold text-gray-900 hover:text-green-700"
                      >
                        {p.title}
                      </Link>
                      <StatusBadge status={p.status} />
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                      {p.agronomist_name && (
                        <span>Agronomist: <strong>{p.agronomist_name}</strong></span>
                      )}
                      {p.plan_start_date && (
                        <span>
                          Period: {new Date(p.plan_start_date).toLocaleDateString('en-IN')}
                          {p.plan_end_date ? ` to ${new Date(p.plan_end_date).toLocaleDateString('en-IN')}` : ''}
                        </span>
                      )}
                      <span className="font-mono text-gray-700 font-medium">
                        {lineCount} treatment {lineCount === 1 ? 'line' : 'lines'}
                      </span>
                    </div>

                    {p.description && (
                      <p className="text-xs text-gray-600 mt-1.5">{p.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/treatment-plans/${p.id}`}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-medium rounded transition-colors"
                    >
                      View & Manage →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


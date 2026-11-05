import { createClient } from '@/lib/supabase/server'
import { getCachedUser, getCachedFarmMembership } from '@/lib/supabase/cached'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'

export default async function CropHealthPage() {
  const user = await getCachedUser()
  const membership = await getCachedFarmMembership(user?.id)

  const farmId = membership?.farm_id
  const canScout = membership?.roles?.some((r: string) => ['owner', 'agronomist', 'supervisor'].includes(r))

  const supabase = await createClient()
  const [{ data: rounds }, { data: anomalies }] = await Promise.all([
    supabase
      .from('scouting_rounds')
      .select('*, houses(name), crop_cycles(crop_name), profiles!scout_id(full_name), crop_observations(*)')
      .eq('farm_id', farmId)
      .order('scouting_date', { ascending: false }),
    supabase
      .from('v_unresolved_observations')
      .select('*')
      .eq('farm_id', farmId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crop Health & Scouting"
        description="Pest/disease incidence tracking, severity monitoring, and before-and-after treatment response evaluation"
        actions={
          canScout && (
            <Link
              href="/dashboard/crop-health/scout"
              className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              + New Scouting Round
            </Link>
          )
        }
      />

      {/* Active Anomalies Alert Banner */}
      {anomalies && anomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚨</span>
              <h3 className="text-sm font-bold text-red-950">
                {anomalies.length} Unresolved Crop Anomalies / Escalations
              </h3>
            </div>
            <span className="text-xs font-mono text-red-700 font-semibold">Agronomist Review Urged</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {anomalies.map((anom) => (
              <div key={anom.observation_id} className="bg-white/90 border border-red-200 rounded p-2.5 text-xs">
                <div className="flex items-start justify-between">
                  <span className="font-bold text-gray-900">{anom.suspected_issue || 'Unidentified'}</span>
                  {anom.is_escalated && (
                    <span className="bg-red-100 text-red-800 text-[10px] px-1.5 py-0.2 rounded font-bold">
                      ESCALATED
                    </span>
                  )}
                </div>
                <span className="text-gray-500 block text-[11px] mt-0.5">
                  {anom.house_name} | {anom.crop_name}
                </span>
                <div className="flex items-center justify-between mt-1 text-[11px] font-mono">
                  <span className="text-red-700 font-bold">Incidence: {anom.incidence_pct}%</span>
                  <span className="text-gray-500">Severity: {anom.severity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scouting Rounds List */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Scouting Rounds History</h2>
          <span className="text-xs text-gray-500 font-mono">Total Rounds: {rounds?.length || 0}</span>
        </div>

        {!rounds || rounds.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">🔍</span>
            <p className="font-medium text-gray-700">No scouting rounds logged yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Record scouting observations to monitor incidence percentages and verify treatment efficacy.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rounds.map((round) => (
              <div key={round.id} className="p-5 hover:bg-gray-50/50">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-sm">
                        {round.houses?.name || 'Polyhouse'}
                      </span>
                      {round.crop_cycles && (
                        <span className="text-xs text-gray-500 font-medium">({round.crop_cycles.crop_name})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 text-xs text-gray-400 mt-0.5 font-mono">
                      <span>Date: {new Date(round.scouting_date).toLocaleDateString('en-IN')}</span>
                      <span>Scout: {round.profiles?.full_name || 'Operator'}</span>
                      <span>Stage: {round.growth_stage || 'Vegetative'}</span>
                    </div>
                  </div>
                </div>

                {/* Nested Observations in Round */}
                {round.crop_observations && round.crop_observations.length > 0 && (
                  <div className="mt-3 space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-200/60">
                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                      Field Observations ({round.crop_observations.length})
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {round.crop_observations.map((obs: {
                        id: string
                        suspected_issue: string | null
                        plants_checked: number
                        plants_affected: number
                        incidence_pct: number
                        severity: string
                        response_vs_previous: string | null
                        is_resolved: boolean
                      }) => (
                        <div key={obs.id} className="bg-white p-2.5 rounded border border-gray-200">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-900">{obs.suspected_issue || 'General Check'}</span>
                            <span className="font-mono text-emerald-800 font-bold">
                              Incidence: {obs.incidence_pct}%
                            </span>
                          </div>
                          <span className="text-gray-500 font-mono text-[11px] block mt-0.5">
                            Checked: {obs.plants_checked} | Affected: {obs.plants_affected} | Severity: {obs.severity}
                          </span>
                          {obs.response_vs_previous && (
                            <span className={`inline-block mt-1 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              obs.response_vs_previous === 'improved'
                                ? 'bg-green-100 text-green-800'
                                : obs.response_vs_previous === 'worsened'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              Response: {obs.response_vs_previous.toUpperCase()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


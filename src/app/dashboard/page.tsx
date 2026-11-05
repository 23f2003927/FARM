import { createClient } from '@/lib/supabase/server'
import { getCachedUser, getCachedFarmMembership } from '@/lib/supabase/cached'
import { PageHeader } from '@/components/layout/page-header'
import Link from 'next/link'
import type { Role } from '@/types/enums'
import { ROLE_LABELS } from '@/types/enums'

export default async function DashboardPage() {
  const user = await getCachedUser()
  const activeMembership = await getCachedFarmMembership(user?.id)

  const farmId = activeMembership?.farm_id
  const roles = (activeMembership?.roles || []) as Role[]
  const farmName = activeMembership?.farms?.name || 'My Farm'

  const supabase = await createClient()

  // Query real database metrics for the active farm in parallel
  const [
    { count: houseCount },
    { count: cycleCount },
    { count: pendingTreatmentsCount },
    { count: workOrdersCount },
    { count: pendingVerificationCount },
    { data: expiringList },
    { data: anomaliesList },
  ] = await Promise.all([
    supabase.from('houses').select('id', { count: 'exact', head: true }).eq('farm_id', farmId),
    supabase.from('crop_cycles').select('id', { count: 'exact', head: true }).eq('farm_id', farmId).eq('status', 'active'),
    supabase.from('treatment_plan_lines').select('id', { count: 'exact', head: true }).eq('farm_id', farmId).in('status', ['draft', 'pending_approval', 'needs_clarification']),
    supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('farm_id', farmId).in('status', ['pending', 'assigned', 'in_progress']),
    supabase.from('application_records').select('id', { count: 'exact', head: true }).eq('farm_id', farmId).eq('verification_status', 'pending'),
    supabase.from('v_expiring_batches').select('batch_id').eq('farm_id', farmId),
    supabase.from('v_unresolved_observations').select('observation_id').eq('farm_id', farmId),
  ])

  const expiringCount = expiringList?.length || 0
  const anomaliesCount = anomaliesList?.length || 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Operations Dashboard"
        description={`Active Facility: ${farmName}`}
      />

      {/* Role & Quick Status Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Your Assigned Operational Roles</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {roles.map((r) => (
              <span
                key={r}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800"
              >
                {ROLE_LABELS[r] || r}
              </span>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-500 font-mono">
          System Time: {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
        </div>
      </div>

      {/* Critical Alerts Banner (Only renders when actionable items exist) */}
      {(expiringCount > 0 || anomaliesCount > 0 || (pendingVerificationCount || 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {anomaliesCount > 0 && (
            <Link
              href="/dashboard/crop-health"
              className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between hover:bg-red-100/50 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-lg">🚨</span>
                <div>
                  <span className="font-bold text-red-900 block">{anomaliesCount} Unresolved Anomalies</span>
                  <span className="text-red-700">Check scouting escalations</span>
                </div>
              </div>
              <span className="text-red-800 text-sm">→</span>
            </Link>
          )}

          {expiringCount > 0 && (
            <Link
              href="/dashboard/inventory"
              className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between hover:bg-amber-100/50 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-lg">⚠️</span>
                <div>
                  <span className="font-bold text-amber-900 block">{expiringCount} Batches Expiring</span>
                  <span className="text-amber-700">Prioritize FEFO dispatch</span>
                </div>
              </div>
              <span className="text-amber-800 text-sm">→</span>
            </Link>
          )}

          {(pendingVerificationCount || 0) > 0 && (
            <Link
              href="/dashboard/applications"
              className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between hover:bg-blue-100/50 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-lg">📋</span>
                <div>
                  <span className="font-bold text-blue-900 block">{pendingVerificationCount} Applications to Verify</span>
                  <span className="text-blue-700">Review supervisor signoffs</span>
                </div>
              </div>
              <span className="text-blue-800 text-sm">→</span>
            </Link>
          )}
        </div>
      )}

      {/* Operational KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Polyhouses</span>
            <span className="text-2xl">🏠</span>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2 font-mono">{houseCount || 0}</p>
          <div className="mt-3">
            <Link href="/dashboard/farm" className="text-xs font-semibold text-green-600 hover:text-green-700">
              Manage facilities →
            </Link>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Crops</span>
            <span className="text-2xl">🌱</span>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2 font-mono">{cycleCount || 0}</p>
          <div className="mt-3">
            <Link href="/dashboard/crop-cycles" className="text-xs font-semibold text-green-600 hover:text-green-700">
              View cultivation →
            </Link>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pending Treatments</span>
            <span className="text-2xl">📋</span>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2 font-mono">{pendingTreatmentsCount || 0}</p>
          <div className="mt-3">
            <Link href="/dashboard/treatment-plans" className="text-xs font-semibold text-green-600 hover:text-green-700">
              Review & approve →
            </Link>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Work Orders</span>
            <span className="text-2xl">📝</span>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2 font-mono">{workOrdersCount || 0}</p>
          <div className="mt-3">
            <Link href="/dashboard/work-orders" className="text-xs font-semibold text-green-600 hover:text-green-700">
              Execute applications →
            </Link>
          </div>
        </div>
      </div>

      {/* Core Operational Shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs">
          <h2 className="text-base font-bold text-gray-900 mb-3">Facility Quick Access</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Link
              href="/dashboard/treatment-plans"
              className="p-3.5 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50/40 transition-colors"
            >
              <span className="font-bold text-gray-900 text-sm block">Treatment Plans</span>
              <span className="text-gray-500 mt-0.5 block">Review transcribed prescriptions</span>
            </Link>

            <Link
              href="/dashboard/procurement"
              className="p-3.5 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50/40 transition-colors"
            >
              <span className="font-bold text-gray-900 text-sm block">Procurement Calculator</span>
              <span className="text-gray-500 mt-0.5 block">Calculate packages to order</span>
            </Link>

            <Link
              href="/dashboard/inventory"
              className="p-3.5 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50/40 transition-colors"
            >
              <span className="font-bold text-gray-900 text-sm block">Inventory Ledger</span>
              <span className="text-gray-500 mt-0.5 block">Batch balances & FEFO</span>
            </Link>

            <Link
              href="/dashboard/reports"
              className="p-3.5 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50/40 transition-colors"
            >
              <span className="font-bold text-gray-900 text-sm block">Data Exports</span>
              <span className="text-gray-500 mt-0.5 block">Audit-ready CSV files</span>
            </Link>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs">
          <h2 className="text-base font-bold text-gray-900 mb-3">Core Operating Rules</h2>
          <div className="space-y-2 text-xs text-gray-600">
            <div className="flex items-start gap-2 p-2 rounded bg-gray-50">
              <span className="text-green-700 font-bold">1.</span>
              <span><strong>No Guesses:</strong> System never invents dosage or converts mass to volume automatically.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded bg-gray-50">
              <span className="text-green-700 font-bold">2.</span>
              <span><strong>Immutable Ledger:</strong> Stock movements cannot be overwritten; negative stock is strictly blocked.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded bg-gray-50">
              <span className="text-green-700 font-bold">3.</span>
              <span><strong>Agronomist Approval:</strong> Work orders are released only after chemical identity and dosage confirmation.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded bg-gray-50">
              <span className="text-green-700 font-bold">4.</span>
              <span><strong>Discrepancy Accountability:</strong> Discrepancies between planned and actual quantities are logged for verification.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

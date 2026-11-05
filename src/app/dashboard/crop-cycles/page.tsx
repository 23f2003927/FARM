import { createClient } from '@/lib/supabase/server'
import { getCachedUser, getCachedFarmMembership } from '@/lib/supabase/cached'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { revalidatePath } from 'next/cache'
import type { CropCycle, House, Zone } from '@/types/app'

export default async function CropCyclesPage() {
  const user = await getCachedUser()
  const membership = await getCachedFarmMembership(user?.id)

  const farmId = membership?.farm_id
  const isOwner = membership?.roles?.includes('owner')

  const supabase = await createClient()
  const [{ data: cycles }, { data: houses }] = await Promise.all([
    supabase
      .from('crop_cycles')
      .select('*, houses(*), zones(*)')
      .eq('farm_id', farmId)
      .order('planting_date', { ascending: false }),
    supabase
      .from('houses')
      .select('id, name, zones(id, name)')
      .eq('farm_id', farmId)
      .eq('status', 'active'),
  ])

  // Server Action to create crop cycle
  async function createCropCycle(formData: FormData) {
    'use server'
    const houseId = formData.get('house_id') as string
    const zoneId = (formData.get('zone_id') as string) || null
    const cropName = formData.get('crop_name') as string
    const variety = formData.get('variety') as string
    const plantingDate = formData.get('planting_date') as string
    const growthStage = formData.get('growth_stage') as string
    const notes = formData.get('notes') as string

    if (!houseId || !cropName?.trim() || !plantingDate) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id) {
      await supabase.from('crop_cycles').insert({
        farm_id: m.farm_id,
        house_id: houseId,
        zone_id: zoneId || null,
        crop_name: cropName.trim(),
        variety: variety?.trim() || null,
        planting_date: plantingDate,
        growth_stage: growthStage?.trim() || 'Nursery / Sowing',
        status: 'active',
        notes: notes?.trim() || null,
      })
      revalidatePath('/dashboard/crop-cycles')
    }
  }

  return (
    <div>
      <PageHeader
        title="Crop Cycles"
        description="Track active cultivation batches, growth stages, varieties, and polyhouse assignments"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Crop Cycles Table */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Crop Cultivation Records</h2>
              <span className="text-xs text-gray-500 font-mono">Total: {cycles?.length || 0}</span>
            </div>

            {!cycles || cycles.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <span className="text-3xl block mb-2">🌱</span>
                <p className="font-medium text-gray-700">No crop cycles active.</p>
                <p className="text-xs text-gray-400 mt-1">Start by planting or registering a crop in a polyhouse.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                    <tr>
                      <th className="px-4 py-3">Crop & Variety</th>
                      <th className="px-4 py-3">Polyhouse / Zone</th>
                      <th className="px-4 py-3">Planted</th>
                      <th className="px-4 py-3">Growth Stage</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cycles.map((cycle: CropCycle) => (
                      <tr key={cycle.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <span className="font-semibold text-gray-900 block">{cycle.crop_name}</span>
                          {cycle.variety && (
                            <span className="text-xs text-gray-500 font-mono">Var: {cycle.variety}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="text-gray-900 font-medium">{cycle.houses?.name || 'Unassigned'}</span>
                          {cycle.zones && (
                            <span className="text-gray-500 block text-[11px] font-mono">[{cycle.zones.name}]</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                          {new Date(cycle.planting_date).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                            {cycle.growth_stage || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={cycle.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* New Crop Cycle Form */}
        {isOwner && (
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs h-fit">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Start New Crop Cycle</h2>
            <p className="text-xs text-gray-500 mb-4">Assign a crop variety to an available polyhouse.</p>

            <form action={createCropCycle} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Polyhouse <span className="text-red-500">*</span>
                </label>
                <select
                  name="house_id"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="">Select Polyhouse</option>
                  {houses?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Crop Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="crop_name"
                  placeholder="e.g. Colored Capsicum, Strawberry, Cucumber"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Variety / Hybrid
                </label>
                <input
                  type="text"
                  name="variety"
                  placeholder="e.g. Inspiration F1, Bachata, King Star RZ"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Planting / Sowing Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="planting_date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Current Growth Stage
                </label>
                <select
                  name="growth_stage"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="Sowing / Nursery">Sowing / Nursery</option>
                  <option value="Transplanting">Transplanting</option>
                  <option value="Vegetative Growth">Vegetative Growth</option>
                  <option value="Flowering">Flowering</option>
                  <option value="Fruit Setting">Fruit Setting</option>
                  <option value="Harvesting">Harvesting</option>
                  <option value="Post-Harvest Cleanout">Post-Harvest Cleanout</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Operational Notes
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Target yield, bed preparation details, etc."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                Record Crop Cycle
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

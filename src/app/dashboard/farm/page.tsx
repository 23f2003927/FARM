import { createClient } from '@/lib/supabase/server'
import { getCachedUser, getCachedFarmMembership } from '@/lib/supabase/cached'
import { PageHeader } from '@/components/layout/page-header'
import { revalidatePath } from 'next/cache'
import type { House, Zone } from '@/types/app'

export default async function FarmStructurePage() {
  const user = await getCachedUser()
  const membership = await getCachedFarmMembership(user?.id)

  const farmId = membership?.farm_id
  const isOwner = membership?.roles?.includes('owner')

  const supabase = await createClient()
  const { data: houses } = await supabase
    .from('houses')
    .select('*, zones(*)')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: true })

  // Server Action to add polyhouse
  async function createPolyhouse(formData: FormData) {
    'use server'
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const area = formData.get('area_sqm') ? parseFloat(formData.get('area_sqm') as string) : null

    if (!name?.trim()) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id) {
      await supabase.from('houses').insert({
        farm_id: m.farm_id,
        name: name.trim(),
        description: description?.trim() || null,
        area_sqm: area,
      })
      revalidatePath('/dashboard/farm')
    }
  }

  // Server Action to add zone
  async function createZone(formData: FormData) {
    'use server'
    const houseId = formData.get('house_id') as string
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    if (!houseId || !name?.trim()) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id) {
      await supabase.from('zones').insert({
        farm_id: m.farm_id,
        house_id: houseId,
        name: name.trim(),
        description: description?.trim() || null,
      })
      revalidatePath('/dashboard/farm')
    }
  }

  return (
    <div>
      <PageHeader
        title="Farm Structure & Polyhouses"
        description="Configure your polyhouse structures and internal zones for micro-climate & treatment tracking"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Polyhouse List & Zone Mapping */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Configured Polyhouses</h2>

          {!houses || houses.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
              <span className="text-3xl block mb-2">🏠</span>
              <p className="font-medium text-gray-700">No polyhouses added yet.</p>
              <p className="text-xs text-gray-400 mt-1">Use the form on the right to register your first polyhouse.</p>
            </div>
          ) : (
            houses.map((house: House & { zones: Zone[] }) => (
              <div key={house.id} className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
                <div className="p-5 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">{house.name}</h3>
                    {house.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{house.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                      {house.status}
                    </span>
                    {house.area_sqm && (
                      <p className="text-xs text-gray-500 mt-1 font-mono">{house.area_sqm} m²</p>
                    )}
                  </div>
                </div>

                {/* Zones inside House */}
                <div className="p-5 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Internal Zones ({house.zones?.length || 0})
                    </h4>
                  </div>

                  {house.zones && house.zones.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                      {house.zones.map((zone) => (
                        <div key={zone.id} className="bg-white border border-gray-200 rounded p-2.5 text-xs">
                          <span className="font-semibold text-gray-800">{zone.name}</span>
                          {zone.description && (
                            <span className="text-gray-500 block text-[11px] mt-0.5">{zone.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic mb-4">No internal zones defined for this house.</p>
                  )}

                  {isOwner && (
                    <form action={createZone} className="flex flex-col sm:flex-row gap-2 mt-2 pt-2 border-t border-gray-200">
                      <input type="hidden" name="house_id" value={house.id} />
                      <input
                        type="text"
                        name="name"
                        placeholder="New zone name (e.g. Zone A1)"
                        required
                        className="px-2.5 py-1.5 bg-white border border-gray-300 rounded text-xs flex-1 focus:ring-1 focus:ring-green-500 outline-none"
                      />
                      <input
                        type="text"
                        name="description"
                        placeholder="Description (optional)"
                        className="px-2.5 py-1.5 bg-white border border-gray-300 rounded text-xs flex-1 focus:ring-1 focus:ring-green-500 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-medium rounded transition-colors whitespace-nowrap"
                      >
                        + Add Zone
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Create Polyhouse Form */}
        {isOwner && (
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs h-fit">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Add Polyhouse</h2>
            <p className="text-xs text-gray-500 mb-4">Register a new greenhouse or polyhouse structure.</p>

            <form action={createPolyhouse} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Polyhouse Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Polyhouse 1 (North)"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Floor Area (sq. metres)
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="area_sqm"
                  placeholder="e.g. 1000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Description / Specification
                </label>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="e.g. High tunnel, fan-and-pad evaporative cooling system"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                Create Polyhouse
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}


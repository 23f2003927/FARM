import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { revalidatePath } from 'next/cache'

export default async function EquipmentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canManage = memberships?.roles?.some((r: string) => ['owner', 'supervisor'].includes(r))

  const [{ data: equipmentList }, { data: houses }] = await Promise.all([
    supabase
      .from('equipment')
      .select('*, houses(name)')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false }),
    supabase.from('houses').select('id, name').eq('farm_id', farmId).eq('status', 'active'),
  ])

  // Server Action: Add Equipment
  async function addEquipment(formData: FormData) {
    'use server'
    const name = formData.get('name') as string
    const type = formData.get('equipment_type') as string
    const brand = formData.get('brand_model') as string
    const houseId = (formData.get('house_id') as string) || null
    const notes = formData.get('maintenance_notes') as string

    if (!name?.trim() || !type) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id) {
      await supabase.from('equipment').insert({
        farm_id: m.farm_id,
        name: name.trim(),
        equipment_type: type,
        brand_model: brand?.trim() || null,
        house_id: houseId || null,
        status: 'operational',
        maintenance_notes: notes?.trim() || null,
      })
      revalidatePath('/dashboard/equipment')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sprayers & Equipment Management"
        description="Sprayer calibration tracking, nozzle inspections, and maintenance records"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Equipment Table */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Spraying Equipment Inventory</h2>
              <span className="text-xs text-gray-500 font-mono">Total Units: {equipmentList?.length || 0}</span>
            </div>

            {!equipmentList || equipmentList.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <span className="text-3xl block mb-2">🔧</span>
                <p className="font-medium text-gray-700">No equipment registered.</p>
                <p className="text-xs text-gray-400 mt-1">Register sprayers, foggers, and nozzles to track calibration.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                    <tr>
                      <th className="px-4 py-3">Equipment Name</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Assigned Polyhouse</th>
                      <th className="px-4 py-3">Brand / Model</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {equipmentList.map((eq) => (
                      <tr key={eq.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {eq.name}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-medium">
                          {eq.equipment_type}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {eq.houses?.name || 'General Farm Equipment'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono">
                          {eq.brand_model || 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={eq.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Add Equipment Form */}
        {canManage && (
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs h-fit">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Add Equipment</h2>
            <p className="text-xs text-gray-500 mb-4">Register a sprayer or application device.</p>

            <form action={addEquipment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Equipment Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Battery Sprayer #1, HTP Pump A"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Equipment Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="equipment_type"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="Battery Knapsack Sprayer (16L)">Battery Knapsack Sprayer (16L)</option>
                  <option value="Manual Knapsack Sprayer">Manual Knapsack Sprayer</option>
                  <option value="HTP Power Sprayer Trolley">HTP Power Sprayer Trolley</option>
                  <option value="Cold Fogger Machine">Cold Fogger Machine</option>
                  <option value="Drip Fertigation Venturi / Doser">Drip Fertigation Venturi / Doser</option>
                  <option value="Boom Sprayer">Boom Sprayer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Brand / Model
                </label>
                <input
                  type="text"
                  name="brand_model"
                  placeholder="e.g. Aspee 16L 12V-8Ah, Honda GX160"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Assigned Polyhouse
                </label>
                <select
                  name="house_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Farm General Store</option>
                  {houses?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Maintenance / Calibration Notes
                </label>
                <textarea
                  name="maintenance_notes"
                  rows={2}
                  placeholder="e.g. Hollow cone nozzle calibrated to 450 ml/min output at 3 bar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
              >
                Register Equipment
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

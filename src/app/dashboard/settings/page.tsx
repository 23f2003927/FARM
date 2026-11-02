import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { revalidatePath } from 'next/cache'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles, farms(*)')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user?.id)
    .single()

  const farm = (Array.isArray(memberships?.farms) ? memberships.farms[0] : memberships?.farms) as { id: string; name: string; location: string | null } | undefined
  const isOwner = memberships?.roles?.includes('owner')

  // Server Action: Update Farm Details
  async function updateFarm(formData: FormData) {
    'use server'
    const name = formData.get('farm_name') as string
    const location = formData.get('farm_location') as string

    if (!name?.trim()) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && m.roles.includes('owner')) {
      await supabase
        .from('farms')
        .update({
          name: name.trim(),
          location: location?.trim() || null,
        })
        .eq('id', m.farm_id)

      revalidatePath('/dashboard/settings')
    }
  }

  // Server Action: Update Profile
  async function updateProfile(formData: FormData) {
    'use server'
    const fullName = formData.get('full_name') as string
    const phone = formData.get('phone') as string
    const lang = formData.get('preferred_language') as string

    if (!fullName?.trim()) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user?.id) {
      await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone?.trim() || null,
          preferred_language: lang || 'en',
        })
        .eq('id', user.id)

      revalidatePath('/dashboard/settings')
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <PageHeader
        title="Farm & System Settings"
        description="Manage your farm identity, operating location, and personal account preferences"
      />

      {/* Farm Details Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs p-6">
        <h2 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4">
          Farm Profile & Scoping
        </h2>

        <form action={updateFarm} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Farm Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="farm_name"
                defaultValue={farm?.name || ''}
                disabled={!isOwner}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Farm Location / Region
              </label>
              <input
                type="text"
                name="farm_location"
                defaultValue={farm?.location || ''}
                disabled={!isOwner}
                placeholder="e.g. Pune, Maharashtra, India"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50"
              />
            </div>
          </div>

          <div className="pt-2 text-xs font-mono text-gray-400">
            Internal Farm ID: {farm?.id}
          </div>

          {isOwner && (
            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
              >
                Update Farm Settings
              </button>
            </div>
          )}
        </form>
      </div>

      {/* User Account Settings */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs p-6">
        <h2 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4">
          Your Account & Language
        </h2>

        <form action={updateProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="full_name"
                defaultValue={profile?.full_name || ''}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="text"
                name="phone"
                defaultValue={profile?.phone || ''}
                placeholder="e.g. +91 98765 43210"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Registered Email (Auth)
              </label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 text-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Preferred Interface Language
              </label>
              <select
                name="preferred_language"
                defaultValue={profile?.preferred_language || 'en'}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="en">English (Default)</option>
                <option value="hi">हिंदी (Hindi - Supervisor First)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              type="submit"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
            >
              Save Profile Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

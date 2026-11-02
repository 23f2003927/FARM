import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { ROLES, ROLE_LABELS, type Role } from '@/types/enums'

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const isOwner = memberships?.roles?.includes('owner')

  if (!isOwner) {
    redirect('/dashboard')
  }

  // Get all members of the farm with profiles
  const { data: teamMembers } = await supabase
    .from('farm_memberships')
    .select('*, profiles(*)')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: true })

  // Server Action: Add member by user ID
  async function addMember(formData: FormData) {
    'use server'
    const targetUserId = formData.get('user_id') as string
    const roleValues = formData.getAll('roles') as Role[]

    if (!targetUserId?.trim() || roleValues.length === 0) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('owner')) {
      await supabase.from('farm_memberships').upsert({
        farm_id: m.farm_id,
        user_id: targetUserId.trim(),
        roles: roleValues,
        status: 'active',
        assigned_by: user?.id,
        assigned_at: new Date().toISOString(),
      }, { onConflict: 'farm_id,user_id' })

      revalidatePath('/dashboard/team')
    }
  }

  // Server Action: Revoke membership
  async function revokeMembership(formData: FormData) {
    'use server'
    const membershipId = formData.get('membership_id') as string
    if (!membershipId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('owner')) {
      await supabase
        .from('farm_memberships')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
        })
        .eq('id', membershipId)
        .eq('farm_id', m.farm_id)

      revalidatePath('/dashboard/team')
    }
  }

  return (
    <div>
      <PageHeader
        title="Team & Role Permissions"
        description="Assign five discrete operational roles: Owner, Agronomist, Procurement, Supervisor, Verifier"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Members List */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Current Farm Operators</h2>
              <span className="text-xs text-gray-500 font-mono">Members: {teamMembers?.length || 0}</span>
            </div>

            <div className="divide-y divide-gray-100">
              {teamMembers?.map((member) => (
                <div key={member.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">
                        {member.profiles?.full_name || 'Unset Name'}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        member.status === 'active'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {member.status}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 font-mono block mt-0.5">
                      User ID: {member.user_id}
                    </span>

                    {/* Roles Badges */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {member.roles?.map((r: Role) => (
                        <span
                          key={r}
                          className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"
                        >
                          {ROLE_LABELS[r] || r}
                        </span>
                      ))}
                    </div>
                  </div>

                  {member.user_id !== user?.id && member.status === 'active' && (
                    <form action={revokeMembership}>
                      <input type="hidden" name="membership_id" value={member.id} />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded border border-red-200 transition-colors"
                      >
                        Revoke Access
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add Member Form */}
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs h-fit">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Assign Farm Roles</h2>
          <p className="text-xs text-gray-500 mb-4">
            Add a registered user to this farm by their Supabase Auth User ID.
          </p>

          <form action={addMember} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                User ID (UUID) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="user_id"
                placeholder="e.g. 914cd1cc-f776-4796-b92a..."
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-mono outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-[11px] text-gray-400 mt-0.5 block">
                Found in your Supabase Dashboard &gt; Authentication &gt; Users.
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Operational Roles (Select at least one) <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2 bg-gray-50 p-3 rounded border border-gray-200">
                {Object.values(ROLES).map((role) => (
                  <label key={role} className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      name="roles"
                      value={role}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span>{ROLE_LABELS[role]}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              Assign Role & Grant Access
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}


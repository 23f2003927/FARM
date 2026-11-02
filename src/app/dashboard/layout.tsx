import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import type { Role } from '@/types/enums'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fetch active farm memberships
  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('*, farms(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')

  const activeMembership = memberships?.[0]
  const farmName = activeMembership?.farms?.name || 'My Farm'
  const userRoles = (activeMembership?.roles || []) as Role[]
  const userName = profile?.full_name || user.email?.split('@')[0] || 'User'

  // If user has no farm membership, show pending setup state
  if (!activeMembership) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="text-4xl mb-3">🏡</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to SmartFarm</h2>
          <p className="text-sm text-gray-600 mb-6">
            Your account ({user.email}) is active, but you have not been linked to a farm yet.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-left text-amber-800 space-y-2 mb-6">
            <p className="font-semibold">Initial Setup Instructions:</p>
            <p>1. If you are the Farm Owner, run the bootstrap SQL function in your Supabase SQL editor using your user ID:</p>
            <code className="block bg-amber-100/80 p-2 rounded text-[11px] font-mono break-all select-all">
              SELECT public.fn_bootstrap_farm('{user.id}', 'My Green Polyhouse', 'Maharashtra, India');
            </code>
            <p>2. If you are an Agronomist, Supervisor, or Verifier, ask your Farm Owner to add you from the Team management page.</p>
          </div>
          <form action="/login" method="GET">
            <button
              type="submit"
              className="w-full py-2 px-4 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
            >
              Check Again
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        userRoles={userRoles}
        userName={userName}
        farmName={farmName}
      />
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

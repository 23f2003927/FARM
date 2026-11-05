import { cache } from 'react'
import { createClient } from './server'
import type { FarmMembership, UserProfile } from '@/types/app'

/**
 * Per-request memoized helper to fetch the authenticated user.
 * Avoids multiple redundant HTTPS auth calls during the same server render pass.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

/**
 * Per-request memoized helper to fetch active farm membership.
 * Layout and child pages can call this freely without duplicating queries.
 */
export const getCachedFarmMembership = cache(async (userId?: string) => {
  const uid = userId || (await getCachedUser())?.id
  if (!uid) return null

  const supabase = await createClient()
  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('*, farms(*)')
    .eq('user_id', uid)
    .eq('status', 'active')

  return (memberships?.[0] as (FarmMembership & { farms: any })) || null
})

/**
 * Per-request memoized helper to fetch user profile.
 */
export const getCachedProfile = cache(async (userId?: string) => {
  const uid = userId || (await getCachedUser())?.id
  if (!uid) return null

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .single()

  return (profile as UserProfile) || null
})


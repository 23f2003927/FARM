import type { Role } from './enums'

export interface UserProfile {
  id: string
  full_name: string
  phone: string | null
  preferred_language: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Farm {
  id: string
  name: string
  location: string | null
  owner_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FarmMembership {
  id: string
  farm_id: string
  user_id: string
  roles: Role[]
  status: 'active' | 'inactive' | 'revoked'
  assigned_by: string | null
  assigned_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
  profiles?: UserProfile
  farms?: Farm
}

export interface House {
  id: string
  farm_id: string
  name: string
  description: string | null
  area_sqm: number | null
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
}

export interface Zone {
  id: string
  house_id: string
  farm_id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface CropCycle {
  id: string
  farm_id: string
  house_id: string
  zone_id: string | null
  crop_name: string
  variety: string | null
  planting_date: string
  growth_stage: string | null
  expected_harvest_start: string | null
  expected_harvest_end: string | null
  status: 'planning' | 'active' | 'harvesting' | 'completed' | 'abandoned'
  notes: string | null
  created_at: string
  updated_at: string
  houses?: House
  zones?: Zone
}

export interface NavItem {
  label: string
  href: string
  icon: string
  roles?: Role[]
}

export interface FarmContext {
  farm: Farm
  membership: FarmMembership
  roles: Role[]
}

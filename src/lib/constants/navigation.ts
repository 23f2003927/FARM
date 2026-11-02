import type { NavItem } from '@/types/app'

export const NAVIGATION_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'Farm Structure', href: '/dashboard/farm', icon: '🏠', roles: ['owner'] },
  { label: 'Treatment Plans', href: '/dashboard/treatment-plans', icon: '📋', roles: ['owner', 'agronomist', 'procurement'] },
  { label: 'Product Catalogue', href: '/dashboard/products', icon: '🧪', roles: ['owner', 'agronomist', 'procurement', 'supervisor'] },
  { label: 'Inventory', href: '/dashboard/inventory', icon: '📦', roles: ['owner', 'procurement'] },
  { label: 'Procurement', href: '/dashboard/procurement', icon: '🛒', roles: ['owner', 'procurement'] },
  { label: 'Work Orders', href: '/dashboard/work-orders', icon: '📝', roles: ['owner', 'agronomist', 'supervisor', 'verifier'] },
  { label: 'Applications', href: '/dashboard/applications', icon: '✅', roles: ['owner', 'agronomist', 'verifier'] },
  { label: 'Equipment', href: '/dashboard/equipment', icon: '🔧', roles: ['owner', 'supervisor'] },
  { label: 'Crop Health', href: '/dashboard/crop-health', icon: '🌱', roles: ['owner', 'agronomist', 'supervisor', 'verifier'] },
  { label: 'Team', href: '/dashboard/team', icon: '👥', roles: ['owner'] },
  { label: 'Reports', href: '/dashboard/reports', icon: '📈', roles: ['owner', 'agronomist', 'procurement'] },
  { label: 'Settings', href: '/dashboard/settings', icon: '⚙️', roles: ['owner'] },
]

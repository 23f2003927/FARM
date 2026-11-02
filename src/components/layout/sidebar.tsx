'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { NAVIGATION_ITEMS } from '@/lib/constants/navigation'
import type { Role } from '@/types/enums'
import { ROLE_LABELS } from '@/types/enums'
import { useState } from 'react'

interface SidebarProps {
  userRoles: Role[]
  userName: string
  farmName: string
}

export function Sidebar({ userRoles, userName, farmName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const visibleItems = NAVIGATION_ITEMS.filter((item) => {
    if (!item.roles) return true
    return item.roles.some((role) => userRoles.includes(role))
  })

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-green-700">SmartFarm</h1>
        <p className="text-xs text-gray-500 truncate">{farmName}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-green-50 text-green-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User info & Signout */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="mb-2">
          <p className="text-sm font-medium text-gray-900 truncate">{userName || 'User'}</p>
          <p className="text-xs text-gray-500">
            {userRoles.length > 0 ? userRoles.map((r) => ROLE_LABELS[r] || r).join(', ') : 'No Role Assigned'}
          </p>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 bg-white rounded-md shadow-md border border-gray-200 text-gray-700"
        aria-label="Toggle navigation"
      >
        <span className="text-xl leading-none">{mobileOpen ? '✕' : '☰'}</span>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - mobile */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-gray-200">
        {sidebarContent}
      </aside>
    </>
  )
}

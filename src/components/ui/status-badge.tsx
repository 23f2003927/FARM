const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  planning: 'bg-blue-50 text-blue-700 border-blue-200',
  draft: 'bg-gray-50 text-gray-700 border-gray-200',
  pending_approval: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  needs_clarification: 'bg-orange-50 text-orange-700 border-orange-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  released: 'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  unverified: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  pending_verification: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  operational: 'bg-green-50 text-green-700 border-green-200',
  inactive: 'bg-gray-50 text-gray-500 border-gray-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
  quarantined: 'bg-orange-50 text-orange-700 border-orange-200',
  available: 'bg-green-50 text-green-700 border-green-200',
  harvesting: 'bg-amber-50 text-amber-700 border-amber-200',
  abandoned: 'bg-gray-50 text-gray-500 border-gray-200',
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || 'bg-gray-50 text-gray-700 border-gray-200'
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style} ${className}`}
    >
      {label}
    </span>
  )
}


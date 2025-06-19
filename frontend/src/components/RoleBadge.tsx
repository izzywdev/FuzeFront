import React from 'react'

interface RoleBadgeProps {
  role: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'solid' | 'outline' | 'subtle'
  interactive?: boolean
  onClick?: () => void
  showIcon?: boolean
  className?: string
}

export const RoleBadge: React.FC<RoleBadgeProps> = ({
  role,
  size = 'md',
  variant = 'solid',
  interactive = false,
  onClick,
  showIcon = true,
  className = '',
}) => {
  const getRoleConfig = (role: string) => {
    const configs = {
      owner: {
        icon: '👑',
        label: 'Owner',
        colors: {
          solid: 'bg-purple-600 text-white',
          outline: 'border-purple-600 text-purple-600 bg-transparent',
          subtle: 'bg-purple-100 text-purple-800 border-purple-200',
        },
      },
      admin: {
        icon: '🛡️',
        label: 'Admin',
        colors: {
          solid: 'bg-blue-600 text-white',
          outline: 'border-blue-600 text-blue-600 bg-transparent',
          subtle: 'bg-blue-100 text-blue-800 border-blue-200',
        },
      },
      member: {
        icon: '👤',
        label: 'Member',
        colors: {
          solid: 'bg-green-600 text-white',
          outline: 'border-green-600 text-green-600 bg-transparent',
          subtle: 'bg-green-100 text-green-800 border-green-200',
        },
      },
      viewer: {
        icon: '👁️',
        label: 'Viewer',
        colors: {
          solid: 'bg-gray-600 text-white',
          outline: 'border-gray-600 text-gray-600 bg-transparent',
          subtle: 'bg-gray-100 text-gray-800 border-gray-200',
        },
      },
      moderator: {
        icon: '⚖️',
        label: 'Moderator',
        colors: {
          solid: 'bg-orange-600 text-white',
          outline: 'border-orange-600 text-orange-600 bg-transparent',
          subtle: 'bg-orange-100 text-orange-800 border-orange-200',
        },
      },
      guest: {
        icon: '🔓',
        label: 'Guest',
        colors: {
          solid: 'bg-gray-400 text-white',
          outline: 'border-gray-400 text-gray-400 bg-transparent',
          subtle: 'bg-gray-50 text-gray-600 border-gray-300',
        },
      },
    }

    return (
      configs[role.toLowerCase() as keyof typeof configs] || {
        icon: '❓',
        label: role.charAt(0).toUpperCase() + role.slice(1),
        colors: {
          solid: 'bg-gray-500 text-white',
          outline: 'border-gray-500 text-gray-500 bg-transparent',
          subtle: 'bg-gray-100 text-gray-700 border-gray-300',
        },
      }
    )
  }

  const getSizeClasses = (size: string) => {
    switch (size) {
      case 'sm':
        return 'px-2 py-1 text-xs'
      case 'md':
        return 'px-3 py-1 text-sm'
      case 'lg':
        return 'px-4 py-2 text-base'
      default:
        return 'px-3 py-1 text-sm'
    }
  }

  const config = getRoleConfig(role)
  const baseClasses =
    'inline-flex items-center font-medium rounded-full border transition-colors duration-200'
  const sizeClasses = getSizeClasses(size)
  const colorClasses = config.colors[variant]
  const interactiveClasses = interactive
    ? 'cursor-pointer hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
    : ''

  const badgeClasses = `${baseClasses} ${sizeClasses} ${colorClasses} ${interactiveClasses} ${className}`

  const handleClick = () => {
    if (interactive && onClick) {
      onClick()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (interactive && onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <span
      className={badgeClasses}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={`Role: ${config.label}`}
      title={`Role: ${config.label}`}
    >
      {showIcon && (
        <span className="mr-1" aria-hidden="true">
          {config.icon}
        </span>
      )}
      <span>{config.label}</span>
    </span>
  )
}

// Convenience components for specific roles
export const OwnerBadge: React.FC<Omit<RoleBadgeProps, 'role'>> = props => (
  <RoleBadge role="owner" {...props} />
)

export const AdminBadge: React.FC<Omit<RoleBadgeProps, 'role'>> = props => (
  <RoleBadge role="admin" {...props} />
)

export const MemberBadge: React.FC<Omit<RoleBadgeProps, 'role'>> = props => (
  <RoleBadge role="member" {...props} />
)

export const ViewerBadge: React.FC<Omit<RoleBadgeProps, 'role'>> = props => (
  <RoleBadge role="viewer" {...props} />
)

// Role comparison utilities
export const getRoleLevel = (role: string): number => {
  const levels = {
    owner: 5,
    admin: 4,
    moderator: 3,
    member: 2,
    viewer: 1,
    guest: 0,
  }
  return levels[role.toLowerCase() as keyof typeof levels] || 0
}

export const isHigherRole = (role1: string, role2: string): boolean => {
  return getRoleLevel(role1) > getRoleLevel(role2)
}

export const canManageRole = (
  userRole: string,
  targetRole: string
): boolean => {
  // Users can only manage roles lower than their own
  return getRoleLevel(userRole) > getRoleLevel(targetRole)
}

export default RoleBadge

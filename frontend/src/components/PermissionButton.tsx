import React from 'react'
import { usePermissions } from './PermissionGate'

interface PermissionButtonProps {
  requiredPermission: string
  onClick: () => void
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  className?: string
  fallback?: React.ReactNode
  showTooltip?: boolean
  tooltipText?: string
}

export const PermissionButton: React.FC<PermissionButtonProps> = ({
  requiredPermission,
  onClick,
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  fallback = null,
  showTooltip = true,
  tooltipText,
}) => {
  const { hasPermission, user, isAuthenticated } = usePermissions()
  const [hasAccess, setHasAccess] = React.useState<boolean | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    checkAccess()
  }, [requiredPermission, user])

  const checkAccess = async () => {
    if (!isAuthenticated || !user) {
      setHasAccess(false)
      setIsLoading(false)
      return
    }

    try {
      const access = await hasPermission(requiredPermission)
      setHasAccess(access)
    } catch (error) {
      console.error('Permission check error:', error)
      setHasAccess(false)
    } finally {
      setIsLoading(false)
    }
  }

  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200'

  const variantClasses = {
    primary:
      'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:bg-blue-300',
    secondary:
      'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500 disabled:bg-gray-100',
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 disabled:bg-red-300',
    success:
      'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 disabled:bg-green-300',
  }

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }

  // Show loading state
  if (isLoading) {
    return (
      <button
        disabled
        className={`${baseClasses} ${variantClasses.secondary} ${sizeClasses[size]} cursor-not-allowed opacity-50`}
      >
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        Loading...
      </button>
    )
  }

  // Don't render anything if no permission and no fallback
  if (!hasAccess && !fallback) {
    return null
  }

  // Render fallback if no permission
  if (!hasAccess && fallback) {
    return <>{fallback}</>
  }

  const isDisabled = disabled || loading || isLoading
  const buttonClasses = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className} ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`

  const defaultTooltip = `Requires ${requiredPermission} permission`
  const tooltip = tooltipText || defaultTooltip

  return (
    <div className="relative inline-block">
      <button
        onClick={onClick}
        disabled={isDisabled}
        className={buttonClasses}
        title={showTooltip ? tooltip : undefined}
        aria-label={showTooltip ? tooltip : undefined}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        )}
        {children}
      </button>
    </div>
  )
}

// Convenience components for common permission patterns
export const AdminButton: React.FC<
  Omit<PermissionButtonProps, 'requiredPermission'>
> = props => (
  <PermissionButton requiredPermission="admin" variant="primary" {...props} />
)

export const OwnerButton: React.FC<
  Omit<PermissionButtonProps, 'requiredPermission'>
> = props => (
  <PermissionButton requiredPermission="owner" variant="danger" {...props} />
)

export const MemberButton: React.FC<
  Omit<PermissionButtonProps, 'requiredPermission'>
> = props => (
  <PermissionButton
    requiredPermission="member"
    variant="secondary"
    {...props}
  />
)

export const EditButton: React.FC<
  Omit<PermissionButtonProps, 'requiredPermission'>
> = props => (
  <PermissionButton
    requiredPermission="edit"
    variant="primary"
    size="sm"
    {...props}
  />
)

export const DeleteButton: React.FC<
  Omit<PermissionButtonProps, 'requiredPermission'>
> = props => (
  <PermissionButton
    requiredPermission="delete"
    variant="danger"
    size="sm"
    {...props}
  />
)

export default PermissionButton

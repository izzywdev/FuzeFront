import React, { useState, useEffect } from 'react'
import { useCurrentUser } from '../lib/shared'
import { checkPermissions, getUserRoles } from '../services/api'

interface PermissionGateProps {
  children: React.ReactNode
  requiredPermissions?: string[]
  requiredRoles?: string[]
  organizationId?: string
  fallback?: React.ReactNode
  loading?: React.ReactNode
  requireAll?: boolean // If true, user must have ALL permissions/roles. If false, ANY will suffice
}

export function PermissionGate({
  children,
  requiredPermissions = [],
  requiredRoles = [],
  organizationId,
  fallback = null,
  loading = <div style={{ opacity: 0.6 }}>🔄 Checking permissions...</div>,
  requireAll = false,
}: PermissionGateProps) {
  const { user, isAuthenticated } = useCurrentUser()
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkPermissionsAsync()
  }, [user, requiredPermissions, requiredRoles, organizationId])

  const checkPermissionsAsync = async () => {
    setIsLoading(true)

    try {
      // If not authenticated, deny access
      if (!isAuthenticated || !user) {
        setHasPermission(false)
        setIsLoading(false)
        return
      }

      // If no permissions or roles required, allow access
      if (requiredPermissions.length === 0 && requiredRoles.length === 0) {
        setHasPermission(true)
        setIsLoading(false)
        return
      }

      let hasRequiredRoles = true
      let hasRequiredPermissions = true

      // Check role-based permissions
      if (requiredRoles.length > 0) {
        try {
          const userRoles = await getUserRoles(organizationId)

          if (requireAll) {
            // User must have ALL required roles
            hasRequiredRoles = requiredRoles.every(role =>
              userRoles.includes(role)
            )
          } else {
            // User must have ANY of the required roles
            hasRequiredRoles = requiredRoles.some(role =>
              userRoles.includes(role)
            )
          }
        } catch (error) {
          console.error('Error checking user roles:', error)
          hasRequiredRoles = false
        }
      }

      // Check permission-based access using real API
      if (requiredPermissions.length > 0) {
        try {
          hasRequiredPermissions = await checkPermissions(
            requiredPermissions,
            organizationId,
            requireAll
          )
        } catch (error) {
          console.error('Error checking permissions:', error)
          hasRequiredPermissions = false
        }
      }

      // Determine final permission based on requireAll flag
      const finalPermission = requireAll
        ? hasRequiredRoles && hasRequiredPermissions
        : hasRequiredRoles || hasRequiredPermissions

      setHasPermission(finalPermission)
    } catch (error) {
      console.error('Permission check error:', error)
      setHasPermission(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Show loading state
  if (isLoading) {
    return <>{loading}</>
  }

  // Show children if user has permission
  if (hasPermission) {
    return <>{children}</>
  }

  // Show fallback if provided, otherwise render nothing
  return <>{fallback}</>
}

// Convenience hook for permission checking
export function usePermissions() {
  const { user, isAuthenticated } = useCurrentUser()

  const hasRole = async (
    roles: string | string[],
    organizationId?: string
  ): Promise<boolean> => {
    if (!isAuthenticated || !user) return false

    try {
      const userRoles = await getUserRoles(organizationId)
      const roleArray = Array.isArray(roles) ? roles : [roles]
      return roleArray.some(role => userRoles.includes(role))
    } catch (error) {
      console.error('Error checking roles:', error)
      return false
    }
  }

  const hasPermission = async (
    permissions: string | string[],
    organizationId?: string,
    requireAll = false
  ): Promise<boolean> => {
    if (!isAuthenticated || !user) return false

    try {
      return await checkPermissions(permissions, organizationId, requireAll)
    } catch (error) {
      console.error('Error checking permissions:', error)
      return false
    }
  }

  return {
    hasRole,
    hasPermission,
    user,
    isAuthenticated,
  }
}

// Higher-order component for permission-based rendering
export function withPermissions<P extends object>(
  Component: React.ComponentType<P>,
  requiredPermissions: string[] = [],
  requiredRoles: string[] = [],
  fallback?: React.ReactNode
) {
  return function ProtectedComponent(props: P) {
    return (
      <PermissionGate
        requiredPermissions={requiredPermissions}
        requiredRoles={requiredRoles}
        fallback={fallback}
      >
        <Component {...props} />
      </PermissionGate>
    )
  }
}

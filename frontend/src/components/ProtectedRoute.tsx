import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PermissionGate, usePermissions } from './PermissionGate'
import { useCurrentUser } from '../lib/shared'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredPermissions?: string[]
  requiredRoles?: string[]
  organizationId?: string
  requireAll?: boolean
  redirectTo?: string
  showFallback?: boolean
  fallbackComponent?: React.ComponentType
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermissions = [],
  requiredRoles = [],
  organizationId,
  requireAll = false,
  redirectTo = '/login',
  showFallback = true,
  fallbackComponent: FallbackComponent,
}) => {
  const { isAuthenticated } = useCurrentUser()
  const location = useLocation()

  // If not authenticated, redirect to login with return URL
  if (!isAuthenticated) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />
  }

  // Default fallback component
  const DefaultFallback =
    FallbackComponent ||
    (() => (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Access Denied
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            You don't have the required permissions to access this page.
          </p>
          <div className="text-xs text-gray-400">
            {requiredRoles.length > 0 && (
              <p>Required roles: {requiredRoles.join(', ')}</p>
            )}
            {requiredPermissions.length > 0 && (
              <p>Required permissions: {requiredPermissions.join(', ')}</p>
            )}
          </div>
          <button
            onClick={() => window.history.back()}
            className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Go Back
          </button>
        </div>
      </div>
    ))

  return (
    <PermissionGate
      requiredPermissions={requiredPermissions}
      requiredRoles={requiredRoles}
      organizationId={organizationId}
      requireAll={requireAll}
      fallback={showFallback ? <DefaultFallback /> : null}
      loading={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <svg
              className="animate-spin -ml-1 mr-3 h-8 w-8 text-blue-600 mx-auto"
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
            <p className="mt-2 text-sm text-gray-500">
              Checking permissions...
            </p>
          </div>
        </div>
      }
    >
      {children}
    </PermissionGate>
  )
}

// Convenience components for common route protection patterns
export const AdminRoute: React.FC<
  Omit<ProtectedRouteProps, 'requiredRoles'>
> = props => <ProtectedRoute requiredRoles={['admin']} {...props} />

export const OwnerRoute: React.FC<
  Omit<ProtectedRouteProps, 'requiredRoles'>
> = props => <ProtectedRoute requiredRoles={['owner']} {...props} />

export const MemberRoute: React.FC<
  Omit<ProtectedRouteProps, 'requiredRoles'>
> = props => (
  <ProtectedRoute
    requiredRoles={['member', 'admin', 'owner']}
    requireAll={false}
    {...props}
  />
)

export const AuthenticatedRoute: React.FC<
  Omit<ProtectedRouteProps, 'requiredRoles' | 'requiredPermissions'>
> = props => <ProtectedRoute {...props} />

// Higher-order component for protecting route components
export function withRouteProtection<P extends object>(
  Component: React.ComponentType<P>,
  protectionConfig: Omit<ProtectedRouteProps, 'children'>
) {
  return function ProtectedRouteComponent(props: P) {
    return (
      <ProtectedRoute {...protectionConfig}>
        <Component {...props} />
      </ProtectedRoute>
    )
  }
}

export default ProtectedRoute

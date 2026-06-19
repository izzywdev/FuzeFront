export type ProvisioningState = 'loading' | 'timeout' | 'error'

export interface ProvisioningCardProps {
  state: ProvisioningState
  title?: string
  description?: string
  onRetry?: () => void
}

const DEFAULT_TITLES: Record<ProvisioningState, string> = {
  loading: 'Creating your workspace…',
  timeout: 'Taking longer than expected',
  error: 'Something went wrong',
}

const DEFAULT_DESCRIPTIONS: Record<ProvisioningState, string> = {
  loading: 'Setting up your personal organization. This takes a moment.',
  timeout: 'Your workspace is still being created.',
  error: "We couldn't verify your workspace.",
}

export function ProvisioningCard({
  state,
  title,
  description,
  onRetry,
}: ProvisioningCardProps) {
  const resolvedTitle = title ?? DEFAULT_TITLES[state]
  const resolvedDescription = description ?? DEFAULT_DESCRIPTIONS[state]

  return (
    <div className="provisioning-card">
      {state === 'loading' && (
        <div
          className="provisioning-spinner"
          role="status"
          aria-label={resolvedTitle}
        />
      )}

      <p className="provisioning-title">{resolvedTitle}</p>
      <p className="provisioning-description">{resolvedDescription}</p>

      {(state === 'timeout' || state === 'error') && onRetry && (
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

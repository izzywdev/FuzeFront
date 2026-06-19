import { useLanguage } from '../contexts/LanguageContext'

export type ProvisioningState = 'loading' | 'timeout' | 'error'

export interface ProvisioningCardProps {
  state: ProvisioningState
  title?: string
  description?: string
  onRetry?: () => void
}

export function ProvisioningCard({
  state,
  title,
  description,
  onRetry,
}: ProvisioningCardProps) {
  const { t } = useLanguage()

  const DEFAULT_TITLES: Record<ProvisioningState, string> = {
    loading: t('provisioningTitle'),
    timeout: t('provisioningTimeout'),
    error: t('provisioningError'),
  }

  const DEFAULT_DESCRIPTIONS: Record<ProvisioningState, string> = {
    loading: t('provisioningDescription'),
    timeout: t('provisioningTimeoutDesc'),
    error: t('provisioningErrorDesc'),
  }

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
          {t('provisioningRetry')}
        </button>
      )}
    </div>
  )
}

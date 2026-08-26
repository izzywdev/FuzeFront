import { Alert, Button } from '@fuzefront/design-system';

export interface ConnectErrorNoticeProps {
  /** Machine error code rendered as `data-error-code` (e.g. 'CONNECT_RESTRICTED', 'LOAD_FAILED'). */
  errorCode: string;
  title: string;
  children: string;
  actionLabel?: string;
  /** `data-action` hook for the recovery button. */
  actionName?: string;
  onAction?: () => void;
}

/**
 * Shared error/restricted banner for the Connect section — covers both a
 * generic load failure (09-portal-states i4/i9-style "couldn't load" +
 * retry) and the Stripe-restricted account state (i9, CONNECT_RESTRICTED +
 * "Continue onboarding"). Never blank: every failure here is actionable.
 */
export function ConnectErrorNotice({
  errorCode,
  title,
  children,
  actionLabel,
  actionName,
  onAction,
}: ConnectErrorNoticeProps) {
  return (
    <div data-error-code={errorCode}>
      <Alert tone="error" title={title} role="alert">
        {children}
      </Alert>
      {onAction && actionLabel && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="primary" onClick={onAction} data-action={actionName}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

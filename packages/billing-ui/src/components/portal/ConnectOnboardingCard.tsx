import { Button, EmptyState, Skeleton, StatusPill } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';
import type { ConnectStatus } from '../../api/portalBillingClient';
import { ConnectStatusStepper } from './ConnectStatusStepper';
import { ConnectErrorNotice } from './ConnectErrorNotice';

export type ConnectLoadState = 'loading' | 'ready' | 'error';

export interface ConnectOnboardingCardProps {
  loadState: ConnectLoadState;
  status: ConnectStatus | null;
  busy?: boolean;
  onStartOnboarding: () => void;
  onContinueOnboarding: () => void;
  onReonboard: () => void;
  onOpenDashboard?: () => void;
  onRetry: () => void;
}

/**
 * "Reseller payouts · Connect" panel — the Stripe Connect onboarding state
 * machine (design/frames/portal-admin-consoles 08-billing + 09-portal-
 * states i7-i9). Anticipated data (FF-EPIC-15-S2/S3): `status` comes from
 * `PortalBillingClient.getConnectStatus()`, which 404s until that backend
 * ships — the caller passes `loadState="error"` for that case and this
 * renders the same actionable "couldn't load" banner rather than a crash.
 */
export function ConnectOnboardingCard({
  loadState,
  status,
  busy,
  onStartOnboarding,
  onContinueOnboarding,
  onReonboard,
  onOpenDashboard,
  onRetry,
}: ConnectOnboardingCardProps) {
  const { strings } = useBillingI18n();

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        marginBlockEnd: 'var(--space-4)',
      }}
    >
      <div>
        <h2 style={{ margin: 0 }}>{strings.connectHeading}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{strings.connectSub}</p>
      </div>
      {loadState === 'ready' && status && (
        <StatusPill
          status={status.status}
          label={status.status === 'active' ? strings.connectOnboardedLabel : undefined}
        />
      )}
    </div>
  );

  return (
    <section
      data-panel="connect-status"
      data-connect-status={loadState === 'ready' && status ? status.status : undefined}
      data-state={loadState === 'loading' ? 'loading' : loadState === 'error' ? 'error' : undefined}
      aria-busy={loadState === 'loading' || undefined}
      aria-label={strings.connectHeading}
    >
      {header}

      {loadState === 'loading' && (
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Skeleton height="var(--space-12)" />
          <Skeleton height="var(--space-12)" />
          <Skeleton height="var(--space-12)" />
        </div>
      )}

      {loadState === 'error' && (
        <ConnectErrorNotice
          errorCode="LOAD_FAILED"
          title={strings.connectErrorHeading}
          actionLabel={strings.retry}
          actionName="retry"
          onAction={onRetry}
        >
          {strings.connectErrorBody}
        </ConnectErrorNotice>
      )}

      {loadState === 'ready' && status?.status === 'not-started' && (
        <EmptyState
          title={strings.connectNotStartedTitle}
          body={strings.connectNotStartedBody}
          action={
            <Button variant="primary" onClick={onStartOnboarding} disabled={busy} data-action="start-connect-onboarding">
              {strings.startOnboardingAction}
            </Button>
          }
        />
      )}

      {loadState === 'ready' && status?.status === 'in-progress' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <ConnectStatusStepper steps={status.steps} />
          <div>
            <Button variant="primary" onClick={onContinueOnboarding} disabled={busy} data-action="continue-connect-onboarding">
              {strings.continueOnboardingAction}
            </Button>
          </div>
        </div>
      )}

      {loadState === 'ready' && status?.status === 'restricted' && (
        <ConnectErrorNotice
          errorCode="CONNECT_RESTRICTED"
          title={strings.connectRestrictedTitle}
          actionLabel={strings.continueOnboardingAction}
          actionName="reonboard-connect"
          onAction={onReonboard}
        >
          {strings.connectRestrictedBody}
        </ConnectErrorNotice>
      )}

      {loadState === 'ready' && status?.status === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <ConnectStatusStepper steps={status.steps} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {onOpenDashboard && (
              <Button variant="secondary" onClick={onOpenDashboard} data-action="open-connect-dashboard">
                {strings.openConnectDashboardAction}
              </Button>
            )}
            <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              {strings.connectDashboardNote}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

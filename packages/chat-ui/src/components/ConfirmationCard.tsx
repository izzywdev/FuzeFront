import { useChatI18n } from '../i18n';
import type { PendingConfirmation } from '../hooks/types';

export interface ConfirmationCardProps {
  confirmation: PendingConfirmation;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
}

/**
 * Confirmation prompt for a mutating agent tool (tool_pending). The user must
 * explicitly approve before the backend executes the whitelisted tool via
 * POST /chat/confirm/:id. Resolves to an approved/denied summary.
 */
export function ConfirmationCard({ confirmation, onApprove, onCancel }: ConfirmationCardProps) {
  const { strings } = useChatI18n();
  const { confirmationId, toolName, description, status, summary } = confirmation;

  const resolved = status === 'approved' || status === 'denied';
  const running = status === 'running';

  return (
    <div className="ffc-confirm" role="group" aria-label={strings.confirmHeading}>
      <div className="ffc-confirm__heading">
        <span aria-hidden="true">⚠</span>
        <span>{strings.confirmHeading}</span>
      </div>
      <p className="ffc-confirm__desc">{description}</p>
      <code className="ffc-confirm__tool">{toolName}</code>

      {resolved ? (
        <p
          className={`ffc-confirm__resolved ffc-confirm__resolved--${status}`}
          role="status"
        >
          {summary ?? (status === 'approved' ? strings.toolApproved : strings.toolDenied)}
        </p>
      ) : (
        <div className="ffc-confirm__actions">
          <button
            type="button"
            className="ffc-btn ffc-btn--ghost"
            onClick={() => onCancel(confirmationId)}
            disabled={running}
          >
            {strings.confirmCancel}
          </button>
          <button
            type="button"
            className="ffc-btn ffc-btn--primary"
            onClick={() => onApprove(confirmationId)}
            disabled={running}
          >
            {running ? strings.confirmRunning : strings.confirmApprove}
          </button>
        </div>
      )}
    </div>
  );
}

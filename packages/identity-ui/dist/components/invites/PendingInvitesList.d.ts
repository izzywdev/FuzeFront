import type { Invitation, OrgRole } from '../../types';
export interface PendingInvitesListProps {
    invitations: Invitation[];
    loading?: boolean;
    error?: string | null;
    userRole: OrgRole;
    onResend: (invitationId: string) => Promise<void>;
    onRevoke: (invitationId: string) => Promise<void>;
    onRetry?: () => void;
}
/**
 * Pending invitations table with per-row resend and revoke. Revoke optimistically
 * hides the row; expired invitations show an error status pill.
 */
export declare function PendingInvitesList({ invitations, loading, error, userRole, onResend, onRevoke, onRetry, }: PendingInvitesListProps): import("react/jsx-runtime").JSX.Element;

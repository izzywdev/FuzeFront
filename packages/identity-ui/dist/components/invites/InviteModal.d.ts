import type { OrgRole } from '../../types';
export interface InviteModalProps {
    open: boolean;
    onClose: () => void;
    /** Sends a single invite. */
    onInvite: (email: string, role: OrgRole) => Promise<void>;
    /** Sends a batch; resolves with a summary. */
    onBulkInvite: (invitations: {
        email: string;
        role: OrgRole;
    }[]) => Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
    /** Called after any successful send so the host can refresh. */
    onSuccess?: (count: number) => void;
    defaultRole?: OrgRole;
}
/**
 * Two-tab invite dialog: Single (one email + role) and Bulk/CSV (textarea or
 * CSV drop). Built on the design-system Modal / Input / Select / Textarea /
 * FileDropZone. Result summary is announced via aria-live.
 */
export declare function InviteModal({ open, onClose, onInvite, onBulkInvite, onSuccess, defaultRole }: InviteModalProps): import("react/jsx-runtime").JSX.Element | null;

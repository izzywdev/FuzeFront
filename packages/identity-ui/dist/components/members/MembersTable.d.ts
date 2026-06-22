import type { Member, OrgRole } from '../../types';
export interface MembersTableProps {
    organizationId: string;
    members: Member[];
    loading?: boolean;
    error?: string | null;
    userRole: OrgRole;
    onRoleChange: (memberId: string, role: OrgRole) => Promise<void>;
    onRemove: (memberId: string) => Promise<void>;
    onInvite?: () => void;
    onRetry?: () => void;
}
/**
 * Sortable members grid backed by TanStack Table v8, rendered through the
 * design-system DataTable shell. Role assignment and removal are permission-gated.
 */
export declare function MembersTable({ members, loading, error, userRole, onRoleChange, onRemove, onInvite, onRetry, }: MembersTableProps): import("react/jsx-runtime").JSX.Element;

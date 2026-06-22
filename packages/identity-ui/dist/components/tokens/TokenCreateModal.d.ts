import type { CreatedApiToken, TokenOwnerType } from '../../types';
import type { CreateTokenInput } from '../../api/tokens';
export interface TokenCreateModalProps {
    open: boolean;
    onClose: () => void;
    /** Owner the new token belongs to — drives owner_type/owner_id in the request. */
    ownerType: TokenOwnerType;
    ownerId: string;
    /** Optional org context for PAT scope validation. */
    orgId?: string;
    /** Scopes the owner may grant; passed through to ScopeSelector. */
    availableScopes?: string[];
    /** Performs the create request and returns the one-time token. */
    onCreate: (input: CreateTokenInput) => Promise<CreatedApiToken>;
    /** Called after a successful create (e.g. to refresh the list). */
    onCreated?: (token: CreatedApiToken) => void;
}
/**
 * Create-token modal with a one-time secret reveal. On success the raw token is
 * shown exactly once with a copy button and a prominent "won't be shown again"
 * warning; dismissing never re-shows it.
 */
export declare function TokenCreateModal({ open, onClose, ownerType, ownerId, orgId, availableScopes, onCreate, onCreated, }: TokenCreateModalProps): import("react/jsx-runtime").JSX.Element | null;

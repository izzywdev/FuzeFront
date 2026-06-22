import type { ApiTokenSummary } from '../../types';
export interface TokenListProps {
    tokens: ApiTokenSummary[];
    loading?: boolean;
    error?: string | null;
    onRevoke: (tokenId: string) => Promise<void>;
    onRetry?: () => void;
}
/**
 * Lists API tokens with type, scopes, expiry and last-used columns, an expiry
 * warning for tokens within 14 days, and a per-row revoke flow.
 */
export declare function TokenList({ tokens, loading, error, onRevoke, onRetry }: TokenListProps): import("react/jsx-runtime").JSX.Element;

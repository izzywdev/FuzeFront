import { type IdentityLocale } from '../../i18n/IdentityI18nProvider';
import type { IdentityApiClient, OrgRole } from '../../types';
export interface IdentityPageProps {
    organizationId: string;
    userRole: OrgRole;
    /** Current user id — owner of personal tokens. */
    userId?: string;
    /** Override the API client (tests / custom transport). */
    apiClient?: IdentityApiClient;
    /** Bearer-token accessor passed to the default client. */
    getToken?: () => string | null | undefined;
    locale?: IdentityLocale;
    /** Notifies the host after a membership change so it can re-sync. */
    onMembersChange?: () => void;
}
/**
 * Top-level tabbed identity page (Members / Pending Invitations / API Tokens).
 * Owns its own data fetching via the identity client unless `apiClient` is
 * injected. Wraps itself in the i18n provider and applies `dir` for RTL.
 */
export declare function IdentityPage(props: IdentityPageProps): import("react/jsx-runtime").JSX.Element;

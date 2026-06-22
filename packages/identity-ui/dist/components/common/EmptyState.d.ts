export type EmptyStateVariant = 'empty-members' | 'no-pending' | 'no-tokens' | 'error' | 'loading' | 'no-orgs';
export interface EmptyStateProps {
    variant: EmptyStateVariant;
    /** Optional title override; falls back to the variant default supplied by the caller via `message`. */
    title?: string;
    message?: string;
    actionLabel?: string;
    onAction?: () => void;
}
/**
 * Consistent empty / loading / error rendering for identity views. Uses a
 * dashed seam-toned box for empties, the SeamDivider shimmer for loading, and
 * a solid card for errors. All tokens come from the design system.
 */
export declare function EmptyState({ variant, title, message, actionLabel, onAction }: EmptyStateProps): import("react/jsx-runtime").JSX.Element;

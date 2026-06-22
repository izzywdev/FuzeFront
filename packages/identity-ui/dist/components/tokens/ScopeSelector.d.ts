export interface ScopeSelectorProps {
    /** Currently selected scope strings. */
    value: string[];
    /** Called with the next scope array on toggle. */
    onChange: (scopes: string[]) => void;
    /**
     * Scopes the owner is actually permitted to grant. Scopes outside this set
     * are disabled. When omitted, all scopes are enabled.
     */
    availableScopes?: string[];
    disabled?: boolean;
}
/**
 * Grouped scope checkbox group built on design-system tokens. Each scope shows
 * its human-readable label; scopes beyond the owner's permissions are disabled.
 */
export declare function ScopeSelector({ value, onChange, availableScopes, disabled }: ScopeSelectorProps): import("react/jsx-runtime").JSX.Element;

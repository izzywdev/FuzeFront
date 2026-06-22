import type { OrgRole } from '../../types';
export interface RoleSelectProps {
    value: OrgRole;
    /** Caller's role — gates whether the control is editable. */
    callerRole: OrgRole;
    onChange: (role: OrgRole) => void;
    disabled?: boolean;
}
/**
 * Inline role assignment select mapping to Permit roles. Disabled when the
 * caller is a `viewer`, when the target member is an `owner`, or when the
 * `disabled` prop is set. Wraps the design-system Select.
 */
export declare function RoleSelect({ value, callerRole, onChange, disabled }: RoleSelectProps): import("react/jsx-runtime").JSX.Element;

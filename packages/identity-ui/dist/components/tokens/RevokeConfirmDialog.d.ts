export interface RevokeConfirmDialogProps {
    open: boolean;
    /** Title shown in the dialog header. */
    title?: string;
    /** Confirmation prompt body. */
    message: string;
    /** Label of the resource being revoked (rendered in mono for clarity). */
    subject?: string;
    onCancel: () => void;
    /** Performs the destructive action. The dialog handles loading/error. */
    onConfirm: () => Promise<void>;
    confirmLabel?: string;
}
/**
 * Destructive-action confirmation dialog. Idle → Loading → (closes on success)
 * or Error toast in place. Built on the design-system Modal + danger Button.
 */
export declare function RevokeConfirmDialog({ open, title, message, subject, onCancel, onConfirm, confirmLabel, }: RevokeConfirmDialogProps): import("react/jsx-runtime").JSX.Element | null;

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useBillingI18n } from '../i18n';
import { CloseIcon } from './primitives';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Disable backdrop / ESC close (e.g. mid-payment). */
  dismissable?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: role="dialog", aria-modal, labelled by its title, ESC to
 * close, a simple focus trap, and focus restoration to the previously focused
 * element on unmount. RTL mirrors automatically via the logical-property CSS.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  dismissable = true,
}: ModalProps) {
  const { dir, strings } = useBillingI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismissable, onClose],
  );

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const target = root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ffb-modal__overlay"
      dir={dir}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        className="ffb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="ffb-modal__header">
          <div>
            <h2 id={titleId} className="ffb-modal__title">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="ffb-modal__subtitle">
                {subtitle}
              </p>
            )}
          </div>
          {dismissable && (
            <button
              type="button"
              className="ffb-modal__close"
              onClick={onClose}
              aria-label={strings.closeLabel}
            >
              <CloseIcon />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

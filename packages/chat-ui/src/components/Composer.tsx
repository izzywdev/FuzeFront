import { useState, type KeyboardEvent } from 'react';
import { useChatI18n } from '../i18n';

export interface ComposerProps {
  disabled?: boolean;
  onSend: (text: string) => void;
}

/**
 * Message composer. Enter submits, Shift+Enter inserts a newline. The textarea
 * is labelled and the send button is disabled while streaming or empty.
 */
export function Composer({ disabled = false, onSend }: ComposerProps) {
  const { strings } = useChatI18n();
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="ffc-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="ffc-composer__input"
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={strings.composerPlaceholder}
        aria-label={strings.composerPlaceholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="submit"
        className="ffc-btn ffc-btn--primary"
        disabled={disabled || value.trim().length === 0}
        aria-label={strings.sendLabel}
      >
        {strings.sendLabel}
      </button>
    </form>
  );
}

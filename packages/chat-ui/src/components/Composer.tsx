import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';
import { useChatI18n } from '../i18n';

export interface MentionCandidate {
  id: string;
  name: string;
  type: 'agent' | 'team';
  avatar?: string;
  description?: string;
}

export interface ComposerProps {
  disabled?: boolean;
  onSend: (text: string) => void;
  mentions?: MentionCandidate[];
  onMentionSelect?: (mention: MentionCandidate) => void;
}

const DEFAULT_MENTIONS: MentionCandidate[] = [
  { id: 'python-dev', name: 'python-dev', type: 'agent', description: 'Python FastAPI & ML Specialist' },
  { id: 'react-dev', name: 'react-dev', type: 'agent', description: 'React & Frontend UI Specialist' },
  { id: 'devops-lead', name: 'devops-lead', type: 'agent', description: 'K8s, Helm & Terraform Infra Specialist' },
  { id: 'marketing-lead', name: 'marketing-lead', type: 'agent', description: 'Growth, Copywriting & Content Strategist' },
  { id: 'core-eng', name: 'core-eng', type: 'team', description: 'Core Engineering Agent Swarm' },
  { id: 'infra-team', name: 'infra-team', type: 'team', description: 'Infrastructure & Ops Team' }
];

/**
 * Message composer with @mention autocomplete for agents and teams.
 * Enter submits, Shift+Enter inserts a newline.
 */
export function Composer({ 
  disabled = false, 
  onSend, 
  mentions = DEFAULT_MENTIONS,
  onMentionSelect 
}: ComposerProps) {
  const { strings } = useChatI18n();
  const [value, setValue] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter mentions by active query
  const filteredMentions = mentionQuery !== null
    ? mentions.filter(m => 
        m.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        m.id.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        m.description?.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];

  const handleSelectMention = (candidate: MentionCandidate) => {
    if (mentionStartIndex < 0) return;
    const before = value.substring(0, mentionStartIndex);
    const after = value.substring(textareaRef.current?.selectionStart ?? value.length);
    const mentionText = `@${candidate.name} `;
    const updated = `${before}${mentionText}${after}`;
    
    setValue(updated);
    setMentionQuery(null);
    setMentionStartIndex(-1);
    onMentionSelect?.(candidate);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursor = before.length + mentionText.length;
        textareaRef.current.setSelectionRange(cursor, cursor);
      }
    }, 0);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setValue(val);

    // Look back from cursor to find if we're typing an @mention
    const textBeforeCursor = val.substring(0, cursor);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartIndex(match.index ?? 0);
      setSelectedIndex(0);
    } else {
      setMentionQuery(null);
      setMentionStartIndex(-1);
    }
  };

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    setMentionQuery(null);
    setMentionStartIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectMention(filteredMentions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionStartIndex(-1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="ffc-composer-container" style={{ position: 'relative' }}>
      {/* Mentions Autocomplete Popup */}
      {mentionQuery !== null && filteredMentions.length > 0 && (
        <div 
          className="ffc-mentions-popup"
          role="listbox"
          aria-label="Agent & Team Mentions"
        >
          {filteredMentions.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === selectedIndex}
              className={`ffc-mention-item ${idx === selectedIndex ? 'ffc-mention-item--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectMention(item);
              }}
            >
              <span className="ffc-mention-avatar">
                {item.type === 'team' ? '👥' : '🤖'}
              </span>
              <div className="ffc-mention-info">
                <span className="ffc-mention-name">@{item.name}</span>
                {item.description && (
                  <span className="ffc-mention-desc">{item.description}</span>
                )}
              </div>
              <span className="ffc-mention-badge">{item.type}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="ffc-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          className="ffc-composer__input"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={strings.composerPlaceholder}
          aria-label={strings.composerPlaceholder}
          onChange={handleChange}
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
    </div>
  );
}


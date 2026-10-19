export interface SuggestedPromptsProps {
  prompts: string[];
  onSelect: (prompt: string) => void;
  label?: string;
}

/**
 * Clickable prompt starter chips for empty conversation states.
 */
export function SuggestedPrompts({
  prompts,
  onSelect,
  label = 'Suggested Questions',
}: SuggestedPromptsProps) {
  if (!prompts || prompts.length === 0) return null;

  return (
    <div className="ffc-suggested">
      <div className="ffc-suggested__label">{label}</div>
      <div className="ffc-suggested__chips">
        {prompts.map((p, idx) => (
          <button
            key={idx}
            type="button"
            className="ffc-suggested__chip"
            onClick={() => onSelect(p)}
          >
            💡 {p}
          </button>
        ))}
      </div>
    </div>
  );
}

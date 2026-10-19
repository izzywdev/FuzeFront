import { useState } from 'react';
import type { ThoughtStep } from '../hooks/types';

export interface ThoughtBoxProps {
  thoughts: ThoughtStep[];
}

export function ThoughtBox({ thoughts }: ThoughtBoxProps) {
  const [open, setOpen] = useState(false);
  if (!thoughts || thoughts.length === 0) return null;

  const totalDuration = thoughts.reduce((acc, t) => acc + (t.durationMs || 0), 0);
  const durationLabel = totalDuration > 0 ? ` (${(totalDuration / 1000).toFixed(1)}s)` : '';

  return (
    <div className={`ffc-thought-box ${open ? 'ffc-thought-box--open' : ''}`}>
      <button
        type="button"
        className="ffc-thought-box__toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="ffc-thought-box__icon" aria-hidden="true">⚡</span>
        <span className="ffc-thought-box__title">
          Thought process{durationLabel}
        </span>
        <span className="ffc-thought-box__chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="ffc-thought-box__content">
          {thoughts.map((step) => (
            <div key={step.id} className="ffc-thought-box__step">
              <div className="ffc-thought-box__step-title">{step.title}</div>
              <div className="ffc-thought-box__step-body">{step.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

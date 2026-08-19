import { describe, it, expect } from 'vitest';
import { statusTone, statusLabel, isEntitled } from '../src/lib/status';
import { defaultStrings } from '../src/i18n';

describe('status helpers', () => {
  it('maps statuses to design-system tones', () => {
    expect(statusTone('active')).toBe('success');
    expect(statusTone('trialing')).toBe('success');
    expect(statusTone('past_due')).toBe('warning');
    expect(statusTone('unpaid')).toBe('error');
    expect(statusTone('canceled')).toBe('neutral');
    expect(statusTone('something_unknown')).toBe('neutral');
  });

  it('resolves localized status labels with a passthrough fallback', () => {
    expect(statusLabel('active', defaultStrings)).toBe('Active');
    expect(statusLabel('past_due', defaultStrings)).toBe('Past due');
    expect(statusLabel('weird_status', defaultStrings)).toBe('weird_status');
  });

  it('treats active/trialing/past_due as entitled', () => {
    expect(isEntitled('active')).toBe(true);
    expect(isEntitled('trialing')).toBe(true);
    expect(isEntitled('past_due')).toBe(true);
    expect(isEntitled('canceled')).toBe(false);
    expect(isEntitled('unpaid')).toBe(false);
  });
});

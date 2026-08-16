import { DEFAULT_LIMIT, MAX_LIMIT, MIN_LIMIT, decodeCursor, encodeCursor, parseLimit } from '../src/pagination';

describe('parseLimit', () => {
  it('returns the default when no limit is supplied', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('returns the default for a non-numeric value', () => {
    expect(parseLimit('not-a-number')).toBe(DEFAULT_LIMIT);
  });

  it('passes through a value within bounds', () => {
    expect(parseLimit('25')).toBe(25);
  });

  it('clamps a value ABOVE the max down to MAX_LIMIT — gate-pagination server-side enforcement', () => {
    expect(parseLimit('999999')).toBe(MAX_LIMIT);
    expect(parseLimit(String(MAX_LIMIT + 1))).toBe(MAX_LIMIT);
  });

  it('clamps a value below the min up to MIN_LIMIT', () => {
    expect(parseLimit('0')).toBe(MIN_LIMIT);
    expect(parseLimit('-5')).toBe(MIN_LIMIT);
  });

  it('truncates a fractional value', () => {
    expect(parseLimit('10.9')).toBe(10);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a payload', () => {
    const cursor = encodeCursor({ key: 'ui.theme.density' });
    expect(decodeCursor<{ key: string }>(cursor)).toEqual({ key: 'ui.theme.density' });
  });

  it('returns null for a missing cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for an empty-string cursor', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a malformed (non-base64url-JSON) cursor rather than throwing', () => {
    expect(decodeCursor('not-a-valid-cursor!!!')).toBeNull();
  });

  it('returns null for a cursor that decodes to a non-object', () => {
    const cursor = Buffer.from('"just a string"', 'utf8').toString('base64url');
    expect(decodeCursor(cursor)).toBeNull();
  });
});

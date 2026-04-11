import { describe, it, expect } from 'vitest';
import { formatTimeRemaining } from '@core/displayUtils';

describe('formatTimeRemaining', () => {
  const now = new Date('2026-01-15T12:00:00Z');

  it('returns "Complete" when target is in the past', () => {
    const past = new Date('2026-01-15T11:00:00Z');
    expect(formatTimeRemaining(past, now)).toBe('Complete');
  });

  it('returns "Complete" when target equals now', () => {
    expect(formatTimeRemaining(now, now)).toBe('Complete');
  });

  it('formats days and hours', () => {
    const target = new Date('2026-01-17T15:30:00Z');
    expect(formatTimeRemaining(target, now)).toBe('2d 3h');
  });

  it('formats hours and minutes', () => {
    const target = new Date('2026-01-15T14:45:00Z');
    expect(formatTimeRemaining(target, now)).toBe('2h 45m');
  });

  it('formats minutes only when less than 1 hour', () => {
    const target = new Date('2026-01-15T12:30:00Z');
    expect(formatTimeRemaining(target, now)).toBe('30m');
  });

  it('returns "0m" when less than 1 minute remains', () => {
    const target = new Date('2026-01-15T12:00:30Z');
    expect(formatTimeRemaining(target, now)).toBe('0m');
  });

  it('shows 0h for days with no leftover hours', () => {
    const target = new Date('2026-01-16T12:00:00Z');
    expect(formatTimeRemaining(target, now)).toBe('1d 0h');
  });

  it('shows 0m for hours with no leftover minutes', () => {
    const target = new Date('2026-01-15T15:00:00Z');
    expect(formatTimeRemaining(target, now)).toBe('3h 0m');
  });
});

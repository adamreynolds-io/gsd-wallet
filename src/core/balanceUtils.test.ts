import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatBalance,
  formatDustBalance,
} from '@core/balanceUtils';
import {
  NIGHT_DENOMINATION,
  DUST_DENOMINATION,
} from '@shared/constants';

describe('formatBalance', () => {
  it('returns "0" for zero balance', () => {
    expect(formatBalance(0n)).toBe('0');
  });

  it('formats fractional-only balance (less than denomination)', () => {
    expect(formatBalance(500_000n, NIGHT_DENOMINATION)).toBe('0.5');
  });

  it('formats whole number without fractional part', () => {
    expect(formatBalance(3_000_000n, NIGHT_DENOMINATION)).toBe('3');
  });

  it('strips trailing zeros from fractional part', () => {
    expect(formatBalance(1_500_000n, NIGHT_DENOMINATION)).toBe('1.5');
  });

  it('preserves significant fractional digits', () => {
    expect(formatBalance(1_234_567n, NIGHT_DENOMINATION)).toBe(
      '1.234567',
    );
  });

  it('pads fractional part for NIGHT (6-digit denomination)', () => {
    // 1 speck = 0.000001 NIGHT
    expect(formatBalance(1n, NIGHT_DENOMINATION)).toBe('0.000001');
  });

  it('pads fractional part for DUST (15-digit denomination)', () => {
    // 1 speck = 0.000000000000001 DUST
    expect(formatBalance(1n, DUST_DENOMINATION)).toBe(
      '0.000000000000001',
    );
  });

  it('formats millions with M suffix', () => {
    const million = 1_000_000n * NIGHT_DENOMINATION;
    expect(formatBalance(million)).toBe('1M');
  });

  it('formats millions with decimal', () => {
    const val = 1_500_000n * NIGHT_DENOMINATION;
    expect(formatBalance(val)).toBe('1.5M');
  });

  it('formats billions with B suffix', () => {
    const billion = 1_000_000_000n * NIGHT_DENOMINATION;
    expect(formatBalance(billion)).toBe('1B');
  });

  it('formats trillions with T suffix', () => {
    const trillion = 1_000_000_000_000n * NIGHT_DENOMINATION;
    expect(formatBalance(trillion)).toBe('1T');
  });

  it('uses comma-separated whole part below million', () => {
    const val = 999_999n * NIGHT_DENOMINATION;
    expect(formatBalance(val)).toBe('999,999');
  });

  it('handles denomination of 1n (no fractional part)', () => {
    expect(formatBalance(42n, 1n)).toBe('42');
  });

  it('defaults denomination to NIGHT_DENOMINATION', () => {
    expect(formatBalance(2_000_000n)).toBe('2');
  });
});

describe('formatDustBalance', () => {
  it('formats zero dust', () => {
    expect(formatDustBalance(0n)).toBe('0');
  });

  it('formats 1 DUST (10^15 specks)', () => {
    expect(formatDustBalance(DUST_DENOMINATION)).toBe('1');
  });

  it('formats fractional DUST', () => {
    const half = DUST_DENOMINATION / 2n;
    expect(formatDustBalance(half)).toBe('0.5');
  });
});

describe('formatBalance property-based tests', () => {
  it('never throws for any non-negative bigint with denomination > 0', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 64n }),
        fc.bigInt({ min: 1n, max: 10n ** 18n }),
        (balance, denomination) => {
          expect(() => formatBalance(balance, denomination)).not.toThrow();
        },
      ),
    );
  });

  it('always returns a non-empty string', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 64n }),
        fc.bigInt({ min: 1n, max: 10n ** 18n }),
        (balance, denomination) => {
          const result = formatBalance(balance, denomination);
          expect(result.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('formatDustBalance(0n) === "0"', () => {
    expect(formatDustBalance(0n)).toBe('0');
  });
});

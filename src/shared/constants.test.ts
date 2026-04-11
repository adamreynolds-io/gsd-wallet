import { describe, it, expect } from 'vitest';
import {
  DUST_DENOMINATION,
  NIGHT_DENOMINATION,
  NIGHT_TOKEN_ID,
  TX_TTL_MS,
  GSD_WALLET_RDNS,
} from '@shared/constants';

describe('constants', () => {
  it('DUST_DENOMINATION equals 10^15', () => {
    expect(DUST_DENOMINATION).toBe(10n ** 15n);
  });

  it('NIGHT_DENOMINATION equals 10^6', () => {
    expect(NIGHT_DENOMINATION).toBe(10n ** 6n);
  });

  it('NIGHT_TOKEN_ID is 64-char hex zeros', () => {
    expect(NIGHT_TOKEN_ID).toBe('0'.repeat(64));
    expect(NIGHT_TOKEN_ID).toHaveLength(64);
    expect(NIGHT_TOKEN_ID).toMatch(/^[0-9a-f]+$/);
  });

  it('TX_TTL_MS equals 30 minutes in milliseconds', () => {
    expect(TX_TTL_MS).toBe(1_800_000);
    expect(TX_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('GSD_WALLET_RDNS follows reverse domain notation', () => {
    expect(GSD_WALLET_RDNS).toBe('io.shielded.gsd');
  });
});

import { describe, it, expect } from 'vitest';
import { hexToBytes, bytesToHex } from '@shared/hexUtils';

describe('hexToBytes', () => {
  it('converts valid hex to correct bytes', () => {
    const bytes = hexToBytes('deadbeef');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('strips 0x prefix', () => {
    const bytes = hexToBytes('0xabcd');
    expect(bytes).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('returns empty Uint8Array for empty string', () => {
    const bytes = hexToBytes('');
    expect(bytes).toEqual(new Uint8Array([]));
    expect(bytes.length).toBe(0);
  });

  it('handles uppercase hex characters', () => {
    const bytes = hexToBytes('AABB');
    expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it('throws with code InvalidInput for odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow(
      expect.objectContaining({ code: 'InvalidInput' }),
    );
  });

  it('throws with code InvalidInput for non-hex characters', () => {
    expect(() => hexToBytes('ghij')).toThrow(
      expect.objectContaining({ code: 'InvalidInput' }),
    );
  });

  it('throws for 0x prefix with odd remaining length', () => {
    expect(() => hexToBytes('0xabc')).toThrow(
      expect.objectContaining({ code: 'InvalidInput' }),
    );
  });
});

describe('bytesToHex', () => {
  it('converts bytes to lowercase hex', () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hex).toBe('deadbeef');
  });

  it('returns empty string for empty array', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('');
  });

  it('pads single-digit bytes with leading zero', () => {
    const hex = bytesToHex(new Uint8Array([0x01, 0x0a]));
    expect(hex).toBe('010a');
  });
});

describe('roundtrip', () => {
  it('bytesToHex(hexToBytes(hex)) === hex', () => {
    const original = 'deadbeef0123456789abcdef';
    expect(bytesToHex(hexToBytes(original))).toBe(original);
  });

  it('hexToBytes(bytesToHex(bytes)) matches original', () => {
    const original = new Uint8Array([0, 127, 255, 1, 16]);
    expect(hexToBytes(bytesToHex(original))).toEqual(original);
  });
});

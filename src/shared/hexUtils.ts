export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

class HexError extends Error {
  code: string;
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'HexError';
    this.code = 'InvalidInput';
    this.reason = reason;
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new HexError('Hex string has odd length');
  }
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new HexError('Hex string contains non-hex characters');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

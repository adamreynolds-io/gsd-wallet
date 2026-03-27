import {
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
  DustAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

export type AddressValidationResult =
  | { valid: true; address: string }
  | { valid: false; error: string };

export function validateShieldedAddress(
  addressStr: string,
  networkId: NetworkId.NetworkId,
): AddressValidationResult {
  try {
    const parsed = MidnightBech32m.parse(addressStr);
    if (parsed.type !== 'shield-addr') {
      return {
        valid: false,
        error: `Expected shielded address, got ${parsed.type}`,
      };
    }
    ShieldedAddress.codec.decode(networkId, parsed);
    return { valid: true, address: addressStr };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error
          ? err.message
          : 'Invalid shielded address',
    };
  }
}

export function validateUnshieldedAddress(
  addressStr: string,
  networkId: NetworkId.NetworkId,
): AddressValidationResult {
  try {
    const parsed = MidnightBech32m.parse(addressStr);
    if (parsed.type !== 'addr') {
      return {
        valid: false,
        error: `Expected unshielded address, got ${parsed.type}`,
      };
    }
    UnshieldedAddress.codec.decode(networkId, parsed);
    return { valid: true, address: addressStr };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error
          ? err.message
          : 'Invalid unshielded address',
    };
  }
}

export function validateDustAddress(
  addressStr: string,
  networkId: NetworkId.NetworkId,
): AddressValidationResult {
  try {
    const parsed = MidnightBech32m.parse(addressStr);
    if (parsed.type !== 'dust') {
      return {
        valid: false,
        error: `Expected dust address, got ${parsed.type}`,
      };
    }
    DustAddress.codec.decode(networkId, parsed);
    return { valid: true, address: addressStr };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error ? err.message : 'Invalid dust address',
    };
  }
}

export function validateAddress(
  addressStr: string,
  tokenType: 'shielded' | 'unshielded',
  networkId: NetworkId.NetworkId,
): AddressValidationResult {
  return tokenType === 'shielded'
    ? validateShieldedAddress(addressStr, networkId)
    : validateUnshieldedAddress(addressStr, networkId);
}

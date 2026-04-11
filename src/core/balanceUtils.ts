import {
  NIGHT_TOKEN_ID,
  NIGHT_DENOMINATION,
  DUST_DENOMINATION,
} from '@shared/constants';

export function formatBalanceForToken(
  balance: bigint,
  tokenId: string,
  tokenType: 'shielded' | 'unshielded',
): string {
  const isNight =
    tokenType === 'unshielded' && tokenId === NIGHT_TOKEN_ID;
  const denomination = isNight ? NIGHT_DENOMINATION : 1n;
  return formatBalance(balance, denomination);
}

export function formatBalance(
  balance: bigint,
  denomination: bigint = NIGHT_DENOMINATION,
): string {
  const value = balance / denomination;
  const fractionalPart = balance % denomination;

  const trillion = BigInt(1_000_000_000_000);
  const billion = BigInt(1_000_000_000);
  const million = BigInt(1_000_000);

  if (value >= trillion) {
    return formatAbbreviated(value, fractionalPart, trillion, 'T');
  }
  if (value >= billion) {
    return formatAbbreviated(value, fractionalPart, billion, 'B');
  }
  if (value >= million) {
    return formatAbbreviated(value, fractionalPart, million, 'M');
  }

  const wholeStr = value.toLocaleString('en-US');
  if (fractionalPart > 0n) {
    const decimals = denomination.toString().length - 1;
    const fracStr = fractionalPart
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '');
    return `${wholeStr}.${fracStr}`;
  }
  return wholeStr;
}

function formatAbbreviated(
  value: bigint,
  fractionalPart: bigint,
  unit: bigint,
  suffix: string,
): string {
  const wholeUnits = value / unit;
  const remainder = value % unit;
  const decimalPart = Number((remainder * 100n) / unit);

  if (decimalPart === 0 && fractionalPart === 0n) {
    return `${wholeUnits.toLocaleString('en-US')}${suffix}`;
  }
  const decimalStr = (decimalPart / 100)
    .toFixed(2)
    .substring(1)
    .replace(/\.?0+$/, '');
  return `${wholeUnits.toLocaleString('en-US')}${decimalStr}${suffix}`;
}

export function formatDustBalance(speckBalance: bigint): string {
  return formatBalance(speckBalance, DUST_DENOMINATION);
}

import { NIGHT_TOKEN_ID } from '@shared/constants';

export function getTokenDisplayName(
  tokenId: string,
  tokenType: 'shielded' | 'unshielded',
): string {
  if (tokenType === 'unshielded' && tokenId === NIGHT_TOKEN_ID) {
    return 'NIGHT';
  }
  return `${tokenId.substring(0, 8)}...`;
}

export function truncateAddress(address: string): string {
  if (address.length <= 40) return address;
  return `${address.substring(0, 20)}...${address.substring(address.length - 16)}`;
}

export function formatTimeRemaining(
  targetDate: Date,
  now: Date = new Date(),
): string {
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'Complete';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

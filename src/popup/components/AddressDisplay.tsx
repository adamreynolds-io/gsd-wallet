import { useState, useCallback } from 'react';

interface AddressDisplayProps {
  label: string;
  address: string;
}

export function AddressDisplay({ label, address }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const truncated =
    address.length > 40
      ? `${address.slice(0, 20)}...${address.slice(-16)}`
      : address;

  return (
    <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
          {label}
        </div>
        <div className="address-display text-gray-300" title={address}>
          {truncated || '...'}
        </div>
      </div>
      <button
        onClick={handleCopy}
        className="ml-2 p-1 rounded hover:bg-white/10 transition-colors text-gray-400 hover:text-white shrink-0"
        title="Copy address"
      >
        {copied ? (
          <CheckIcon />
        ) : (
          <CopyIcon />
        )}
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

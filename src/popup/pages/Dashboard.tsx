import { useState } from 'react';
import { AddressDisplay } from '@popup/components/AddressDisplay';
import { TransferModal } from '@popup/components/TransferModal';
import { DustModal } from '@popup/components/DustModal';
import { usePopupStore } from '@popup/store/popupStore';
import {
  NIGHT_TOKEN_ID,
  NIGHT_DENOMINATION,
  DUST_DENOMINATION,
} from '@shared/constants';

export function Dashboard() {
  const walletState = usePopupStore((s) => s.walletState);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dustMode, setDustMode] = useState<'register' | 'deregister' | null>(null);

  if (!walletState) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <Spinner /> Connecting to wallet...
      </div>
    );
  }

  const nightBalance =
    walletState.unshielded.balances[NIGHT_TOKEN_ID] ?? '0';
  const dustBalance = walletState.dust.balance;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
      {/* Addresses */}
      <div className="space-y-2">
        <AddressDisplay
          label="Shielded Address"
          address={walletState.shielded.address}
        />
        <AddressDisplay
          label="Unshielded Address"
          address={walletState.unshielded.address}
        />
        <AddressDisplay
          label="Dust Address"
          address={walletState.dust.address}
        />
      </div>

      {/* Balances */}
      <div className="card">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          NIGHT Balance
        </div>
        <div className="text-2xl font-mono text-white">
          {formatBigInt(nightBalance, NIGHT_DENOMINATION)}
        </div>
      </div>

      <div className="card">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          DUST Balance
        </div>
        <div className="text-lg font-mono text-white">
          {formatBigInt(dustBalance, DUST_DENOMINATION)}
        </div>
      </div>

      {/* Sync Progress */}
      {!walletState.isSynced && (
        <div className="card">
          <div className="text-xs text-gray-400 mb-2">
            Syncing... {walletState.overallSyncPercent}%
          </div>
          <div className="w-full h-2 bg-midnight-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-purple to-accent-magenta rounded-full transition-[width] duration-300"
              style={{ width: `${walletState.overallSyncPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          className="btn-primary flex-1 text-sm"
          onClick={() => setTransferOpen(true)}
        >
          Transfer
        </button>
        <button
          className="btn-secondary flex-1 text-sm"
          onClick={() => setDustMode('register')}
        >
          + Register
        </button>
        <button
          className="btn-secondary flex-1 text-sm"
          onClick={() => setDustMode('deregister')}
        >
          - Deregister
        </button>
      </div>

      {/* Token Balances */}
      <TokenBalances
        label="Shielded Tokens"
        balances={walletState.shielded.balances}
        tokenType="shielded"
      />
      <TokenBalances
        label="Unshielded Tokens"
        balances={walletState.unshielded.balances}
        tokenType="unshielded"
      />

      {/* Modals */}
      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
      />
      {dustMode && (
        <DustModal
          open={true}
          onClose={() => setDustMode(null)}
          mode={dustMode}
        />
      )}
    </div>
  );
}

function TokenBalances({
  label,
  balances,
  tokenType,
}: {
  label: string;
  balances: Record<string, string>;
  tokenType: 'shielded' | 'unshielded';
}) {
  const entries = Object.entries(balances).filter(
    ([, amount]) => amount !== '0',
  );
  if (entries.length === 0) return null;

  return (
    <div className="card">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
        {label}
      </div>
      <div className="space-y-1.5">
        {entries.map(([tokenId, amount]) => (
          <div key={tokenId} className="flex justify-between text-sm">
            <span className="text-gray-400 font-mono truncate mr-2">
              {tokenType === 'unshielded' && tokenId === NIGHT_TOKEN_ID
                ? 'NIGHT'
                : `${tokenId.slice(0, 8)}...`}
            </span>
            <span className="text-white font-mono">
              {tokenType === 'unshielded' && tokenId === NIGHT_TOKEN_ID
                ? formatBigInt(amount, NIGHT_DENOMINATION)
                : amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBigInt(value: string, denomination: bigint): string {
  const num = BigInt(value);
  const whole = num / denomination;
  const frac = num % denomination;
  if (frac === 0n) return whole.toLocaleString('en-US');
  const fracStr = frac
    .toString()
    .padStart(denomination.toString().length - 1, '0')
    .replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}.${fracStr}`;
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 mr-2 text-accent-purple"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

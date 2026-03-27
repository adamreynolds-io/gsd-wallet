import { usePopupStore } from '@popup/store/popupStore';

export function StatusBar() {
  const statusMessage = usePopupStore((s) => s.statusMessage);
  const walletState = usePopupStore((s) => s.walletState);
  const syncPercent = walletState?.overallSyncPercent ?? 0;
  const isSynced = walletState?.isSynced ?? false;
  const connections = walletState?.connections;

  return (
    <footer className="flex items-center justify-between px-4 py-2 bg-midnight-800 border-t border-midnight-500 text-xs">
      {statusMessage ? (
        <span
          className={
            statusMessage.type === 'success'
              ? 'text-status-green'
              : statusMessage.type === 'error'
                ? 'text-status-red'
                : 'text-gray-400'
          }
        >
          {statusMessage.text}
        </span>
      ) : (
        <div className="flex items-center gap-4">
          <ServiceDot label="Node" healthy={connections?.node ?? false} />
          <ServiceDot label="Indexer" healthy={connections?.indexer ?? false} />
          <ServiceDot label="Prover" healthy={connections?.prover ?? false} />
        </div>
      )}

      {walletState && !statusMessage && (
        <span className="text-gray-400">
          {isSynced ? 'Synced' : `Syncing ${syncPercent}%`}
        </span>
      )}
    </footer>
  );
}

function ServiceDot({
  label,
  healthy,
}: {
  label: string;
  healthy: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`status-dot ${healthy ? 'status-dot-green' : 'status-dot-red'}`}
      />
      <span className="text-gray-400">{label}</span>
    </span>
  );
}

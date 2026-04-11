import { useState, useEffect } from 'react';
import {
  fetchTxDetail,
  fetchBlockDetail,
  fetchContractDetail,
  type TxDetail,
  type BlockDetail,
  type ContractDetail,
} from '@shared/indexerQuery';
import {
  explorerTxUrl,
  explorerBlockUrl,
  explorerContractUrl,
} from '@shared/environments';
import { formatDustBalance } from '@core/balanceUtils';
import type { Environment, InspectorTarget } from '@shared/types';

interface InspectorProps {
  target: InspectorTarget;
  environment: Environment;
  onInspect: (target: InspectorTarget) => void;
  onClose: () => void;
  onBack: (() => void) | undefined;
  onDataLoaded: (data: unknown) => void;
}

export function Inspector({
  target,
  environment,
  onInspect,
  onClose,
  onBack,
  onDataLoaded,
}: InspectorProps) {
  const [data, setData] = useState<
    TxDetail | BlockDetail | ContractDetail | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const fetchData = async () => {
      try {
        let result: TxDetail | BlockDetail | ContractDetail | null = null;
        switch (target.kind) {
          case 'transaction':
            result = await fetchTxDetail(environment, target.hash);
            if (!result) {
              result = await fetchContractDetail(environment, target.hash);
            }
            break;
          case 'block':
            result = await fetchBlockDetail(environment, target.height);
            break;
          case 'contract':
            result = await fetchContractDetail(
              environment,
              target.address,
            );
            break;
        }
        if (cancelled) return;
        if (result) {
          setData(result);
          onDataLoaded(result);
        } else {
          setError('Not found in indexer');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Fetch failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [target, environment]);

  const title =
    target.kind === 'transaction'
      ? 'Transaction'
      : target.kind === 'block'
        ? 'Block'
        : 'Contract';

  const identifier =
    target.kind === 'transaction'
      ? target.hash
      : target.kind === 'block'
        ? String(target.height)
        : target.address;

  const explorerUrl = getExplorerUrl(target, environment);

  return (
    <div className="bg-midnight-800 rounded-lg border border-midnight-500 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-white text-sm"
              title="Back"
            >
              &larr;
            </button>
          )}
          <span className="text-xs uppercase tracking-wider text-gray-500">
            {title}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white text-xs px-1"
          title="Close"
        >
          x
        </button>
      </div>

      {/* Identifier */}
      <div
        className="font-mono text-xs text-gray-500 truncate mb-1.5"
        title={identifier}
      >
        {identifier}
      </div>

      {/* Content */}
      <div className="overflow-y-auto max-h-[280px] space-y-1 text-xs">
        {loading && (
          <div className="text-gray-400 text-center py-2">
            Querying indexer...
          </div>
        )}
        {error && (
          <div className="text-amber-400 text-center py-2">{error}</div>
        )}
        {data && isTxDetail(data) && (
          <TxDetailView
            detail={data}
            onInspect={onInspect}
          />
        )}
        {data && isBlockDetail(data) && (
          <BlockDetailView
            detail={data}
            onInspect={onInspect}
          />
        )}
        {data && isContractDetail(data) && (
          <ContractDetailView
            detail={data}
            onInspect={onInspect}
          />
        )}
      </div>

      {/* Explorer link */}
      {explorerUrl && (
        <div className="mt-1.5 pt-1 border-t border-midnight-600">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-purple hover:underline"
          >
            Open in Explorer
          </a>
        </div>
      )}
    </div>
  );
}

function TxDetailView({
  detail,
  onInspect,
}: {
  detail: TxDetail;
  onInspect: (target: InspectorTarget) => void;
}) {
  const statusColor = statusToColor(detail.status);

  const ts = detail.blockTimestamp
    ? new Date(detail.blockTimestamp * 1000)
    : null;

  return (
    <>
      <Row
        k="Status"
        v={detail.status ?? detail.typename}
        vClass={statusColor}
      />
      <div className="flex items-center justify-between">
        <span className="text-gray-500">Block</span>
        <button
          onClick={() =>
            onInspect({ kind: 'block', height: detail.blockHeight })
          }
          className="font-mono text-accent-purple hover:underline cursor-pointer"
        >
          #{detail.blockHeight.toLocaleString()}
        </button>
      </div>
      {ts && <Row k="Time" v={ts.toLocaleString()} />}
      {detail.feesPaid && (
        <Row k="Fees" v={`${formatDust(detail.feesPaid)} DUST`} mono />
      )}

      {detail.contractActions.length > 0 && (
        <>
          <Label text="Contracts" />
          {detail.contractActions.map((action, i) => (
            <div
              key={i}
              className="flex items-center justify-between bg-midnight-700 rounded px-1.5 py-0.5"
            >
              <span className="text-gray-400">
                {action.typename.replace('Contract', '')}
              </span>
              <div className="flex items-center gap-1.5">
                {action.entryPoint && (
                  <span className="font-mono text-gray-300">
                    {action.entryPoint}
                  </span>
                )}
                <button
                  onClick={() =>
                    onInspect({
                      kind: 'contract',
                      address: action.address,
                    })
                  }
                  className="font-mono text-accent-purple hover:underline cursor-pointer"
                  title={action.address}
                >
                  {action.address.slice(0, 12)}...
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {detail.createdOutputs.length > 0 && (
        <>
          <Label text={`Created (${detail.createdOutputs.length})`} />
          {detail.createdOutputs.slice(0, 5).map((o, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="font-mono text-gray-500 truncate mr-1">
                {o.owner.slice(0, 16)}...
              </span>
              <span className="font-mono text-green-400 shrink-0">
                +{formatDust(o.value)}
              </span>
            </div>
          ))}
          {detail.createdOutputs.length > 5 && (
            <span className="text-gray-600">
              +{detail.createdOutputs.length - 5} more
            </span>
          )}
        </>
      )}

      {detail.spentOutputs.length > 0 && (
        <>
          <Label text={`Spent (${detail.spentOutputs.length})`} />
          {detail.spentOutputs.slice(0, 5).map((o, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="font-mono text-gray-500 truncate mr-1">
                {o.owner.slice(0, 16)}...
              </span>
              <span className="font-mono text-red-400 shrink-0">
                -{formatDust(o.value)}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function BlockDetailView({
  detail,
  onInspect,
}: {
  detail: BlockDetail;
  onInspect: (target: InspectorTarget) => void;
}) {
  const ts = detail.timestamp
    ? new Date(detail.timestamp * 1000)
    : null;

  return (
    <>
      <Row k="Height" v={`#${detail.height.toLocaleString()}`} mono />
      {detail.hash && (
        <Row
          k="Hash"
          v={`${detail.hash.slice(0, 20)}...`}
          mono
          title={detail.hash}
        />
      )}
      {detail.protocolVersion && (
        <Row k="Protocol" v={String(detail.protocolVersion)} />
      )}
      {ts && <Row k="Time" v={ts.toLocaleString()} />}
      {detail.author && (
        <Row
          k="Author"
          v={`${detail.author.slice(0, 16)}...`}
          mono
          title={detail.author}
        />
      )}
      {detail.parent && (
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Parent</span>
          <button
            onClick={() =>
              onInspect({
                kind: 'block',
                height: detail.parent!.height,
              })
            }
            className="font-mono text-accent-purple hover:underline cursor-pointer"
          >
            #{detail.parent.height.toLocaleString()}
          </button>
        </div>
      )}

      {detail.transactions.length > 0 && (
        <>
          <Label
            text={`Transactions (${detail.transactions.length})`}
          />
          {detail.transactions.slice(0, 10).map((tx, i) => (
            <button
              key={i}
              onClick={() =>
                onInspect({ kind: 'transaction', hash: tx.hash })
              }
              className="block w-full text-left font-mono text-accent-purple hover:underline cursor-pointer truncate"
              title={tx.hash}
            >
              {tx.hash.slice(0, 24)}...
            </button>
          ))}
          {detail.transactions.length > 10 && (
            <span className="text-gray-600">
              +{detail.transactions.length - 10} more
            </span>
          )}
        </>
      )}
    </>
  );
}

function ContractDetailView({
  detail,
  onInspect,
}: {
  detail: ContractDetail;
  onInspect: (target: InspectorTarget) => void;
}) {
  return (
    <>
      {detail.typename && <Row k="Type" v={detail.typename.replace('Contract', '')} />}
      {detail.address && (
        <Row
          k="Address"
          v={`${detail.address.slice(0, 20)}...`}
          mono
          title={detail.address}
        />
      )}
      {detail.zswapState && (
        <Row
          k="ZSwap State"
          v={`${detail.zswapState.slice(0, 16)}...`}
          mono
          title={detail.zswapState}
        />
      )}
      {detail.txHash && (
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Transaction</span>
          <button
            onClick={() =>
              onInspect({
                kind: 'transaction',
                hash: detail.txHash as string,
              })
            }
            className="font-mono text-accent-purple hover:underline cursor-pointer"
            title={detail.txHash}
          >
            {detail.txHash.slice(0, 16)}...
          </button>
        </div>
      )}
      {detail.blockHeight != null && (
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Block</span>
          <button
            onClick={() =>
              onInspect({
                kind: 'block',
                height: detail.blockHeight as number,
              })
            }
            className="font-mono text-accent-purple hover:underline cursor-pointer"
          >
            #{detail.blockHeight.toLocaleString()}
          </button>
        </div>
      )}
      {detail.status && (
        <Row
          k="Status"
          v={detail.status}
          vClass={statusToColor(detail.status)}
        />
      )}
      {detail.feesPaid && (
        <Row k="Fees" v={`${formatDust(detail.feesPaid)} DUST`} mono />
      )}
      {detail.entryPoint && (
        <Row k="Entry Point" v={detail.entryPoint} mono />
      )}
      {detail.deployAddress && (
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Deploy Address</span>
          <button
            onClick={() =>
              onInspect({
                kind: 'contract',
                address: detail.deployAddress as string,
              })
            }
            className="font-mono text-accent-purple hover:underline cursor-pointer"
            title={detail.deployAddress}
          >
            {detail.deployAddress.slice(0, 12)}...
          </button>
        </div>
      )}

      {detail.balances.length > 0 && (
        <>
          <Label text="Balances" />
          {detail.balances.map((bal, i) => (
            <div
              key={i}
              className="flex items-center justify-between"
            >
              <span className="font-mono text-gray-500 truncate mr-1">
                {bal.tokenType.slice(0, 16)}
                {bal.tokenType.length > 16 ? '...' : ''}
              </span>
              <span className="font-mono text-gray-200 shrink-0">
                {bal.amount}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Row({
  k,
  v,
  mono,
  vClass,
  title,
}: {
  k: string;
  v: string;
  mono?: boolean;
  vClass?: string;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{k}</span>
      <span
        className={`${vClass ?? 'text-gray-200'} ${mono ? 'font-mono' : ''}`}
        title={title}
      >
        {v}
      </span>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div className="text-[8px] uppercase tracking-wider text-gray-600 pt-0.5">
      {text}
    </div>
  );
}

function statusToColor(status: string | null): string {
  switch (status) {
    case 'SUCCESS':
      return 'text-green-400';
    case 'FAILURE':
      return 'text-red-400';
    case 'PARTIAL_SUCCESS':
      return 'text-amber-400';
    default:
      return 'text-gray-400';
  }
}

function isTxDetail(d: unknown): d is TxDetail {
  return d != null && typeof d === 'object' && 'hash' in d && 'feesPaid' in d && !('zswapState' in d);
}

function isBlockDetail(d: unknown): d is BlockDetail {
  return d != null && typeof d === 'object' && 'height' in d && 'protocolVersion' in d;
}

function isContractDetail(d: unknown): d is ContractDetail {
  return d != null && typeof d === 'object' && 'zswapState' in d;
}

function formatDust(value: string): string {
  try {
    return formatDustBalance(BigInt(value));
  } catch {
    return value;
  }
}

function getExplorerUrl(
  target: InspectorTarget,
  environment: Environment,
): string | null {
  switch (target.kind) {
    case 'transaction':
      return explorerTxUrl(environment, target.hash);
    case 'block':
      return explorerBlockUrl(environment, target.height);
    case 'contract':
      return explorerContractUrl(environment, target.address);
  }
}

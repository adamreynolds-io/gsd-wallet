import type { Environment } from './types';
import { getEnvironmentConfig } from './environments';

const TX_DETAIL_QUERY = `
query GetTx($hash: HexEncoded!) {
  transactions(offset: { hash: $hash }) {
    __typename
    hash
    ... on RegularTransaction {
      id
      identifiers
      merkleTreeRoot
      startIndex
      endIndex
      fees { paidFees estimatedFees }
      transactionResult { status segments { id success } }
    }
    block { height hash timestamp }
    contractActions {
      __typename
      address
      ... on ContractCall { entryPoint }
    }
    unshieldedCreatedOutputs {
      owner value tokenType outputIndex
    }
    unshieldedSpentOutputs {
      owner value tokenType outputIndex
    }
  }
}`;

export interface TxDetail {
  hash: string;
  typename: string;
  blockHeight: number;
  blockTimestamp: number;
  status: string | null;
  feesPaid: string | null;
  feesEstimated: string | null;
  identifiers: string[];
  merkleTreeRoot: string | null;
  startIndex: number | null;
  endIndex: number | null;
  segments: Array<{ id: number; success: boolean }>;
  contractActions: Array<{
    typename: string;
    address: string;
    entryPoint: string | null;
  }>;
  createdOutputs: Array<{
    owner: string;
    value: string;
    tokenType: string;
  }>;
  spentOutputs: Array<{
    owner: string;
    value: string;
    tokenType: string;
  }>;
}

export async function fetchTxDetail(
  environment: Environment,
  txHash: string,
): Promise<TxDetail | null> {
  // The SDK returns 66-char identifiers (1-byte version prefix + 32-byte hash).
  // The indexer expects raw 32-byte hashes (64 hex chars).
  const normalizedHash = txHash.length === 66 && txHash.startsWith('00')
    ? txHash.slice(2)
    : txHash;

  const config = getEnvironmentConfig(environment);
  const url = config.indexerHttpUrl;

  console.log(`[GSD Explorer] Fetching tx ${normalizedHash} from ${url}${normalizedHash !== txHash ? ` (normalized from ${txHash})` : ''}`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: TX_DETAIL_QUERY,
      variables: { hash: normalizedHash },
    }),
  });

  if (!resp.ok) {
    console.error(`[GSD Explorer] HTTP ${resp.status}: ${resp.statusText}`);
    return null;
  }

  const json = await resp.json();
  if (json?.errors?.length) {
    console.warn('[GSD Explorer] GraphQL errors:', json.errors);
    return null;
  }
  console.log('[GSD Explorer] Response:', JSON.stringify(json).slice(0, 200));
  const txs = json?.data?.transactions;
  if (!txs || txs.length === 0) {
    console.warn('[GSD Explorer] No transactions found for hash:', txHash);
    return null;
  }

  const tx = txs[0];
  return {
    hash: tx.hash,
    typename: tx.__typename,
    blockHeight: tx.block?.height ?? 0,
    blockTimestamp: tx.block?.timestamp ?? 0,
    status: tx.transactionResult?.status ?? null,
    feesPaid: tx.fees?.paidFees ?? null,
    feesEstimated: tx.fees?.estimatedFees ?? null,
    identifiers: (tx.identifiers as string[]) ?? [],
    merkleTreeRoot: (tx.merkleTreeRoot as string) ?? null,
    startIndex: (tx.startIndex as number) ?? null,
    endIndex: (tx.endIndex as number) ?? null,
    segments: (tx.transactionResult?.segments ?? []).map(
      (s: Record<string, unknown>) => ({
        id: s['id'] as number,
        success: s['success'] as boolean,
      }),
    ),
    contractActions: (tx.contractActions ?? []).map(
      (a: Record<string, unknown>) => ({
        typename: a['__typename'] as string,
        address: a['address'] as string,
        entryPoint: (a['entryPoint'] as string) ?? null,
      }),
    ),
    createdOutputs: (tx.unshieldedCreatedOutputs ?? []).map(
      (o: Record<string, unknown>) => ({
        owner: o['owner'] as string,
        value: o['value'] as string,
        tokenType: o['tokenType'] as string,
      }),
    ),
    spentOutputs: (tx.unshieldedSpentOutputs ?? []).map(
      (o: Record<string, unknown>) => ({
        owner: o['owner'] as string,
        value: o['value'] as string,
        tokenType: o['tokenType'] as string,
      }),
    ),
  };
}

const BLOCK_DETAIL_QUERY = `
query GetBlock($height: Int!) {
  block(offset: { height: $height }) {
    hash
    height
    protocolVersion
    timestamp
    author
    parent { hash height timestamp }
    transactions { __typename hash }
  }
}`;

export interface BlockDetail {
  hash: string;
  height: number;
  protocolVersion: number;
  timestamp: number;
  author: string | null;
  parent: {
    hash: string;
    height: number;
    timestamp: number;
  } | null;
  transactions: Array<{ typename: string; hash: string }>;
}

export async function fetchBlockDetail(
  environment: Environment,
  height: number,
): Promise<BlockDetail | null> {
  const config = getEnvironmentConfig(environment);
  const url = config.indexerHttpUrl;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: BLOCK_DETAIL_QUERY,
      variables: { height },
    }),
  });

  if (!resp.ok) return null;

  const json = await resp.json();
  if (json?.errors?.length) {
    console.warn('[GSD Explorer] GraphQL errors:', json.errors);
    return null;
  }
  const block = json?.data?.block;
  if (!block) return null;

  const parent = block.parent
    ? {
        hash: block.parent.hash as string,
        height: block.parent.height as number,
        timestamp: block.parent.timestamp as number,
      }
    : null;

  return {
    hash: block.hash,
    height: block.height,
    protocolVersion: block.protocolVersion,
    timestamp: block.timestamp,
    author: block.author ?? null,
    parent,
    transactions: (block.transactions ?? []).map(
      (t: Record<string, unknown>) => ({
        typename: t['__typename'] as string,
        hash: t['hash'] as string,
      }),
    ),
  };
}

const CONTRACT_DETAIL_QUERY = `
query GetContract($address: HexEncoded!) {
  contractAction(address: $address) {
    __typename
    address
    zswapState
    transaction {
      hash
      block { hash height timestamp }
      ... on RegularTransaction {
        transactionResult { status segments { id success } }
        fees { paidFees estimatedFees }
      }
    }
    unshieldedBalances { tokenType amount }
    ... on ContractCall { entryPoint deploy { address } }
  }
}`;

export interface ContractDetail {
  typename: string;
  address: string;
  zswapState: string;
  txHash: string;
  blockHeight: number;
  blockTimestamp: number;
  status: string | null;
  feesPaid: string | null;
  balances: Array<{ tokenType: string; amount: string }>;
  entryPoint: string | null;
  deployAddress: string | null;
}

export async function fetchContractDetail(
  environment: Environment,
  address: string,
): Promise<ContractDetail | null> {
  // The SDK returns 66-char identifiers (1-byte version prefix + 32-byte hash).
  // The indexer expects raw 32-byte hashes (64 hex chars).
  const normalizedAddress = address.length === 66 && address.startsWith('00')
    ? address.slice(2)
    : address;

  const config = getEnvironmentConfig(environment);
  const url = config.indexerHttpUrl;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: CONTRACT_DETAIL_QUERY,
      variables: { address: normalizedAddress },
    }),
  });

  if (!resp.ok) return null;

  const json = await resp.json();
  if (json?.errors?.length) {
    console.warn('[GSD Explorer] GraphQL errors:', json.errors);
    return null;
  }
  const action = json?.data?.contractAction;
  if (!action) return null;

  const tx = action.transaction;

  return {
    typename: action.__typename,
    address: action.address,
    zswapState: action.zswapState,
    txHash: tx?.hash ?? '',
    blockHeight: tx?.block?.height ?? 0,
    blockTimestamp: tx?.block?.timestamp ?? 0,
    status: tx?.transactionResult?.status ?? null,
    feesPaid: tx?.fees?.paidFees ?? null,
    balances: (action.unshieldedBalances ?? []).map(
      (b: Record<string, unknown>) => ({
        tokenType: b['tokenType'] as string,
        amount: b['amount'] as string,
      }),
    ),
    entryPoint: action.entryPoint ?? null,
    deployAddress: action.deploy?.address ?? null,
  };
}

import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import type { Environment, EnvironmentConfig } from './types';

const PROVING_SERVER_URL = 'http://localhost:6300';

export const ENVIRONMENT_OPTIONS: Array<{
  label: string;
  value: Environment;
}> = [
  { label: 'Mainnet', value: 'mainnet' },
  { label: 'Mainnet (VPN)', value: 'mainnet-vpn' },
  { label: 'PreProd', value: 'preprod' },
  { label: 'Preview', value: 'preview' },
  { label: 'QANet', value: 'qanet' },
  { label: 'DevNet', value: 'dev' },
  { label: 'Undeployed', value: 'undeployed' },
];

export function deriveIndexerWsUrl(httpUrl: string): string {
  const wsUrl = httpUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
  return wsUrl.endsWith('/ws') ? wsUrl : `${wsUrl}/ws`;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  mainnet: {
    networkId: NetworkId.NetworkId.MainNet,
    indexerHttpUrl:
      'https://indexer.mainnet.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://rpc.mainnet.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  'mainnet-vpn': {
    networkId: NetworkId.NetworkId.MainNet,
    indexerHttpUrl:
      'https://indexer.mainnet.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://td-rpc.mainnet.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  preprod: {
    networkId: NetworkId.NetworkId.PreProd,
    indexerHttpUrl:
      'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://rpc.preprod.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  preview: {
    networkId: NetworkId.NetworkId.Preview,
    indexerHttpUrl:
      'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://rpc.preview.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  qanet: {
    networkId: NetworkId.NetworkId.QaNet,
    indexerHttpUrl:
      'https://indexer.qanet.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.qanet.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://rpc.qanet.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  dev: {
    networkId: NetworkId.NetworkId.DevNet,
    indexerHttpUrl:
      'https://indexer.devnet.midnight.network/api/v4/graphql',
    indexerWsUrl:
      'wss://indexer.devnet.midnight.network/api/v4/graphql/ws',
    nodeWsUrl: 'wss://rpc.devnet.midnight.network',
    provingServerUrl: PROVING_SERVER_URL,
  },
  undeployed: {
    networkId: NetworkId.NetworkId.Undeployed,
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    nodeWsUrl: 'ws://localhost:9944',
    provingServerUrl: PROVING_SERVER_URL,
  },
};

export function getEnvironmentConfig(
  environment: Environment,
): EnvironmentConfig {
  return ENVIRONMENTS[environment];
}

const EXPLORER_URLS: Partial<Record<Environment, string>> = {
  mainnet: 'https://explorer.mainnet.midnight.network',
  'mainnet-vpn': 'https://explorer.mainnet.midnight.network',
  preprod: 'https://explorer.preprod.midnight.network',
  preview: 'https://explorer.preview.midnight.network',
  qanet: 'https://explorer.qanet.midnight.network',
  dev: 'https://explorer.devnet.midnight.network',
};

export function getExplorerUrl(
  environment: Environment,
): string | null {
  return EXPLORER_URLS[environment] ?? null;
}

export function explorerTxUrl(
  environment: Environment,
  txHash: string,
): string | null {
  const base = getExplorerUrl(environment);
  return base ? `${base}/transactions/${txHash}` : null;
}

export function explorerBlockUrl(
  environment: Environment,
  blockNumber: number,
): string | null {
  const base = getExplorerUrl(environment);
  return base ? `${base}/blocks/${blockNumber}` : null;
}

export function explorerContractUrl(
  environment: Environment,
  contractAddress: string,
): string | null {
  const base = getExplorerUrl(environment);
  return base ? `${base}/contracts/${contractAddress}` : null;
}

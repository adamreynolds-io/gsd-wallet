import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import type { Environment, EnvironmentConfig } from './types';

const PROVING_SERVER_URL = 'http://localhost:6300';

export const ENVIRONMENT_OPTIONS: Array<{
  label: string;
  value: Environment;
}> = [
  { label: 'Mainnet', value: 'mainnet' },
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
    indexerHttpUrl: 'TODO_ADD_URL',
    indexerWsUrl: 'TODO_ADD_URL',
    nodeWsUrl: 'TODO_ADD_URL',
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

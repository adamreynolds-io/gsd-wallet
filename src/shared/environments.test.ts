import { describe, it, expect } from 'vitest';
import {
  getEnvironmentConfig,
  getEnvironmentLabel,
  getExplorerUrl,
  explorerTxUrl,
  explorerBlockUrl,
  explorerContractUrl,
  ENVIRONMENT_OPTIONS,
  ENVIRONMENTS,
} from '@shared/environments';
import type { Environment } from '@shared/types';

const ALL_ENVS: Environment[] = [
  'mainnet',
  'preprod',
  'preview',
  'qanet',
  'dev',
  'undeployed',
];

describe('getEnvironmentConfig', () => {
  it.each(ALL_ENVS)(
    'returns config with all required fields for %s',
    (env) => {
      const config = getEnvironmentConfig(env);
      expect(config).toHaveProperty('networkId');
      expect(config).toHaveProperty('indexerHttpUrl');
      expect(config).toHaveProperty('indexerWsUrl');
      expect(config).toHaveProperty('nodeWsUrl');
      expect(config).toHaveProperty('provingServerUrl');
      expect(typeof config.indexerHttpUrl).toBe('string');
      expect(typeof config.indexerWsUrl).toBe('string');
    },
  );

  it('undeployed uses localhost URLs', () => {
    const config = getEnvironmentConfig('undeployed');
    expect(config.indexerHttpUrl).toContain('localhost');
    expect(config.nodeWsUrl).toContain('localhost');
  });

  it('mainnet uses mainnet.midnight.network', () => {
    const config = getEnvironmentConfig('mainnet');
    expect(config.indexerHttpUrl).toContain('mainnet.midnight.network');
  });
});

describe('getEnvironmentLabel', () => {
  it('returns human-readable label for each environment', () => {
    expect(getEnvironmentLabel('mainnet')).toBe('Mainnet');
    expect(getEnvironmentLabel('dev')).toBe('DevNet');
    expect(getEnvironmentLabel('undeployed')).toBe('Undeployed');
  });
});

describe('ENVIRONMENT_OPTIONS', () => {
  it('has entries for all environments', () => {
    const values = ENVIRONMENT_OPTIONS.map((o) => o.value);
    for (const env of ALL_ENVS) {
      expect(values).toContain(env);
    }
  });

  it('each entry has a non-empty label', () => {
    for (const opt of ENVIRONMENT_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe('explorer URL functions', () => {
  it('returns explorer URL for deployed environments', () => {
    expect(getExplorerUrl('mainnet')).toContain('explorer.mainnet');
    expect(getExplorerUrl('preview')).toContain('explorer.preview');
  });

  it('returns null for undeployed', () => {
    expect(getExplorerUrl('undeployed')).toBeNull();
  });

  it('explorerTxUrl appends /transactions/{hash}', () => {
    const url = explorerTxUrl('mainnet', 'abc123');
    expect(url).toBe(
      'https://explorer.mainnet.midnight.network/transactions/abc123',
    );
  });

  it('explorerBlockUrl appends /blocks/{number}', () => {
    const url = explorerBlockUrl('preview', 42);
    expect(url).toBe(
      'https://explorer.preview.midnight.network/blocks/42',
    );
  });

  it('explorerContractUrl appends /contracts/{address}', () => {
    const url = explorerContractUrl('qanet', 'deadbeef');
    expect(url).toBe(
      'https://explorer.qanet.midnight.network/contracts/deadbeef',
    );
  });

  it('explorer URL functions return null for undeployed', () => {
    expect(explorerTxUrl('undeployed', 'abc')).toBeNull();
    expect(explorerBlockUrl('undeployed', 1)).toBeNull();
    expect(explorerContractUrl('undeployed', 'abc')).toBeNull();
  });
});

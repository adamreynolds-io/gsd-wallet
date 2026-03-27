import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import type { EnvironmentConfig } from '@shared/types';

export interface WalletSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

export interface WalletInitResult {
  facade: WalletFacade;
  networkId: NetworkId.NetworkId;
  secretKeys: WalletSecretKeys;
  unshieldedKeystore: ReturnType<
    typeof import('@midnight-ntwrk/wallet-sdk-unshielded-wallet').createKeystore
  >;
}

export async function initializeWallet(
  seed: Uint8Array,
  envConfig: EnvironmentConfig,
  accountIndex: number = 0,
): Promise<WalletInitResult> {
  const [
    { HDWallet, Roles },
    { WalletFacade: WalletFacadeCtor },
    { ShieldedWallet },
    {
      UnshieldedWallet,
      createKeystore,
      PublicKey,
      InMemoryTransactionHistoryStorage,
    },
    { DustWallet },
    { makeWasmProvingService },
    ledgerMod,
  ] = await Promise.all([
    import('@midnight-ntwrk/wallet-sdk-hd'),
    import('@midnight-ntwrk/wallet-sdk-facade'),
    import('@midnight-ntwrk/wallet-sdk-shielded'),
    import('@midnight-ntwrk/wallet-sdk-unshielded-wallet'),
    import('@midnight-ntwrk/wallet-sdk-dust-wallet'),
    import('@midnight-ntwrk/wallet-sdk-capabilities'),
    import('@midnight-ntwrk/ledger-v8'),
  ]);

  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(accountIndex)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys from HD wallet');
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledgerMod.ZswapSecretKeys.fromSeed(
    derivationResult.keys[Roles.Zswap],
  );
  const dustSecretKey = ledgerMod.DustSecretKey.fromSeed(
    derivationResult.keys[Roles.Dust],
  );
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    envConfig.networkId,
  );

  const config = {
    networkId: envConfig.networkId,
    indexerClientConnection: {
      indexerHttpUrl: envConfig.indexerHttpUrl,
      indexerWsUrl: envConfig.indexerWsUrl,
    },
    provingServerUrl: new URL(envConfig.provingServerUrl),
    relayURL: new URL(envConfig.nodeWsUrl),
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  const facade = await WalletFacadeCtor.init({
    configuration: config,
    shielded: (cfg) =>
      ShieldedWallet(cfg).startWithSeed(
        derivationResult.keys[Roles.Zswap],
      ),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: (cfg) =>
      DustWallet(cfg).startWithSeed(
        derivationResult.keys[Roles.Dust],
        ledgerMod.LedgerParameters.initialParameters().dust,
      ),
    provingService: () => makeWasmProvingService(),
  });

  await facade.start(shieldedSecretKeys, dustSecretKey);

  return {
    facade,
    networkId: config.networkId,
    secretKeys: { shieldedSecretKeys, dustSecretKey },
    unshieldedKeystore,
  };
}

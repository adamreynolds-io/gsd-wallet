/**
 * Local WASM prover that spawns proof-worker.ts via Vite's native
 * worker detection. Required because the upstream WasmProver uses a
 * relative URL that doesn't resolve in Vite-bundled Chrome extensions.
 */
import { Schema, Effect } from 'effect';
import { WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import {
  fromProvingProvider,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type {
  ProvingService,
  UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';

const {
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyRequestSchema,
  GetParamsRequestSchema,
  LookupKeyOperationResultSchema,
  GetParamsOperationResultSchema,
  ResponseFromWorkerSchema,
} = WasmProver;

const MAX_TIME_TO_PROCESS = 10 * 60 * 1000;

const MessageDataSchema = Schema.Union(
  LookupKeyRequestSchema,
  GetParamsRequestSchema,
  ResponseFromWorkerSchema,
);

interface ProverWorkerCall {
  kmProvider: KeyMaterialProvider;
  op: 'check' | 'prove';
  args: [Uint8Array, (bigint | undefined)?];
}

function callLocalProverWorker(
  call: ProverWorkerCall,
): Promise<unknown> {
  const { kmProvider, op, args } = call;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./proof-worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.postMessage(
      op === 'check'
        ? Schema.encodeSync(CheckOperationSchema)({
            op, args: [args[0]],
          })
        : Schema.encodeSync(ProveOperationSchema)({
            op, args: [args[0], args[1]],
          }),
    );

    worker.addEventListener('message', ({ data }) => {
      const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);

      if (decoded.op === 'lookupKey') {
        const { keyLocation } = decoded;
        kmProvider.lookupKey(keyLocation)
          .then((result: ProvingKeyMaterial | undefined) => {
            worker.postMessage(
              Schema.encodeSync(LookupKeyOperationResultSchema)({
                op: 'lookupKey', keyLocation, result,
              }),
            );
          })
          .catch((e: unknown) => {
            worker.terminate();
            reject(e);
          });
      } else if (decoded.op === 'getParams') {
        const { k } = decoded;
        kmProvider.getParams(k)
          .then((result: Uint8Array) => {
            worker.postMessage(
              Schema.encodeSync(GetParamsOperationResultSchema)({
                op: 'getParams', k, result,
              }),
            );
          })
          .catch((e: unknown) => {
            worker.terminate();
            reject(e);
          });
      } else if (decoded.op === 'result') {
        worker.terminate();
        resolve(decoded.value);
      }
    });

    worker.addEventListener('error', (e) => {
      worker.terminate();
      reject(new Error(e.message));
    });

    setTimeout(() => {
      worker.terminate();
      reject(new Error(`${op} action timed out`));
    }, MAX_TIME_TO_PROCESS);
  });
}

/**
 * Creates a ProvingService that uses a local WASM proof worker.
 * Drop-in replacement for makeWasmProvingService from the SDK,
 * but spawns proof-worker.ts which Vite can bundle correctly.
 */
export function makeLocalWasmProvingService(
  config: { keyMaterialProvider: KeyMaterialProvider },
): ProvingService<UnboundTransaction> {
  const provider = {
    check: (
      preimage: Uint8Array,
      _keyLocation: string,
    ): Promise<(bigint | undefined)[]> =>
      callLocalProverWorker({
        kmProvider: config.keyMaterialProvider,
        op: 'check',
        args: [preimage],
      }) as Promise<(bigint | undefined)[]>,

    prove: (
      preimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      callLocalProverWorker({
        kmProvider: config.keyMaterialProvider,
        op: 'prove',
        args: [preimage, overwriteBindingInput],
      }) as Promise<Uint8Array>,
  };

  const effectService = fromProvingProvider(provider);
  return {
    prove: (tx) => Effect.runPromise(effectService.prove(tx)),
  };
}

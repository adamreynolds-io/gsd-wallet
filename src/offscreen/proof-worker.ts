// Local reimplementation of the upstream proof-worker protocol.
// This Web Worker proxies lookupKey/getParams calls to the parent thread
// so the parent's KeyMaterialProvider handles caching and fetching.
import { Schema } from 'effect';
import { check, prove } from '@midnight-ntwrk/zkir-v2';
import { WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';

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

const InboundMessageSchema = Schema.Union(
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyOperationResultSchema,
  GetParamsOperationResultSchema,
);

type InboundMessage = Schema.Schema.Type<typeof InboundMessageSchema>;

const keyMaterialProvider = {
  lookupKey(keyLocation: string): Promise<
    { proverKey: Uint8Array; verifierKey: Uint8Array; ir: Uint8Array } | undefined
  > {
    return new Promise((resolve, reject) => {
      postMessage(Schema.encodeSync(LookupKeyRequestSchema)({ op: 'lookupKey', keyLocation }));
      const handler = ({ data }: MessageEvent) => {
        const decoded = Schema.decodeUnknownSync(InboundMessageSchema)(data) as InboundMessage;
        if (decoded.op === 'lookupKey' && decoded.keyLocation === keyLocation) {
          removeEventListener('message', handler);
          clearTimeout(timer);
          resolve(decoded.result);
        }
      };
      addEventListener('message', handler);
      const timer = setTimeout(() => {
        removeEventListener('message', handler);
        reject(new Error(`Promise timed out for lookupKey: ${keyLocation}`));
      }, MAX_TIME_TO_PROCESS);
    });
  },

  getParams(k: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      postMessage(Schema.encodeSync(GetParamsRequestSchema)({ op: 'getParams', k }));
      const handler = ({ data }: MessageEvent) => {
        const decoded = Schema.decodeUnknownSync(InboundMessageSchema)(data) as InboundMessage;
        if (decoded.op === 'getParams' && decoded.k === k) {
          removeEventListener('message', handler);
          clearTimeout(timer);
          resolve(decoded.result);
        }
      };
      addEventListener('message', handler);
      const timer = setTimeout(() => {
        removeEventListener('message', handler);
        reject(new Error(`Promise timed out for getParams: ${k}`));
      }, MAX_TIME_TO_PROCESS);
    });
  },
};

addEventListener('message', ({ data }: MessageEvent) => {
  const decoded = Schema.decodeUnknownSync(InboundMessageSchema)(data) as InboundMessage;
  const { op } = decoded;

  if (op === 'check') {
    const [preimage] = decoded.args;
    check(preimage, keyMaterialProvider)
      .then((result) => {
        postMessage(
          Schema.encodeSync(ResponseFromWorkerSchema)({ op: 'result', value: result }),
        );
      })
      .catch((e: unknown) => { throw e; });
  } else if (op === 'prove') {
    const [preimage, bindingInput] = decoded.args;
    prove(preimage, keyMaterialProvider, bindingInput)
      .then((result) => {
        postMessage(
          Schema.encodeSync(ResponseFromWorkerSchema)({ op: 'result', value: result }),
        );
      })
      .catch((e: unknown) => { throw e; });
  }
});

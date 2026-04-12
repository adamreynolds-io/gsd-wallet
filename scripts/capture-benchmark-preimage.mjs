/**
 * Captures a raw proof preimage for the k=10 benchmark circuit.
 * Must be run from the compact-zkir-lint repo (has required deps).
 *
 * Usage:
 *   cd ~/Work/PROJECTS/compact-zkir-lint
 *   node ~/Work/PROJECTS/gsd-wallet/scripts/capture-benchmark-preimage.mjs
 *
 * Output: writes benchmark-k10.preimage to gsd-wallet/public/data/proving/
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import {
  LedgerParameters,
  sampleCoinPublicKey,
  sampleContractAddress,
  sampleEncryptionPublicKey,
  ZswapChainState,
  proofDataIntoSerializedPreimage,
} from "@midnight-ntwrk/ledger-v8";
import { createUnprovenCallTxFromInitialStates } from "@midnight-ntwrk/midnight-js-contracts";
import { getNetworkId, setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  createZKIR,
  createProverKey,
  createVerifierKey,
  ZKConfigProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { parseCoinPublicKeyToHex } from "@midnight-ntwrk/midnight-js-utils";

const CIRCUITS = [
  { id: "bench_k10", k: 10 },
  { id: "bench_k11", k: 11 },
];
const CONTRACT_DIR = join(import.meta.dirname, "bench/benchmark-compiled");
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../gsd-wallet/public/data/proving",
);

class BenchZKConfigProvider extends ZKConfigProvider {
  async getZKIR(circuitId) {
    return createZKIR(
      await readFile(join(CONTRACT_DIR, "zkir", `${circuitId}.bzkir`)),
    );
  }
  async getProverKey(circuitId) {
    return createProverKey(
      await readFile(join(CONTRACT_DIR, "keys", `${circuitId}.prover`)),
    );
  }
  async getVerifierKey(circuitId) {
    return createVerifierKey(
      await readFile(join(CONTRACT_DIR, "keys", `${circuitId}.verifier`)),
    );
  }
}

async function main() {
  setNetworkId("undeployed");

  const coinPublicKey = sampleCoinPublicKey();
  const contractModule = await import(
    join(CONTRACT_DIR, "contract", "index.js")
  );

  const dummySecret = { value: new Uint8Array(32) };

  const constructorResult = new contractModule.Contract({
    getSecret: () => dummySecret,
  }).initialState(
    createConstructorContext(
      undefined,
      parseCoinPublicKeyToHex(coinPublicKey, getNetworkId()),
    ),
  );

  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const { id, k } of CIRCUITS) {
    const result = await createUnprovenCallTxFromInitialStates(
      new BenchZKConfigProvider(),
      {
        compiledContract: CompiledContract.make(
          "benchmark",
          contractModule.Contract,
        ).pipe(
          CompiledContract.withWitnesses({
            getSecret: (ctx) => [ctx.privateState, dummySecret],
          }),
        ),
        circuitId: id,
        contractAddress: sampleContractAddress(),
        coinPublicKey,
        initialContractState: constructorResult.currentContractState,
        initialZswapChainState: new ZswapChainState(),
        ledgerParameters: LedgerParameters.initialParameters(),
        args: [],
      },
      sampleEncryptionPublicKey(),
    );

    const preimage = proofDataIntoSerializedPreimage(
      result.private.input,
      result.private.output,
      result.public.publicTranscript,
      result.private.privateTranscriptOutputs,
      id,
    );

    const outPath = join(OUTPUT_DIR, `benchmark-k${k}.preimage`);
    writeFileSync(outPath, preimage);
    console.log(`k=${k}: ${preimage.length} bytes -> ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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

const CIRCUIT_ID = "bench_k10";
const CONTRACT_DIR = join(import.meta.dirname, "bench/benchmark-compiled");
const OUTPUT = join(
  import.meta.dirname,
  "../gsd-wallet/public/data/proving/benchmark-k10.preimage",
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
      circuitId: CIRCUIT_ID,
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
    CIRCUIT_ID,
  );

  mkdirSync(join(OUTPUT, ".."), { recursive: true });
  writeFileSync(OUTPUT, preimage);

  const header = new TextDecoder().decode(preimage.slice(0, 60));
  console.log(`Wrote ${preimage.length} bytes to ${OUTPUT}`);
  console.log(`Header: ${header}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import path from 'node:path';
import * as CompiledCounter from './compiled/contract/index.js';
import { type CounterPrivateState, witnesses } from './witnesses.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const zkConfigPath = path.resolve(currentDir, 'compiled');

export const CompiledCounterContract = CompiledContract.make<
  CompiledCounter.Contract<CounterPrivateState>
>(
  'Counter',
  CompiledCounter.Contract<CounterPrivateState>,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export const CounterPrivateStateId = 'counterPrivateState' as const;

export { CompiledCounter };
export type { CounterPrivateState };
export { createPrivateState } from './witnesses.js';

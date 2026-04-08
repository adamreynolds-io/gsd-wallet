import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './compiled/contract/index.js';

export type CounterPrivateState = {
  privateCounter: number;
};

export const createPrivateState = (privateCounter: number): CounterPrivateState => ({
  privateCounter,
});

export const witnesses = {
  privateIncrement: (
    { privateState }: WitnessContext<Ledger, CounterPrivateState>,
  ): [CounterPrivateState, []] => [
    { privateCounter: privateState.privateCounter + 1 },
    [],
  ],
};

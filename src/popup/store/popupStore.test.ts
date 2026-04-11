import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DiagnosticEvent,
  SerializedWalletState,
} from '@shared/types';

vi.useFakeTimers();

// Zustand uses module-level state, so we re-import per test group
async function freshImport() {
  vi.resetModules();
  return await import('./popupStore');
}

function makeDiagEvent(id: number): DiagnosticEvent {
  return {
    id,
    timestamp: Date.now() + id,
    level: 'info',
    category: 'sw',
    message: `event-${id}`,
  };
}

function makeWalletState(
  overrides: Partial<SerializedWalletState> = {},
): SerializedWalletState {
  return {
    status: 'synced',
    environment: 'preview',
    activeAccountIndex: 0,
    shielded: {
      address: 'addr1',
      balances: {},
      coinCount: 0,
      syncPercent: 100,
      progress: {
        applied: 100,
        highest: 100,
        highestIndex: 100,
        connected: true,
      },
    },
    unshielded: {
      address: 'addr2',
      balances: {},
      utxos: [],
      syncPercent: 100,
      progress: {
        applied: 100,
        highest: 100,
        highestIndex: 100,
        connected: true,
      },
    },
    dust: {
      address: 'addr3',
      balance: '0',
      syncPercent: 100,
      progress: {
        applied: 100,
        highest: 100,
        highestIndex: 100,
        connected: true,
      },
    },
    overallSyncPercent: 100,
    isSynced: true,
    syncPhase: 'synced',
    connections: { node: true, indexer: true, prover: true },
    activeWalletName: 'Test Wallet',
    ...overrides,
  };
}

describe('popupStore', () => {
  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('showStatusMessage', () => {
    it('sets statusMessage in store', async () => {
      const { usePopupStore } = await freshImport();
      usePopupStore.getState().showStatusMessage('hello', 'success');

      expect(usePopupStore.getState().statusMessage).toEqual({
        text: 'hello',
        type: 'success',
      });
    });

    it('auto-clears after duration', async () => {
      const { usePopupStore } = await freshImport();
      usePopupStore.getState().showStatusMessage('temp', 'info', 2000);

      expect(usePopupStore.getState().statusMessage).not.toBeNull();

      vi.advanceTimersByTime(2000);

      expect(usePopupStore.getState().statusMessage).toBeNull();
    });

    it('second call cancels first timer', async () => {
      const { usePopupStore } = await freshImport();
      usePopupStore.getState().showStatusMessage('first', 'info', 5000);
      usePopupStore.getState().showStatusMessage('second', 'error', 5000);

      expect(usePopupStore.getState().statusMessage!.text).toBe('second');

      // First timer fires — should NOT clear (was cancelled)
      vi.advanceTimersByTime(5000);

      // Second timer also fires at 5000ms from its creation
      expect(usePopupStore.getState().statusMessage).toBeNull();
    });

    it('duration=0 means no auto-clear', async () => {
      const { usePopupStore } = await freshImport();
      usePopupStore.getState().showStatusMessage('sticky', 'success', 0);

      vi.advanceTimersByTime(60_000);

      expect(usePopupStore.getState().statusMessage).toEqual({
        text: 'sticky',
        type: 'success',
      });
    });
  });

  describe('addDiagnosticEvent', () => {
    it('adds to diagnosticEvents array', async () => {
      const { usePopupStore } = await freshImport();
      const event = makeDiagEvent(1);
      usePopupStore.getState().addDiagnosticEvent(event);

      expect(usePopupStore.getState().diagnosticEvents).toEqual([event]);
    });
  });

  describe('addDiagnosticEventsBatch', () => {
    it('merges, deduplicates by ID, sorts, and caps at 2000', async () => {
      const { usePopupStore } = await freshImport();

      // Add some existing events
      usePopupStore.getState().addDiagnosticEvent(makeDiagEvent(1));
      usePopupStore.getState().addDiagnosticEvent(makeDiagEvent(3));

      // Batch with overlapping id=3 and new id=2
      usePopupStore
        .getState()
        .addDiagnosticEventsBatch([makeDiagEvent(2), makeDiagEvent(3)]);

      const events = usePopupStore.getState().diagnosticEvents;
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('caps at 2000 events', async () => {
      const { usePopupStore } = await freshImport();

      const batch = Array.from({ length: 2100 }, (_, i) =>
        makeDiagEvent(i + 1),
      );
      usePopupStore.getState().addDiagnosticEventsBatch(batch);

      expect(usePopupStore.getState().diagnosticEvents).toHaveLength(2000);
      // Keeps the last 2000 (newest)
      expect(usePopupStore.getState().diagnosticEvents[0]!.id).toBe(101);
    });
  });

  describe('setWalletState', () => {
    it('updates walletState, status, and environment', async () => {
      const { usePopupStore } = await freshImport();
      const state = makeWalletState({
        status: 'syncing',
        environment: 'mainnet',
      });
      usePopupStore.getState().setWalletState(state);

      const s = usePopupStore.getState();
      expect(s.walletState).toBe(state);
      expect(s.status).toBe('syncing');
      expect(s.environment).toBe('mainnet');
    });
  });
});

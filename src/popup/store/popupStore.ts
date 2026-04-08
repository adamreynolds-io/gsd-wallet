import { create } from 'zustand';
import type {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticLevel,
  SerializedWalletState,
  SocketState,
  WalletStatus,
  Environment,
} from '@shared/types';
import { DIAGNOSTIC_LEVELS, DIAGNOSTIC_CATEGORIES } from '@shared/types';

const MAX_DIAGNOSTIC_EVENTS = 2000;

function makeFilterRecord<T extends string>(keys: readonly T[]): Record<T, boolean> {
  const rec = {} as Record<T, boolean>;
  for (const k of keys) { rec[k] = true; }
  return rec;
}

interface PopupState {
  status: WalletStatus;
  hasVault: boolean | null;
  walletState: SerializedWalletState | null;
  environment: Environment;
  error: string | null;
  statusMessage: { text: string; type: 'success' | 'error' | 'info' } | null;

  diagnosticEvents: DiagnosticEvent[];
  diagnosticLevelFilter: Record<DiagnosticLevel, boolean>;
  diagnosticCategoryFilter: Record<DiagnosticCategory, boolean>;

  updateAvailable: { latestVersion: string; releaseUrl: string; downloadUrl: string } | null;

  socketState: SocketState;

  setStatus: (status: WalletStatus) => void;
  setHasVault: (hasVault: boolean) => void;
  setWalletState: (state: SerializedWalletState) => void;
  setEnvironment: (env: Environment) => void;
  setError: (error: string | null) => void;
  showStatusMessage: (
    text: string,
    type: 'success' | 'error' | 'info',
    duration?: number,
  ) => void;
  clearStatusMessage: () => void;

  addDiagnosticEvent: (event: DiagnosticEvent) => void;
  addDiagnosticEventsBatch: (events: DiagnosticEvent[]) => void;
  setDiagnosticLevel: (level: DiagnosticLevel, on: boolean) => void;
  setDiagnosticCategory: (category: DiagnosticCategory, on: boolean) => void;
  clearDiagnosticEvents: () => void;
  setUpdateAvailable: (info: { latestVersion: string; releaseUrl: string; downloadUrl: string }) => void;

  setSocketState: (state: SocketState) => void;
}

export const usePopupStore = create<PopupState>((set) => ({
  status: 'locked',
  hasVault: null,
  walletState: null,
  environment: 'dev',
  error: null,
  statusMessage: null,

  diagnosticEvents: [],
  diagnosticLevelFilter: makeFilterRecord(DIAGNOSTIC_LEVELS),
  diagnosticCategoryFilter: makeFilterRecord(DIAGNOSTIC_CATEGORIES),

  updateAvailable: null,

  socketState: 'off',

  setStatus: (status) => set({ status }),
  setHasVault: (hasVault) => set({ hasVault }),
  setWalletState: (state) =>
    set({
      walletState: state,
      status: state.status,
      environment: state.environment,
    }),
  setEnvironment: (environment) => set({ environment }),
  setError: (error) => set({ error }),
  showStatusMessage: (text, type, duration = 3000) => {
    set({ statusMessage: { text, type } });
    if (duration > 0) {
      setTimeout(() => set({ statusMessage: null }), duration);
    }
  },
  clearStatusMessage: () => set({ statusMessage: null }),

  addDiagnosticEvent: (event) =>
    set((s) => {
      const events = [...s.diagnosticEvents, event];
      if (events.length > MAX_DIAGNOSTIC_EVENTS) events.shift();
      return { diagnosticEvents: events };
    }),

  addDiagnosticEventsBatch: (events) =>
    set({ diagnosticEvents: events.slice(-MAX_DIAGNOSTIC_EVENTS) }),

  setDiagnosticLevel: (level, on) =>
    set((s) => ({
      diagnosticLevelFilter: { ...s.diagnosticLevelFilter, [level]: on },
    })),

  setDiagnosticCategory: (category, on) =>
    set((s) => ({
      diagnosticCategoryFilter: { ...s.diagnosticCategoryFilter, [category]: on },
    })),

  clearDiagnosticEvents: () => set({ diagnosticEvents: [] }),

  setUpdateAvailable: (info) => set({ updateAvailable: info }),

  setSocketState: (state) => set({ socketState: state }),
}));

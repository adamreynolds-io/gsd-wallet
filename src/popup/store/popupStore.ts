import { create } from 'zustand';
import type {
  SerializedWalletState,
  WalletStatus,
  Environment,
} from '@shared/types';

interface PopupState {
  status: WalletStatus;
  hasVault: boolean | null;
  walletState: SerializedWalletState | null;
  environment: Environment;
  error: string | null;
  statusMessage: { text: string; type: 'success' | 'error' | 'info' } | null;

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
}

export const usePopupStore = create<PopupState>((set) => ({
  status: 'locked',
  hasVault: null,
  walletState: null,
  environment: 'dev',
  error: null,
  statusMessage: null,

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
}));

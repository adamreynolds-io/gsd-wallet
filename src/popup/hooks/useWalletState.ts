import { useEffect, useRef } from 'react';
import type { PopupResponse } from '@shared/messages';
import { usePopupStore } from '@popup/store/popupStore';

export function useWalletConnection(): void {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const setWalletState = usePopupStore((s) => s.setWalletState);
  const setHasVault = usePopupStore((s) => s.setHasVault);
  const setStatus = usePopupStore((s) => s.setStatus);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    portRef.current = port;

    port.onMessage.addListener((msg: PopupResponse) => {
      if (msg.type === 'STATE_UPDATE') {
        const { hasVault } = usePopupStore.getState();
        if (hasVault !== false) {
          setWalletState(msg.state);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    // Check if wallets exist
    chrome.runtime.sendMessage(
      { type: 'CHECK_HAS_WALLETS' },
      (response) => {
        if (response?.type === 'HAS_WALLETS') {
          setHasVault(response.exists as boolean);
          if (!response.exists) {
            setStatus('uninitialized');
          }
        }
      },
    );

    port.postMessage({ type: 'GET_STATE' });

    return () => {
      port.disconnect();
    };
  }, [setWalletState, setHasVault, setStatus]);
}

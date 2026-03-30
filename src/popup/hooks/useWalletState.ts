import { useEffect, useRef } from 'react';
import type { PopupResponse } from '@shared/messages';
import { usePopupStore } from '@popup/store/popupStore';

export function useWalletConnection(): void {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const setWalletState = usePopupStore((s) => s.setWalletState);
  const setHasVault = usePopupStore((s) => s.setHasVault);
  const setStatus = usePopupStore((s) => s.setStatus);
  const addDiagnosticEvent = usePopupStore((s) => s.addDiagnosticEvent);
  const addDiagnosticEventsBatch = usePopupStore((s) => s.addDiagnosticEventsBatch);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    portRef.current = port;

    port.onMessage.addListener((msg: PopupResponse) => {
      if (msg.type === 'STATE_UPDATE') {
        const { hasVault } = usePopupStore.getState();
        if (hasVault !== false) {
          if (hasVault === null) {
            setHasVault(true);
          }
          setWalletState(msg.state);
        }
      } else if (msg.type === 'DIAGNOSTIC_EVENT') {
        addDiagnosticEvent(msg.event);
      } else if (msg.type === 'DIAGNOSTIC_EVENTS_BATCH') {
        addDiagnosticEventsBatch(msg.events);
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
    port.postMessage({ type: 'GET_DIAGNOSTIC_BACKLOG' });

    return () => {
      port.disconnect();
    };
  }, [setWalletState, setHasVault, setStatus, addDiagnosticEvent, addDiagnosticEventsBatch]);
}

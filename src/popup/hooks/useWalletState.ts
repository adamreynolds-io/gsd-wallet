import { useEffect, useRef } from 'react';
import type { PopupResponse } from '@shared/messages';
import { usePopupStore } from '@popup/store/popupStore';

function handleMessage(msg: PopupResponse): void {
  const store = usePopupStore.getState();
  if (msg.type === 'STATE_UPDATE') {
    if (store.hasVault !== false) {
      if (store.hasVault === null) {
        store.setHasVault(true);
      }
      store.setWalletState(msg.state);
    }
  } else if (msg.type === 'DIAGNOSTIC_EVENT') {
    store.addDiagnosticEvent(msg.event);
  } else if (msg.type === 'DIAGNOSTIC_EVENTS_BATCH') {
    store.addDiagnosticEventsBatch(msg.events);
  }
}

export function useWalletConnection(): void {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;

    function connect() {
      if (unmounted.current) return;
      const store = usePopupStore.getState();

      const port = chrome.runtime.connect({ name: 'gsd-popup' });
      portRef.current = port;

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        portRef.current = null;
        store.addDiagnosticEvent({
          id: Date.now(),
          timestamp: Date.now(),
          level: 'warn',
          category: 'popup',
          message: 'Port disconnected from service worker',
        });
        // Auto-reconnect immediately unless unmounted
        if (!unmounted.current) {
          store.addDiagnosticEvent({
            id: Date.now(),
            timestamp: Date.now(),
            level: 'info',
            category: 'popup',
            message: 'Reconnecting to service worker...',
          });
          // Reconnect on next tick — keeps the SW alive by maintaining a port
          reconnectTimer.current = setTimeout(connect, 0);
        }
      });

      store.addDiagnosticEvent({
        id: Date.now(),
        timestamp: Date.now(),
        level: 'info',
        category: 'popup',
        message: 'Connected to service worker',
      });

      port.postMessage({ type: 'GET_STATE' });
      port.postMessage({ type: 'GET_DIAGNOSTIC_BACKLOG' });
    }

    // Check if wallets exist
    chrome.runtime.sendMessage(
      { type: 'CHECK_HAS_WALLETS' },
      (response) => {
        if (response?.type === 'HAS_WALLETS') {
          const store = usePopupStore.getState();
          store.setHasVault(response.exists as boolean);
          if (!response.exists) {
            store.setStatus('uninitialized');
          }
        }
      },
    );

    // Read cached state so the UI shows correct network + last known state immediately
    chrome.storage.session.get(['gsdEnvironment', 'gsdLastState']).then((result) => {
      const store = usePopupStore.getState();
      if (result['gsdLastState'] && !store.walletState) {
        store.setWalletState(result['gsdLastState']);
        if (store.hasVault === null) {
          store.setHasVault(true);
        }
      } else if (result['gsdEnvironment']) {
        store.setEnvironment(result['gsdEnvironment']);
      }
    });

    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (portRef.current) {
        portRef.current.disconnect();
      }
    };
  }, []);
}

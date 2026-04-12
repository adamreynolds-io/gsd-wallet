import { useEffect, useRef } from 'react';
import type { PopupResponse } from '@shared/messages';
import type { ProvingStatus, SerializedWalletState } from '@shared/types';
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
  } else if (msg.type === 'UPDATE_AVAILABLE') {
    store.setUpdateAvailable({
      latestVersion: msg.latestVersion,
      releaseUrl: msg.releaseUrl,
      downloadUrl: msg.downloadUrl,
    });
  } else if (msg.type === 'CONNECT_STATUS') {
    store.setSocketState(msg.state);
  } else if (msg.type === 'PROVING_STATUS') {
    store.setProvingStatus(msg.status);
  } else if (msg.type === 'PROVING_STRATEGY') {
    store.setProvingStrategy(msg.strategy);
  } else if (msg.type === 'BENCHMARK_RESULT') {
    store.setDeviceBenchmark(msg.benchmark);
  }
}

export function useWalletConnection(): void {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(0);
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
        if (!unmounted.current) {
          // Exponential backoff: 500ms, 1s, 2s, 4s, cap at 5s
          reconnectDelay.current = reconnectDelay.current === 0
            ? 500
            : Math.min(reconnectDelay.current * 2, 5000);
          store.addDiagnosticEvent({
            id: Date.now(),
            timestamp: Date.now(),
            level: 'warn',
            category: 'popup',
            message: `Port disconnected, reconnecting in ${reconnectDelay.current}ms`,
          });
          reconnectTimer.current = setTimeout(connect, reconnectDelay.current);
        }
      });

      // Reset backoff on successful connection
      reconnectDelay.current = 0;
      store.addDiagnosticEvent({
        id: Date.now(),
        timestamp: Date.now(),
        level: 'info',
        category: 'popup',
        message: 'Connected to service worker',
      });

      port.postMessage({ type: 'GET_STATE' });
      port.postMessage({ type: 'GET_DIAGNOSTIC_BACKLOG' });
      port.postMessage({ type: 'GET_CONNECT_STATUS' });
      port.postMessage({ type: 'GET_PROVING_STRATEGY' });
      port.postMessage({ type: 'GET_BENCHMARK' });
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

    // Read cached session state (wallet, socket, environment, proving status)
    chrome.storage.session.get(
      ['gsdEnvironment', 'gsdLastState', 'gsdSocketState', 'gsdProvingStatus'],
    ).then((result) => {
      const store = usePopupStore.getState();
      if (result['gsdLastState'] && !store.walletState) {
        store.setWalletState(result['gsdLastState'] as SerializedWalletState);
        if (store.hasVault === null) {
          store.setHasVault(true);
        }
      } else if (result['gsdEnvironment']) {
        store.setEnvironment(result['gsdEnvironment'] as import('@shared/types').Environment);
      }
      const cachedSocketState = result['gsdSocketState'] as import('@shared/types').SocketState | undefined;
      if (cachedSocketState) {
        store.setSocketState(cachedSocketState);
      }
      if (result['gsdProvingStatus']) {
        store.setProvingStatus(result['gsdProvingStatus'] as ProvingStatus);
      }
    });

    // Read diagnostic events from local storage (persists across extension reloads)
    chrome.storage.local.get('gsdDiagnosticEvents').then((result) => {
      const cachedEvents = result['gsdDiagnosticEvents'] as import('@shared/types').DiagnosticEvent[] | undefined;
      if (cachedEvents?.length) {
        usePopupStore.getState().addDiagnosticEventsBatch(cachedEvents);
      }
    });

    // Live state updates via storage change listener — works regardless of port state
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session') {
        if (changes['gsdLastState']?.newValue) {
          const state = changes['gsdLastState'].newValue as SerializedWalletState;
          const store = usePopupStore.getState();
          if (store.hasVault !== false) {
            if (store.hasVault === null) store.setHasVault(true);
            store.setWalletState(state);
          }
        }
        if (changes['gsdSocketState']?.newValue) {
          const store = usePopupStore.getState();
          store.setSocketState(changes['gsdSocketState'].newValue as import('@shared/types').SocketState);
        }
        if (changes['gsdProvingStatus']?.newValue) {
          const store = usePopupStore.getState();
          store.setProvingStatus(changes['gsdProvingStatus'].newValue as ProvingStatus);
        }
      }
      if (area === 'local') {
        if (changes['gsdDiagnosticEvents']?.newValue) {
          const store = usePopupStore.getState();
          store.addDiagnosticEventsBatch(changes['gsdDiagnosticEvents'].newValue as import('@shared/types').DiagnosticEvent[]);
        }
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    connect();

    return () => {
      unmounted.current = true;
      chrome.storage.onChanged.removeListener(storageListener);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (portRef.current) {
        portRef.current.disconnect();
      }
    };
  }, []);
}

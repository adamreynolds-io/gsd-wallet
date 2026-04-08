import { useCallback } from 'react';
import { usePopupStore } from '@popup/store/popupStore';
import type { SocketState } from '@shared/types';

const DEFAULT_CONNECT_URL = 'ws://localhost:6372';

export function useSocketToggle() {
  const socketState = usePopupStore((s) => s.socketState);
  const setSocketState = usePopupStore((s) => s.setSocketState);

  const sendSocketCommand = useCallback(
    (message: Record<string, unknown>) => {
      const port = chrome.runtime.connect({ name: 'gsd-popup' });
      port.onMessage.addListener(
        (msg: { type: string; state?: SocketState }) => {
          if (msg.type === 'CONNECT_STATUS' && msg.state !== undefined) {
            setSocketState(msg.state);
            port.disconnect();
          }
        },
      );
      port.postMessage(message);
    },
    [setSocketState],
  );

  const enable = useCallback(
    (url: string = DEFAULT_CONNECT_URL) => {
      sendSocketCommand({ type: 'SET_CONNECT_URL', url });
    },
    [sendSocketCommand],
  );

  const disable = useCallback(() => {
    sendSocketCommand({ type: 'SET_CONNECT_URL', url: '' });
  }, [sendSocketCommand]);

  const endSession = useCallback(() => {
    sendSocketCommand({ type: 'END_SOCKET_SESSION' });
  }, [sendSocketCommand]);

  const toggle = useCallback(
    (url: string = DEFAULT_CONNECT_URL) => {
      if (socketState === 'off') {
        enable(url);
      } else if (socketState === 'active') {
        endSession();
      } else {
        disable();
      }
    },
    [socketState, enable, endSession, disable],
  );

  return { socketState, toggle, enable, disable, endSession };
}

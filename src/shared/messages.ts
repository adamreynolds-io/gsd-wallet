import type {
  DeviceBenchmark,
  DiagnosticEvent,
  DiagnosticLevel,
  Environment,
  ProvingStatus,
  ProvingStrategy,
  SerializedWalletState,
  SocketState,
  TransactionResult,
  TxHistoryEntry,
} from './types';

// --- DApp <-> Service Worker (via content script bridge) ---

export type DAppRequest =
  | { type: 'GSD_CONNECT'; networkId: string; origin: string }
  | {
      type: 'GSD_API_CALL';
      method: string;
      args: unknown[];
      sessionId: string;
    }
  | {
      type: 'GSD_HINT_USAGE';
      methodNames: string[];
      sessionId: string;
    };

export type DAppResponse =
  | { type: 'GSD_RESPONSE'; requestId: string; result: unknown }
  | {
      type: 'GSD_ERROR';
      requestId: string;
      error: { code: string; reason: string };
    };

// --- Popup <-> Service Worker ---

export type PopupRequest =
  | { type: 'GET_STATE' }
  | { type: 'LOCK' }
  | {
      type: 'ADD_WALLET';
      name: string;
      seed: number[];
      environment: Environment;
    }
  | { type: 'SWITCH_WALLET'; index: number }
  | {
      type: 'SWITCH_ENVIRONMENT';
      environment: Environment;
      customUrls?: {
        nodeWsUrl: string;
        indexerHttpUrl: string;
        indexerWsUrl: string;
        provingServerUrl: string;
      };
    }
  | { type: 'GET_WALLETS'; environment: Environment }
  | { type: 'GET_ALL_WALLETS' }
  | { type: 'DELETE_WALLET'; index: number }
  | { type: 'GET_WALLET_SEED'; index: number }
  | { type: 'SEND_TRANSFER'; params: TransferRequest }
  | { type: 'DUST_REGISTER'; utxoIds: string[]; receiverAddress?: string }
  | { type: 'DUST_DEREGISTER'; utxoIds: string[] }
  | { type: 'CHECK_HAS_WALLETS' }
  | { type: 'GET_TX_HISTORY' }
  | { type: 'GET_DIAGNOSTIC_BACKLOG' }
  | { type: 'CLEAR_ALL' }
  | { type: 'EXPORT_CACHE' }
  | { type: 'SET_CONNECT_URL'; url: string }
  | { type: 'GET_CONNECT_STATUS' }
  | { type: 'END_SOCKET_SESSION' }
  | { type: 'SET_PROVING_STRATEGY'; strategy: ProvingStrategy }
  | { type: 'GET_PROVING_STRATEGY' }
  | { type: 'RUN_BENCHMARK' }
  | { type: 'GET_BENCHMARK' }
  | { type: 'CANCEL_WASM_PROVE' };

export type PopupResponse =
  | { type: 'STATE_UPDATE'; state: SerializedWalletState }
  | { type: 'WALLET_ADDED'; success: boolean; error?: string }
  | { type: 'WALLETS_LIST'; wallets: Array<{ index: number; name: string }> }
  | {
      type: 'ALL_WALLETS';
      wallets: Record<Environment, Array<{ index: number; name: string }>>;
      activeWalletIndex: number;
      activeEnvironment: Environment;
    }
  | { type: 'WALLET_DELETED'; success: boolean; error?: string }
  | { type: 'WALLET_SEED'; seedHex: string }
  | { type: 'TRANSFER_RESULT'; result: TransactionResult }
  | { type: 'DUST_REGISTER_RESULT'; result: TransactionResult }
  | { type: 'DUST_DEREGISTER_RESULT'; result: TransactionResult }
  | { type: 'HAS_WALLETS'; exists: boolean }
  | { type: 'TX_HISTORY'; entries: TxHistoryEntry[] }
  | { type: 'DIAGNOSTIC_EVENT'; event: DiagnosticEvent }
  | { type: 'DIAGNOSTIC_EVENTS_BATCH'; events: DiagnosticEvent[] }
  | { type: 'UPDATE_AVAILABLE'; currentVersion: string; latestVersion: string; releaseUrl: string; downloadUrl: string }
  | { type: 'ERROR'; error: string }
  | { type: 'EXPORT_CACHE_RESULT'; data: string }
  | { type: 'CONNECT_STATUS'; state: SocketState; sessionId?: string }
  | { type: 'WALLET_SWITCHED'; success: boolean }
  | { type: 'ENVIRONMENT_SWITCHED'; success: boolean }
  | { type: 'PROVING_STATUS'; status: ProvingStatus }
  | { type: 'PROVING_STRATEGY'; strategy: ProvingStrategy }
  | { type: 'BENCHMARK_RESULT'; benchmark: DeviceBenchmark | null }
  | { type: 'WASM_PROVE_CANCELLED'; success: boolean };

export interface TransferRequest {
  tokenType: 'shielded' | 'unshielded';
  tokenId: string;
  amount: string;
  receiverAddress: string;
}

// --- Service Worker <-> Offscreen (proving) ---

export type ProvingRequest = {
  type: 'PROVE_REQUEST';
  id: string;
  transaction: string;
};

export type ProvingResponse =
  | { type: 'PROVE_RESPONSE'; id: string; result: string }
  | { type: 'PROVE_ERROR'; id: string; error: string };

// --- Content Script bridge messages (window.postMessage) ---

export interface BridgeMessage {
  source: 'gsd-wallet-inpage' | 'gsd-wallet-content';
  payload: DAppRequest | DAppResponse;
  requestId: string;
}

// --- Service Worker <-> Offscreen (SDK host) ---

export type OffscreenEnvelope = OffscreenRequest | OffscreenResponse | OffscreenBroadcast;

export interface OffscreenRequest {
  id: string;
  type: OffscreenRequestType;
  payload: unknown;
}

export type OffscreenRequestType =
  | 'INIT_WALLET'
  | 'STOP_WALLET'
  | 'GET_STATE'
  | 'DAPP_API_CALL'
  | 'SEND_TRANSFER'
  | 'DUST_REGISTER'
  | 'DUST_DEREGISTER'
  | 'GET_TX_HISTORY'
  | 'GET_DIAGNOSTIC_BACKLOG'
  | 'EXPORT_CACHE'
  | 'SET_CONNECT_URL'
  | 'GET_CONNECT_STATUS'
  | 'GET_SOCKET_STATE'
  | 'END_SOCKET_SESSION'
  | 'SOCKET_DAPP_RESPONSE'
  | 'CANCEL_WASM_PROVE'
  | 'SET_PROVING_STRATEGY'
  | 'GET_PROVING_STRATEGY'
  | 'RUN_BENCHMARK'
  | 'GET_BENCHMARK';

export interface OffscreenResponse {
  id: string;
  type: 'RESPONSE' | 'ERROR';
  payload: unknown;
}

export interface OffscreenBroadcast {
  id: null;
  type: 'STATE_UPDATE' | 'DIAGNOSTIC_EVENT' | 'HEARTBEAT' | 'READY' | 'CONNECT_EVENT' | 'SOCKET_STATE_CHANGE' | 'SOCKET_DAPP_REQUEST' | 'PROVING_STATUS';
  payload: unknown;
}

// --- GSD Connect wire protocol (offscreen worker <-> Node.js WS server) ---

export interface ConnectEventPayload {
  level: DiagnosticLevel;
  message: string;
  data?: unknown;
  elapsed?: number;
  timestamp: number;
}

export type NodeToGsdMessage =
  | { type: 'TRACE_EVENT'; payload: ConnectEventPayload }
  | { type: 'DAPP_REQUEST'; requestId: string; payload: DAppRequest }
  | { type: 'GSD_DISCONNECT'; sessionId: string }
  | { type: 'PING' };

export type GsdToNodeMessage =
  | { type: 'DIAGNOSTIC_EVENT'; event: DiagnosticEvent }
  | { type: 'DAPP_RESPONSE'; requestId: string; payload: DAppResponse }
  | { type: 'STATE_UPDATE'; state: SerializedWalletState }
  | { type: 'SESSION_ENDED'; reason: string }
  | { type: 'CONNECTED' }
  | { type: 'PONG' };

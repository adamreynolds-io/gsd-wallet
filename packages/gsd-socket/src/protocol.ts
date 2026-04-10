export type SocketState = 'off' | 'waiting' | 'active';

// Diagnostic types (mirrors src/shared/types.ts from GSD Wallet)
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticCategory =
  | 'sw' | 'wallet' | 'state' | 'sync' | 'sdk'
  | 'dapp' | 'api' | 'popup' | 'tx' | 'indexer'
  | 'storage' | 'error' | 'connect';

export interface DiagnosticEvent {
  id: number;
  timestamp: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  message: string;
  data?: unknown;
  elapsed?: number;
}

export interface ConnectEventPayload {
  level: DiagnosticLevel;
  message: string;
  data?: unknown;
  elapsed?: number;
  timestamp: number;
}

// Wire protocol: Node.js -> GSD
export type NodeToGsdMessage =
  | { type: 'TRACE_EVENT'; payload: ConnectEventPayload }
  | { type: 'DAPP_REQUEST'; requestId: string; payload: DAppRequest }
  | { type: 'GSD_DISCONNECT'; sessionId: string }
  | { type: 'PING' };

// Wire protocol: GSD -> Node.js
export type GsdToNodeMessage =
  | { type: 'DIAGNOSTIC_EVENT'; event: DiagnosticEvent }
  | { type: 'DAPP_RESPONSE'; requestId: string; payload: DAppResponse }
  | { type: 'STATE_UPDATE'; state: unknown }
  | { type: 'CONNECTED' }
  | { type: 'SESSION_ENDED'; reason: string }
  | { type: 'PONG' };

export type DAppRequest =
  | { type: 'GSD_CONNECT'; networkId: string; origin: string }
  | { type: 'GSD_API_CALL'; method: string; args: unknown[]; sessionId: string }
  | { type: 'GSD_HINT_USAGE'; methodNames: string[]; sessionId: string };

export type DAppResponse =
  | { type: 'GSD_RESPONSE'; requestId: string; result: unknown }
  | { type: 'GSD_ERROR'; requestId: string; error: { code: string; reason: string } };

export interface ConnectServerConfig {
  port?: number;
  host?: string;
}

export interface ConnectClientConfig {
  port?: number;
  host?: string;
  origin?: string;
}

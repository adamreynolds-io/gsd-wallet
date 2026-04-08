export { GsdConnectServer, waitForExtension } from './server.js';
export type { ConnectServerConfig } from './protocol.js';

export { GsdWalletConnect } from './client.js';
export type { ConnectClientConfig } from './protocol.js';

export {
  createWalletProvider,
  createMidnightProvider,
  createProviders,
} from './providers.js';
export type {
  GsdWalletProvider,
  GsdMidnightProvider,
} from './providers.js';

export { createTracer } from './tracer.js';
export type { ConnectTracer } from './tracer.js';

export type {
  DiagnosticEvent,
  DiagnosticLevel,
  DiagnosticCategory,
  ConnectEventPayload,
  SocketState,
} from './protocol.js';

export { SessionEndedError } from './errors.js';

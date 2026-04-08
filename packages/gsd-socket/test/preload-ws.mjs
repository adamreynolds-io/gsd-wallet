// Preload script — runs before any ESM module evaluation.
// Sets globalThis.WebSocket so Apollo's WS transport finds it.
import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket;

// WebSocket polyfill for Node.js — required by Apollo (used by indexer subscriptions).
// Must be a separate module so the side-effect runs during ESM module evaluation,
// BEFORE any SDK module caches globalThis.WebSocket.
import { WebSocket } from 'ws';
// @ts-expect-error — assigning ws WebSocket to globalThis
globalThis.WebSocket = WebSocket;

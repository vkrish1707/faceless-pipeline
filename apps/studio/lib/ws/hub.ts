/**
 * Connection registry for the studio WebSocket hub.
 *
 * Sockets subscribe to one or more scopes (`"global"`, `"chapter:<id>"`,
 * `"render:<id>"`); broadcasts target a scope and reach every subscriber.
 *
 * The hub is process-singleton — `attachHub(wss)` must be called once from
 * the custom Next.js server (`apps/studio/server.ts`). In test/unit runs
 * `attachHub` is never called, so `broadcast` is a safe no-op via the
 * `getHub()` getter that returns `null` when uninitialised.
 *
 * Health: every 30s a ping is sent to each socket; sockets that haven't
 * responded with a pong in 90s are terminated. The implementation uses the
 * `ws` library's `ping`/`pong` so the protocol-level frame stays cheap.
 */

import type { ServerEvent, Scope } from "./types";

// Minimal structural type — keeps the hub testable without a real `ws`
// dependency. The custom server passes a real `WebSocket` from the `ws`
// package; tests can pass a stub.
export interface SocketLike {
  readyState: number;
  send: (data: string, cb?: (err?: Error) => void) => void;
  ping: () => void;
  terminate: () => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

// `ws` constants without taking a hard dep at the type level.
const READY_OPEN = 1;

export interface HubOptions {
  /** ms between ping frames; default 30s. */
  pingIntervalMs?: number;
  /** ms after which a socket without a pong is terminated; default 90s. */
  idleTimeoutMs?: number;
}

interface Entry {
  socket: SocketLike;
  scopes: Set<Scope>;
  lastPong: number;
}

export class WsHub {
  private entries = new Map<SocketLike, Entry>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pingIntervalMs: number;
  private readonly idleTimeoutMs: number;

  constructor(opts: HubOptions = {}) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 30_000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 90_000;
  }

  /** Register a socket (no scopes yet). */
  register(socket: SocketLike): void {
    if (this.entries.has(socket)) return;
    this.entries.set(socket, { socket, scopes: new Set(), lastPong: Date.now() });
    socket.on("pong", () => {
      const e = this.entries.get(socket);
      if (e) e.lastPong = Date.now();
    });
    socket.on("close", () => this.entries.delete(socket));
    socket.on("error", () => this.entries.delete(socket));
  }

  /** Add scopes to an already-registered socket. */
  subscribe(socket: SocketLike, scopes: Scope[]): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    for (const s of scopes) entry.scopes.add(s);
  }

  /** Remove scopes from an already-registered socket. */
  unsubscribe(socket: SocketLike, scopes: Scope[]): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    for (const s of scopes) entry.scopes.delete(s);
  }

  /** Remove a socket entirely. */
  unregister(socket: SocketLike): void {
    this.entries.delete(socket);
  }

  /** Number of active sockets — exposed for tests / stats. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Send `event` to every socket subscribed to `scope`. Sockets subscribed
   * to "global" receive every event regardless of `scope`. Send errors
   * (broken pipe, etc.) remove the offending socket from the registry.
   */
  broadcast(scope: Scope, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    const dead: SocketLike[] = [];
    for (const entry of this.entries.values()) {
      const matches = entry.scopes.has(scope) || entry.scopes.has("global");
      if (!matches) continue;
      if (entry.socket.readyState !== READY_OPEN) {
        dead.push(entry.socket);
        continue;
      }
      try {
        entry.socket.send(payload, (err) => {
          if (err) {
            this.entries.delete(entry.socket);
          }
        });
      } catch {
        dead.push(entry.socket);
      }
    }
    for (const s of dead) this.entries.delete(s);
  }

  /** Begin the periodic ping. Called by `attachHub`; tests can invoke it manually. */
  startHealthCheck(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => this.tick(), this.pingIntervalMs);
    // Don't keep the event loop alive solely for this timer.
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  /** Stop the periodic ping. */
  stopHealthCheck(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** One round of pings + idle-disconnects. Exposed for tests. */
  tick(): void {
    const now = Date.now();
    const dead: SocketLike[] = [];
    for (const entry of this.entries.values()) {
      if (now - entry.lastPong > this.idleTimeoutMs) {
        try {
          entry.socket.terminate();
        } catch {
          // ignore
        }
        dead.push(entry.socket);
        continue;
      }
      if (entry.socket.readyState !== READY_OPEN) continue;
      try {
        entry.socket.ping();
      } catch {
        dead.push(entry.socket);
      }
    }
    for (const s of dead) this.entries.delete(s);
  }

  /** Test/teardown hook. */
  clear(): void {
    this.stopHealthCheck();
    this.entries.clear();
  }
}

// Process-singleton. Lazily set when `attachHub` is called from the server.
let activeHub: WsHub | null = null;

export function getHub(): WsHub | null {
  return activeHub;
}

export function setHubForTesting(hub: WsHub | null): void {
  activeHub = hub;
}

// Minimal `ws.WebSocketServer` shape used by attachHub.
interface WsServerLike {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

/**
 * Attach the hub to a `ws.WebSocketServer` instance. Each incoming socket
 * is registered, and "message" frames are dispatched to subscribe /
 * unsubscribe / ping handlers.
 */
export function attachHub(wss: WsServerLike, opts: HubOptions = {}): WsHub {
  const hub = activeHub ?? new WsHub(opts);
  activeHub = hub;
  hub.startHealthCheck();

  wss.on("connection", (...args: unknown[]) => {
    const socket = args[0] as SocketLike;
    hub.register(socket);

    // Send a hello so the client can confirm liveness.
    try {
      socket.send(JSON.stringify({ type: "hello", serverTime: Date.now() }));
    } catch {
      // ignore — handled by `register`'s close/error listeners
    }

    socket.on("message", (...msgArgs: unknown[]) => {
      const raw = msgArgs[0];
      let text: string;
      if (typeof raw === "string") text = raw;
      else if (raw instanceof Buffer) text = raw.toString("utf8");
      else text = String(raw);
      let msg: { type?: string; scopes?: Scope[] };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg?.type === "subscribe" && Array.isArray(msg.scopes)) {
        hub.subscribe(socket, msg.scopes);
      } else if (msg?.type === "unsubscribe" && Array.isArray(msg.scopes)) {
        hub.unsubscribe(socket, msg.scopes);
      } else if (msg?.type === "ping") {
        try {
          socket.send(JSON.stringify({ type: "hello", serverTime: Date.now() }));
        } catch {
          // ignore
        }
      }
    });
  });

  return hub;
}

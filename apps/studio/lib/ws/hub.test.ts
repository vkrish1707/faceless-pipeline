import { describe, it, expect, vi } from "vitest";
import { WsHub, type SocketLike } from "./hub";

/**
 * Build a minimal fake socket that records every `send` and exposes the
 * recorded payloads as parsed JSON for assertions.
 */
function makeSocket(readyState = 1) {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener[]>();
  const sent: string[] = [];
  const pings: number[] = [];
  let terminated = false;
  const sock = {
    readyState,
    send: vi.fn((data: string, cb?: (err?: Error) => void) => {
      sent.push(data);
      cb?.();
    }),
    ping: vi.fn(() => {
      pings.push(Date.now());
    }),
    terminate: vi.fn(() => {
      terminated = true;
    }),
    close: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return sock;
    }),
    emit(event: string, ...args: unknown[]) {
      for (const l of listeners.get(event) ?? []) l(...args);
    },
  };
  return {
    sock: sock as unknown as SocketLike & {
      emit: (event: string, ...args: unknown[]) => void;
    },
    sent,
    pings,
    isTerminated: () => terminated,
  };
}

describe("WsHub.subscribe + broadcast", () => {
  it("delivers an event to sockets subscribed to the matching scope", () => {
    const hub = new WsHub();
    const a = makeSocket();
    const b = makeSocket();
    hub.register(a.sock);
    hub.register(b.sock);
    hub.subscribe(a.sock, ["chapter:cid-1"]);
    hub.subscribe(b.sock, ["chapter:cid-2"]);

    hub.broadcast("chapter:cid-1", {
      type: "job.update",
      jobId: "j1",
      status: "running",
      progress: 42,
    });

    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!)).toMatchObject({
      type: "job.update",
      jobId: "j1",
      progress: 42,
    });
    expect(b.sent).toHaveLength(0);
  });

  it("global scope receives every event regardless of broadcast scope", () => {
    const hub = new WsHub();
    const g = makeSocket();
    hub.register(g.sock);
    hub.subscribe(g.sock, ["global"]);
    hub.broadcast("render:r1", {
      type: "render.update",
      renderId: "r1",
      status: "render",
      progress: 25,
    });
    hub.broadcast("chapter:c1", {
      type: "job.update",
      jobId: "j1",
      status: "running",
      progress: 10,
    });
    expect(g.sent).toHaveLength(2);
  });

  it("unsubscribe stops further delivery", () => {
    const hub = new WsHub();
    const a = makeSocket();
    hub.register(a.sock);
    hub.subscribe(a.sock, ["chapter:cid-1"]);
    hub.broadcast("chapter:cid-1", {
      type: "job.update",
      jobId: "j1",
      status: "queued",
      progress: 0,
    });
    expect(a.sent).toHaveLength(1);
    hub.unsubscribe(a.sock, ["chapter:cid-1"]);
    hub.broadcast("chapter:cid-1", {
      type: "job.update",
      jobId: "j1",
      status: "running",
      progress: 50,
    });
    expect(a.sent).toHaveLength(1);
  });

  it("disconnect cleanup: socket is removed on 'close'", () => {
    const hub = new WsHub();
    const a = makeSocket();
    hub.register(a.sock);
    hub.subscribe(a.sock, ["global"]);
    expect(hub.size()).toBe(1);
    a.sock.emit("close");
    expect(hub.size()).toBe(0);
    // broadcast after close is a no-op for that socket.
    hub.broadcast("global", { type: "hello", serverTime: 1 });
    expect(a.sent).toHaveLength(0);
  });

  it("removes dead sockets on broadcast (readyState ≠ OPEN)", () => {
    const hub = new WsHub();
    const a = makeSocket(3); // CLOSED
    hub.register(a.sock);
    hub.subscribe(a.sock, ["global"]);
    hub.broadcast("global", { type: "hello", serverTime: 1 });
    expect(a.sent).toHaveLength(0);
    expect(hub.size()).toBe(0);
  });

  it("removes a socket whose send throws synchronously", () => {
    const hub = new WsHub();
    const a = makeSocket();
    (a.sock.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("EPIPE");
    });
    hub.register(a.sock);
    hub.subscribe(a.sock, ["global"]);
    hub.broadcast("global", { type: "hello", serverTime: 1 });
    expect(hub.size()).toBe(0);
  });
});

describe("WsHub.tick (ping/pong + idle cleanup)", () => {
  it("pings every open socket on tick()", () => {
    const hub = new WsHub({ pingIntervalMs: 30_000, idleTimeoutMs: 90_000 });
    const a = makeSocket();
    hub.register(a.sock);
    hub.tick();
    expect(a.sock.ping).toHaveBeenCalledTimes(1);
  });

  it("terminates sockets whose lastPong is older than idleTimeoutMs", () => {
    const hub = new WsHub({ pingIntervalMs: 1_000, idleTimeoutMs: 50 });
    const a = makeSocket();
    hub.register(a.sock);
    // Wait synchronously by overriding lastPong via a fresh pong-less window.
    const past = Date.now() - 1000;
    // Reach into the entry by emitting a pong far in the past would still set
    // it to Date.now(); easier path: just sleep ≥ idleTimeoutMs.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        hub.tick();
        expect(a.isTerminated()).toBe(true);
        expect(hub.size()).toBe(0);
        resolve();
      }, 60);
    });
    // `past` referenced to satisfy noUnusedLocals when the test runs the
    // setTimeout branch — guard against linter false-positives.
    void past;
  });

  it("pong refreshes lastPong so the socket isn't reaped", async () => {
    const hub = new WsHub({ pingIntervalMs: 1_000, idleTimeoutMs: 50 });
    const a = makeSocket();
    hub.register(a.sock);
    await new Promise((r) => setTimeout(r, 30));
    a.sock.emit("pong");
    await new Promise((r) => setTimeout(r, 30));
    hub.tick();
    expect(a.isTerminated()).toBe(false);
    expect(hub.size()).toBe(1);
  });
});

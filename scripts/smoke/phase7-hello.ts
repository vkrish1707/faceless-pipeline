import { config } from "dotenv";
config({ path: ".env.local" });

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { attachHub } from "../../apps/studio/lib/ws/hub";
import { emit } from "../../apps/studio/lib/jobs/emit";
import type { ServerEvent } from "../../apps/studio/lib/ws/types";

/**
 * Phase 7 smoke. Spins up a bare HTTP server + WebSocketServer in-process
 * (no Next.js — that boot cost is not worth it for a smoke), attaches the
 * hub, connects a WS client, subscribes to "global", then directly invokes
 * `emit(...)` to simulate a job-status transition. Asserts the client
 * receives at least one `job.update` payload with `progress > 0`.
 *
 * This is the minimal end-to-end check for the WS wiring:
 *   emit() → hub.broadcast → ws.WebSocket.send → client onmessage
 */

function fail(reason: string, server?: { close: () => void }): never {
  console.error(`FAIL: ${reason}`);
  if (server) server.close();
  process.exit(1);
}

async function main() {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server, path: "/api/ws" });
  attachHub(wss);

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("no addr"));
    });
  });

  console.log(`==> server listening on :${port}`);

  const received: ServerEvent[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
  let resolved = false;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error("WS open timeout"));
    }, 5000);
    ws.on("open", () => {
      resolved = true;
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", reject);
  });

  console.log("==> WS open");

  // Subscribe to global.
  ws.send(JSON.stringify({ type: "subscribe", scopes: ["global"] }));

  ws.on("message", (data) => {
    try {
      const ev = JSON.parse(data.toString()) as ServerEvent;
      received.push(ev);
    } catch {
      // ignore
    }
  });

  // Small delay so the server processes the subscribe before we broadcast.
  await new Promise((r) => setTimeout(r, 50));

  // Simulate a job lifecycle.
  emit({ jobId: "smoke-job-1", jobType: "render_script", status: "running", progress: 10 });
  emit({ jobId: "smoke-job-1", jobType: "render_script", status: "running", progress: 50 });
  emit({ jobId: "smoke-job-1", jobType: "render_script", status: "completed", progress: 100 });

  // Wait for events to arrive.
  await new Promise((r) => setTimeout(r, 200));

  const jobUpdates = received.filter(
    (e) => e.type === "job.update" && typeof (e as { progress?: number }).progress === "number"
  );
  const withProgress = jobUpdates.filter((e) => (e as { progress: number }).progress > 0);

  ws.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (received.length === 0) {
    fail("client received no events at all");
  }
  if (withProgress.length === 0) {
    fail(
      `expected ≥1 job.update with progress > 0; received ${received.length} events: ${JSON.stringify(received)}`
    );
  }

  console.log(`OK: received ${received.length} events (${withProgress.length} job.updates with progress > 0)`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

/**
 * Custom Next.js server that wraps the standard request handler in
 * `node:http` and attaches a `ws.WebSocketServer` on the same port at
 * `/api/ws`. Replaces `next dev` / `next start`; the original commands are
 * preserved as `dev:next` / `start:next` for easy fallback.
 *
 * Wiring this lives outside the Next.js runtime so the hub instance is
 * shared across every route handler (the singleton in `lib/ws/hub.ts`).
 */

import { createServer } from "node:http";
import next from "next";
import path from "node:path";
import { WebSocketServer } from "ws";
import { attachHub } from "./lib/ws/hub";

const dev = process.env.NODE_ENV !== "production";
// Resolve the app dir so the server can be invoked from the repo root.
const dir = path.resolve(__dirname);
const app = next({ dev, dir });
const handler = app.getRequestHandler();

async function main() {
  await app.prepare();
  const server = createServer((req, res) => handler(req, res));
  const wss = new WebSocketServer({ server, path: "/api/ws" });
  attachHub(wss);

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`studio on :${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[studio] failed to start:", err);
  process.exit(1);
});

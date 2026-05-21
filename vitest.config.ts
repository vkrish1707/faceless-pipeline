import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/studio"),
    },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
    ],
    globals: false,
    environment: "node",
    // Several test files mutate the shared SQLite DB. Run files sequentially so
    // their beforeEach deletions don't race across workers.
    fileParallelism: false,
  },
});

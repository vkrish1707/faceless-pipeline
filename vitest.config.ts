import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: false,
    environment: "node",
    // Several test files mutate the shared SQLite DB. Run files sequentially so
    // their beforeEach deletions don't race across workers.
    fileParallelism: false,
  },
});

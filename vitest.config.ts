import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Kuzu native bindings + temp DB files: avoid parallel DB-file contention.
    pool: "forks",
    testTimeout: 30_000,
  },
});

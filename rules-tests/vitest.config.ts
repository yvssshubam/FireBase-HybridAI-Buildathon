import { defineConfig } from "vitest/config";

// Emulator tests share one Firestore/Storage instance, so run files serially.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

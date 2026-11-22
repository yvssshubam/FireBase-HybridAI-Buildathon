import { defineConfig } from "vitest/config";

// Unit tests cover pure modules only (no DOM, no Firebase network calls).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

// Without its own config, vitest would use the Workstreams plugin's above.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});

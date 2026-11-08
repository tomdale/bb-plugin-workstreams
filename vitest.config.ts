import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // Each process owns its native modules; VM contexts isolate test globals
    // while reusing compiled dependencies. More workers contend with Chrome.
    pool: "vmForks",
    maxWorkers: Math.min(8, availableParallelism()),
    vmMemoryLimit: "512MB",
  },
});

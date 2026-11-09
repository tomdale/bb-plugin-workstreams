import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import galleryConfig from "./vite.config.ts";

export default defineConfig({
  ...galleryConfig,
  build: {
    ...galleryConfig.build,
    emptyOutDir: false,
    rollupOptions: {
      ...galleryConfig.build?.rollupOptions,
      input: fileURLToPath(new URL("./sidebar-profile.html", import.meta.url)),
    },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the preview host's stylesheet into one text file the host entry
 * bundles (`src/server/inference/presentation/styles.ts`). The host artifact
 * is a single file, so fonts are inlined and nothing is fetched at preview
 * time.
 */
export const PREVIEW_STYLES_FILE = "document-css.txt";

function emitText(): Plugin {
  return {
    name: "preview-styles-text",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const css = Object.values(bundle).find(
        (file) => file.type === "asset" && file.fileName.endsWith(".css"),
      );
      if (!css || css.type !== "asset")
        throw new Error("Preview build produced no stylesheet");
      for (const name of Object.keys(bundle)) delete bundle[name];
      this.emitFile({
        type: "asset",
        fileName: PREVIEW_STYLES_FILE,
        source: String(css.source),
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [tailwindcss(), emitText()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
  },
  logLevel: "warn",
  build: {
    outDir: process.env.PREVIEW_OUT_DIR || "dist",
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: fileURLToPath(new URL("./document.css", import.meta.url)),
    },
  },
});

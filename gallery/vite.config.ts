import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pages = { gallery: "./index.html", sidebar: "./sidebar.html" } as const;
type Page = keyof typeof pages;

/**
 * Inlines a build's script and styles into its HTML page. The built gallery is
 * opened straight from `dist/` as a `file://` page, where Chrome refuses to
 * load an external module script. An inline module needs no fetch, so the page
 * works without a server. The script must be one chunk, which is why each page
 * is its own build (see `gallery:build`).
 */
function inlineAssets(): Plugin {
  return {
    name: "gallery-inline-assets",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, { bundle }) {
        if (!bundle) return html;
        const take = (href: string) => {
          const name = href.replace(/^\.\//, "");
          const chunk = bundle[name];
          delete bundle[name];
          if (!chunk) throw new Error(`Gallery build has no ${name}`);
          return chunk.type === "chunk" ? chunk.code : String(chunk.source);
        };
        return html
          .replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
            (_, src) =>
              `<script type="module">${take(src).replace(/<\/script/gi, "<\\/script")}</script>`,
          )
          .replace(
            /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
            (_, href) => `<style>${take(href)}</style>`,
          )
          .replace(/<link rel="modulepreload"[^>]*>/g, "");
      },
    },
  };
}

const page = process.env.GALLERY_PAGE as Page | undefined;
if (page !== undefined && !(page in pages))
  throw new Error(`GALLERY_PAGE must be one of: ${Object.keys(pages)}`);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss(), inlineAssets()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
  },
  server: { host: "127.0.0.1" },
  build: {
    outDir: "dist",
    // Fonts and icons travel inside the page, so it has no sibling files.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    // The second page's build adds to the first's output.
    emptyOutDir: page !== "sidebar",
    rollupOptions: {
      input: fileURLToPath(new URL(pages[page ?? "gallery"], import.meta.url)),
      output: { codeSplitting: false },
    },
  },
});

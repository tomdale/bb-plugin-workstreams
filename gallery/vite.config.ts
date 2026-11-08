import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
  },
  server: { host: "127.0.0.1" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        gallery: fileURLToPath(new URL("./index.html", import.meta.url)),
        sidebar: fileURLToPath(new URL("./sidebar.html", import.meta.url)),
      },
    },
  },
});

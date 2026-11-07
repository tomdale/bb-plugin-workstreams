// Bundles the page into one self-contained file: dist/queue-motion.html.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const r = await build({
  entryPoints: [path.join(here, "src/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  loader: { ".js": "js", ".mjs": "js" },
});
const js = r.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>");
const css = fs.readFileSync(path.join(here, "src/page.css"), "utf8");
const html = fs
  .readFileSync(path.join(here, "src/page.html"), "utf8")
  .replace("/*CSS*/", () => css)
  .replace("/*JS*/", () => js);
fs.mkdirSync(path.join(here, "dist"), { recursive: true });
const out = path.join(here, "dist/queue-motion.html");
fs.writeFileSync(out, html);
console.log(
  `${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`,
);

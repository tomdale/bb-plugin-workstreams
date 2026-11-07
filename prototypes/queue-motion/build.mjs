// Bundles the page into one self-contained file: dist/queue-motion.html.
//
// The tooltips quote the sweeps, so the build runs them (`computeFacts`, sim/sweep.mjs) and hands the numbers to
// help.ts as `__FACTS__`. It then checks that every control has a tooltip and every tooltip a control
// (src/verify.ts), and fails when they disagree.
import { build } from "esbuild";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFacts } from "./sim/sweep.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = { ".js": "js", ".mjs": "js" };

/**
 * The sweeps' numbers. They depend only on the model and the sim files, so a build reuses the last result
 * (dist/facts.json) until one of those files changes.
 */
function sweepFacts() {
  const files = [
    "src/drum.mjs",
    ...fs
      .readdirSync(path.join(here, "sim"))
      .sort()
      .map((f) => `sim/${f}`),
  ];
  const hash = crypto
    .createHash("sha256")
    .update(
      files
        .map((f) => f + fs.readFileSync(path.join(here, f), "utf8"))
        .join("\0"),
    )
    .digest("hex");
  const cache = path.join(here, "dist/facts.json");
  if (fs.existsSync(cache)) {
    const saved = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (saved.hash === hash) return { facts: saved.facts, cached: true };
  }
  const facts = computeFacts();
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ hash, facts }));
  return { facts, cached: false };
}

const started = Date.now();
const { facts, cached } = sweepFacts();
console.log(
  cached
    ? "sweeps: unchanged since the last build"
    : `sweeps: ran in ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
const define = { __FACTS__: JSON.stringify(facts) };

// Controls and tooltips must agree. The check runs in Node, on a bundle of the same modules the page uses.
const check = await build({
  entryPoints: [path.join(here, "src/verify.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  loader,
  define,
});
const { verify } = await import(
  "data:text/javascript;base64," +
    Buffer.from(check.outputFiles[0].text).toString("base64")
);
const problems = verify();
if (problems.length) {
  console.error(`tooltips and controls disagree:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const r = await build({
  entryPoints: [path.join(here, "src/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  loader,
  define,
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

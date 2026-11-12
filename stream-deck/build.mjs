// Bundles the plugin into the .sdPlugin folder Stream Deck runs. `--watch`
// rebuilds on change and restarts the plugin in a linked Stream Deck.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const UUID = "com.tomdale.bb-workstreams";
const bin = `${UUID}.sdPlugin/bin`;
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/plugin.ts"],
  outfile: `${bin}/plugin.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  // ws is CommonJS; its require() calls need a real require in an ES module.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  plugins: watch
    ? [
        {
          name: "restart",
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0)
                execFile("npx", ["streamdeck", "restart", UUID]);
            });
          },
        },
      ]
    : [],
};

if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
// Marks bin/ as ES modules for the Node.js Stream Deck runs it with.
await writeFile(`${bin}/package.json`, '{ "type": "module" }\n');

/*
 * Builds the preview host's real stylesheet once per test module, the way
 * `npm run build` does, into a temporary directory.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

let styles: Promise<string> | undefined;

export function previewStyles(): Promise<string> {
  return (styles ??= (async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const output = mkdtempSync(join(tmpdir(), "workstreams-preview-"));
    try {
      await promisify(execFile)(
        process.execPath,
        [
          `${root}node_modules/vite/bin/vite.js`,
          "build",
          "--config",
          `${root}preview/vite.config.ts`,
        ],
        {
          cwd: root,
          env: { ...process.env, NO_COLOR: "1", PREVIEW_OUT_DIR: output },
        },
      );
      return readFileSync(join(output, "document-css.txt"), "utf8");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  })());
}

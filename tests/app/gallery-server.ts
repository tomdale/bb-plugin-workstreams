import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type GalleryServer = {
  /** The server's address, ending in a slash. */
  url: string;
  stop(): Promise<void>;
};

/**
 * Starts a Vite dev server on `gallery/vite.config.ts` and resolves once it
 * prints its address. The server gets a dependency cache of its own: servers
 * that share `node_modules/.vite` replace each other's optimized files while
 * pages are loading them, which fails those pages' module requests with 504
 * (see `cacheDir` in the config). `serveRepoRoot` serves the repository root
 * instead of `gallery/`, for pages such as `tests/app/vivid.html`.
 */
export async function startGalleryServer({
  serveRepoRoot = false,
}: { serveRepoRoot?: boolean } = {}): Promise<GalleryServer> {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const cacheDir = mkdtempSync(join(tmpdir(), "gallery-vite-"));
  const server = spawn(
    process.execPath,
    [
      `${root}node_modules/vite/bin/vite.js`,
      ...(serveRepoRoot ? [root] : []),
      "--config",
      `${root}gallery/vite.config.ts`,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", GALLERY_CACHE_DIR: cacheDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    rmSync(cacheDir, { recursive: true, force: true });
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`Gallery did not start: ${output}`)),
        50_000,
      );
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      server.stdout!.on("data", read);
      server.stderr!.on("data", read);
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Gallery exited (${code}): ${output}`));
      });
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

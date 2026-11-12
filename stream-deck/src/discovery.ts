/**
 * Finds the BB server and Workstreams' plugin token on this computer, the way
 * the `bb` CLI does: the server URL from BB's data directory, and the token
 * from `bb plugin token workstreams`. Global settings override either one,
 * for a server the CLI here doesn't point at.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The plugin's global settings, as its property inspectors save them. */
export type GlobalSettings = {
  readonly serverUrl?: string;
  readonly token?: string;
};

export type Discovery = {
  /** The server's origin, without a trailing slash. */
  readonly serverUrl: string;
  readonly token: string;
  /** Whether the token came from settings, so asking the CLI again won't help. */
  readonly tokenFromSettings: boolean;
  /** The BB desktop app to bring forward after opening a thread, if known. */
  readonly app: string | null;
};

export class DiscoveryError extends Error {
  constructor(
    readonly reason: "no-bb" | "no-token",
    message: string,
  ) {
    super(message);
  }
}

/** What discovery reads from the computer; tests pass their own. */
export type DiscoveryIo = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly platform: string;
  /** A file's parsed JSON, or null when it is missing or unreadable. */
  readJson(path: string): Promise<unknown>;
  /** Runs a program and resolves with its standard output. */
  run(
    file: string,
    args: readonly string[],
    env: Record<string, string | undefined>,
  ): Promise<string>;
};

export const nodeIo: DiscoveryIo = {
  env: process.env,
  home: homedir(),
  platform: process.platform,
  readJson: async (path) => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  },
  run: (file, args, env) =>
    new Promise((resolve, reject) =>
      execFile(
        file,
        [...args],
        { env, timeout: 20_000, maxBuffer: 64 * 1024 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    ),
};

const field = (value: unknown, key: string): string | null => {
  const found =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  return typeof found === "string" && found.trim() ? found.trim() : null;
};

/** An http(s) URL's origin and path without a trailing slash, else null. */
export function serverOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export async function discover(
  settings: GlobalSettings,
  io: DiscoveryIo = nodeIo,
): Promise<Discovery> {
  const dataDir = io.env.BB_DATA_DIR?.trim() || join(io.home, ".bb");
  const runtime = await io.readJson(join(dataDir, "bb-app-runtime.json"));
  const serverUrl =
    serverOrigin(settings.serverUrl) ??
    serverOrigin(
      field(await io.readJson(join(dataDir, "config.json")), "serverUrl"),
    ) ??
    serverOrigin(field(runtime, "serverUrl"));
  if (!serverUrl)
    throw new DiscoveryError(
      "no-bb",
      `No BB server URL in ${dataDir} or the plugin's settings.`,
    );

  // The desktop app records where it runs from; its bundle is what `open`
  // brings forward. A browser or phone surface has nothing to bring forward.
  const entry = field(runtime, "entryPath");
  const app =
    io.platform === "darwin" && field(runtime, "surface") === "desktop"
      ? (entry?.match(/^(.+?\.app)\//)?.[1] ?? null)
      : null;

  const configured = settings.token?.trim();
  if (configured)
    return { serverUrl, token: configured, tokenFromSettings: true, app };
  const cli = join(dataDir, "bin", "bb");
  let output: string;
  try {
    output = await io.run(cli, ["plugin", "token", "workstreams", "--json"], {
      HOME: io.home,
      PATH: io.env.PATH,
      BB_DATA_DIR: dataDir,
      BB_SERVER_URL: serverUrl,
    });
  } catch (error) {
    throw new DiscoveryError(
      "no-token",
      `Running ${cli} plugin token workstreams failed: ${String(error)}`,
    );
  }
  let token: string | null = null;
  try {
    token = field(JSON.parse(output), "token");
  } catch {
    // Reported below with the rest.
  }
  if (!token)
    throw new DiscoveryError(
      "no-token",
      "bb plugin token workstreams printed no token.",
    );
  return { serverUrl, token, tokenFromSettings: false, app };
}

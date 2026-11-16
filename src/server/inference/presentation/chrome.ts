/**
 * A minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`,
 * for the preview host. It launches a private headless Chrome with a
 * throwaway profile and talks to it on file descriptors 3 and 4, so no port
 * is opened. Only the commands the preview needs are used; the caller blocks
 * every network request.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** The Chrome to run: `CHROME_PATH`, then the usual install locations. */
export function findChrome(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.CHROME_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

export type CdpEvent = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

export class ChromeSession {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private buffer = "";
  private closed = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly input: Writable,
    output: Readable,
    private readonly profile: string,
  ) {
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => this.receive(chunk));
    const fail = (error: Error) => this.failAll(error);
    child.once("exit", () => fail(new Error("Chrome exited.")));
    child.once("error", (error) => fail(error));
    input.on("error", fail);
  }

  static async launch(options: {
    executablePath: string;
    signal?: AbortSignal;
  }): Promise<ChromeSession> {
    const profile = await mkdtemp(join(tmpdir(), "ws-preview-"));
    const child = spawn(
      options.executablePath,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-component-update",
        "--disable-default-apps",
        "--mute-audio",
        "--hide-scrollbars",
        // Every name resolves nowhere, so even a request the page could make
        // has no destination.
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    const input = child.stdio[3] as Writable | null;
    const output = child.stdio[4] as Readable | null;
    if (!input || !output) {
      child.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true });
      throw new Error("Chrome did not open its DevTools pipe.");
    }
    const session = new ChromeSession(child, input, output, profile);
    options.signal?.addEventListener("abort", () => void session.close(), {
      once: true,
    });
    return session;
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\0")) !== -1) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let message: {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof message.id === "number") {
        const waiter = this.pending.get(message.id);
        if (!waiter) continue;
        this.pending.delete(message.id);
        if (message.error)
          waiter.reject(new Error(message.error.message ?? "CDP error"));
        else waiter.resolve(message.result ?? {});
      } else if (message.method) {
        for (const listener of this.listeners)
          listener({
            method: message.method,
            params: message.params ?? {},
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          });
      }
    }
  }

  private failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("Chrome is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(
        `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
      );
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Chrome is closed."));
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null)
        resolve();
      else this.child.once("exit", () => resolve());
    });
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2_000);
    await exited;
    clearTimeout(timer);
    await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

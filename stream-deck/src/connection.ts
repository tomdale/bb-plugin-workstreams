/**
 * The plugin's one connection to Workstreams: Up Next arrives over the live
 * WebSocket, and key presses go out as POSTs. It connects while any key or
 * dial shows Up Next and closes when none does.
 *
 * A dropped connection keeps the last snapshot on the keys for a few seconds
 * while it reconnects, so a Workstreams reload doesn't flash every key. A
 * refused token is asked for again once, since BB rotates it with
 * `bb plugin token workstreams --rotate`.
 */
import WebSocket from "ws";
import {
  parseStreamDeckSnapshot,
  STREAM_DECK_ROUTES,
  type StreamDeckSnapshot,
} from "../../src/domain/streamDeck.ts";
import {
  DiscoveryError,
  type Discovery,
  type GlobalSettings,
} from "./discovery.ts";
import type { Notice } from "./render.ts";

export type UpNextState =
  | { readonly status: "ready"; readonly snapshot: StreamDeckSnapshot }
  | { readonly status: Notice };

/** Where BB mounts Workstreams' HTTP routes. */
const ROUTES = "/api/v1/plugins/workstreams/http";

export type Timing = {
  /** Waits before each reconnect after a dropped connection, in order. */
  readonly backoff: readonly number[];
  /** Waits before trying again when BB can't be found or refuses us. */
  readonly setupRetry: number;
  /** How long the last snapshot stays up while reconnecting. */
  readonly stale: number;
  /** How often the socket checks that the server still answers. */
  readonly ping: number;
};

const TIMING: Timing = {
  backoff: [1_000, 2_000, 5_000, 10_000, 30_000],
  setupRetry: 30_000,
  stale: 10_000,
  ping: 30_000,
};

export type ConnectionDeps = {
  readonly discover: (settings: GlobalSettings) => Promise<Discovery>;
  /** Brings the BB desktop app forward after a press opened something. */
  readonly bringForward: (app: string) => void;
  readonly log: (message: string) => void;
  readonly timing?: Partial<Timing>;
};

export class UpNextConnection {
  private state: UpNextState = { status: "connecting" };
  private readonly listeners = new Set<(state: UpNextState) => void>();
  private settings: GlobalSettings = {};
  private discovery: Promise<Discovery> | null = null;
  private socket: WebSocket | null = null;
  /** Advances on every start and stop, so stale callbacks can tell. */
  private generation = 0;
  private attempts = 0;
  private tokenRefreshed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly timing: Timing;

  constructor(private readonly deps: ConnectionDeps) {
    this.timing = { ...TIMING, ...deps.timing };
  }

  get current(): UpNextState {
    return this.state;
  }

  /** Calls `listener` now and on every change; the first one connects. */
  subscribe(listener: (state: UpNextState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    if (this.listeners.size === 1) this.start();
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0)
        this.stop();
    };
  }

  /** Uses new global settings, reconnecting when they change anything. */
  configure(settings: GlobalSettings): void {
    const next = {
      serverUrl: settings.serverUrl?.trim() || undefined,
      token: settings.token?.trim() || undefined,
    };
    if (
      next.serverUrl === this.settings.serverUrl &&
      next.token === this.settings.token
    )
      return;
    this.settings = next;
    this.discovery = null;
    this.reconnect();
  }

  /** Reconnects now, as after the computer wakes from sleep. */
  reconnect(): void {
    if (this.listeners.size === 0) return;
    this.disconnect();
    this.start();
  }

  /** Opens a thread in BB; false when Workstreams didn't take the press. */
  open(threadId: string): Promise<boolean> {
    return this.command(STREAM_DECK_ROUTES.open, { threadId });
  }

  /** Has each BB app open its next Up Next thread. */
  next(): Promise<boolean> {
    return this.command(STREAM_DECK_ROUTES.next, {});
  }

  private async command(path: string, body: object): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let found: Discovery;
      try {
        found = await this.found();
      } catch (error) {
        this.deps.log(`Can't send ${path}: ${String(error)}`);
        return false;
      }
      let response: Response;
      try {
        response = await fetch(`${found.serverUrl}${ROUTES}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bb-plugin-token": found.token,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        this.deps.log(`Sending ${path} failed: ${String(error)}`);
        return false;
      }
      if (
        refused(response.status) &&
        !found.tokenFromSettings &&
        attempt === 0
      ) {
        this.discovery = null;
        continue;
      }
      if (!response.ok) {
        this.deps.log(`${path} answered ${response.status}`);
        return false;
      }
      if (found.app) this.deps.bringForward(found.app);
      return true;
    }
    return false;
  }

  private found(): Promise<Discovery> {
    const pending = (this.discovery ??= this.deps.discover(this.settings));
    pending.catch(() => {
      if (this.discovery === pending) this.discovery = null;
    });
    return pending;
  }

  private set(state: UpNextState): void {
    if (
      state.status === this.state.status &&
      (state.status !== "ready" ||
        (this.state.status === "ready" &&
          state.snapshot === this.state.snapshot))
    )
      return;
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }

  private start(): void {
    void this.connect(++this.generation);
  }

  /** Closes the socket and cancels timers, keeping what the keys show. */
  private disconnect(): void {
    this.generation++;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.on("error", () => {});
    socket?.terminate();
    this.attempts = 0;
    this.tokenRefreshed = false;
  }

  private stop(): void {
    this.disconnect();
    this.state = { status: "connecting" };
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = this.staleTimer = this.pingTimer = null;
  }

  private retry(generation: number, delay: number): void {
    if (generation !== this.generation) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation) void this.connect(++this.generation);
    }, delay);
  }

  /** The keys show the last snapshot a while longer, then say BB is gone. */
  private lose(): void {
    if (this.state.status !== "ready") return this.set({ status: "offline" });
    if (this.staleTimer) return;
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      this.set({ status: "offline" });
    }, this.timing.stale);
  }

  private async connect(generation: number): Promise<void> {
    let found: Discovery;
    try {
      found = await this.found();
    } catch (error) {
      if (generation !== this.generation) return;
      this.deps.log(`Finding BB failed: ${String(error)}`);
      this.set({
        status: error instanceof DiscoveryError ? error.reason : "no-bb",
      });
      return this.retry(generation, this.timing.setupRetry);
    }
    if (generation !== this.generation) return;

    const url = new URL(
      `${found.serverUrl}${ROUTES}${STREAM_DECK_ROUTES.live}`,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, {
      headers: { "x-bb-plugin-token": found.token },
      handshakeTimeout: 10_000,
    });
    this.socket = socket;
    let answered = true;
    let rejectedWith: number | null = null;

    socket.on("open", () => {
      this.attempts = 0;
      this.pingTimer = setInterval(() => {
        // No pong since the last ping: the connection is gone without a close.
        if (!answered) return socket.terminate();
        answered = false;
        socket.ping();
      }, this.timing.ping);
    });
    socket.on("pong", () => {
      answered = true;
    });
    socket.on("message", (data) => {
      let snapshot: StreamDeckSnapshot | null = null;
      try {
        snapshot = parseStreamDeckSnapshot(JSON.parse(String(data)));
      } catch {
        // Logged below.
      }
      if (!snapshot) {
        this.deps.log("Workstreams sent a snapshot this plugin can't read.");
        return this.set({ status: "outdated" });
      }
      this.tokenRefreshed = false;
      if (this.staleTimer) clearTimeout(this.staleTimer);
      this.staleTimer = null;
      this.set({ status: "ready", snapshot });
    });
    socket.on("unexpected-response", (_request, response) => {
      rejectedWith = response.statusCode ?? 0;
      response.resume();
      // Aborts the handshake, which closes the socket below.
      socket.terminate();
    });
    socket.on("error", (error) => {
      if (rejectedWith === null)
        this.deps.log(`Up Next connection failed: ${error.message}`);
    });
    socket.on("close", () => {
      if (generation !== this.generation) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.socket = null;
      if (rejectedWith !== null && refused(rejectedWith)) {
        if (!found.tokenFromSettings && !this.tokenRefreshed) {
          this.tokenRefreshed = true;
          this.discovery = null;
          return this.retry(generation, 0);
        }
        this.set({ status: "refused" });
        return this.retry(generation, this.timing.setupRetry);
      }
      if (rejectedWith === 404) {
        this.set({ status: "missing" });
        return this.retry(generation, this.timing.setupRetry);
      }
      this.lose();
      const backoff = this.timing.backoff;
      const delay = backoff[Math.min(this.attempts, backoff.length - 1)] ?? 0;
      this.attempts++;
      this.retry(generation, delay);
    });
  }
}

const refused = (status: number) => status === 401 || status === 403;

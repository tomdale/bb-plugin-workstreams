/**
 * Up Next for the Stream Deck plugin in `stream-deck/`: the routes it reads
 * and acts through (see `domain/streamDeck.ts` for the wire format), and the
 * live feed that pushes a new snapshot whenever Up Next changes.
 *
 * The snapshot ranks threads with the sidebar's own rules (`selectUpNext`),
 * from the same inputs the app's shared projection reads, so the keys list
 * what the sidebar lists once Show more is open, less the thread open in BB:
 * a key showing the thread already in front of the user would go nowhere.
 * Each app reports the thread it has open as it navigates and regains focus,
 * and the app that reported last is the one in front of the user. The feed
 * does no work until a Stream Deck connects and stops when the last one
 * leaves.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  STREAM_DECK_CHANNEL,
  STREAM_DECK_PROTOCOL,
  STREAM_DECK_ROUTES,
  type StreamDeckCommand,
  type StreamDeckMark,
  type StreamDeckSnapshot,
  type StreamDeckThread,
} from "../domain/streamDeck.ts";
import type { StoredAnalysis } from "../domain/analysis.ts";
import type { ManualOrder } from "../domain/order.ts";
import type { Prefs } from "../domain/prefs.ts";
import { slotMarkFor } from "../domain/presentation.ts";
import {
  projectWorkstreams,
  type Row,
  type Section,
} from "../domain/project.ts";
import type { Recap } from "../domain/recap.ts";
import { isSnoozed, type ThreadSnooze } from "../domain/snooze.ts";
import { needsAttention, upNextKind, workView } from "../domain/status.ts";
import {
  agedKind,
  isBlockedOnUser,
  selectUpNext,
  UP_NEXT_FRESH_WINDOWS,
} from "../domain/upNext.ts";
import {
  colorForWorkstream,
  workstreamColorHex,
  type TopicColor,
} from "../domain/workstreamColor.ts";
import type { InventoryThread } from "./inventory.ts";

/** Everything a snapshot derives from, read together. */
export type StreamDeckInputs = {
  readonly threads: readonly InventoryThread[];
  readonly sections: readonly Section[];
  readonly analysis: Readonly<Record<string, StoredAnalysis>>;
  readonly recaps: Readonly<Record<string, Recap>>;
  readonly order: ManualOrder;
  readonly snoozes: Readonly<Record<string, ThreadSnooze>>;
  readonly upNext: Prefs["upNext"];
  /** Section id → topic id, as the catalog binds them. */
  readonly groups: Readonly<Record<string, string>>;
  /** Topic id → its workstream color. */
  readonly colors: Readonly<Record<string, TopicColor>>;
  /** The thread open in the BB app the user used last, left out of Up Next. */
  readonly viewing?: string | null;
  readonly now: number;
};

const TITLE_MAX = 120;
const SHOWN_MARKS: ReadonlySet<string> = new Set<StreamDeckMark>([
  "error",
  "needs-you",
  "review",
  "done",
]);

export function streamDeckSnapshot(
  inputs: StreamDeckInputs,
): StreamDeckSnapshot {
  const { threads, sections, analysis, recaps, order, snoozes, now } = inputs;
  const workOf = (thread: InventoryThread) =>
    workView(thread, analysis[thread.id], recaps[thread.id]);
  const snoozedUntil = (thread: InventoryThread) => {
    const snooze = snoozes[thread.id];
    return isSnoozed(snooze, now) ? snooze!.until : undefined;
  };
  const projection = projectWorkstreams(threads, sections, {
    now,
    needsYou: (thread) => needsAttention(thread, workOf(thread)),
    order,
    snoozedUntil,
  });
  const kindOf = (thread: InventoryThread) =>
    upNextKind(thread, workOf(thread));
  const selection = selectUpNext(projection, {
    kindOf,
    now,
    prioritized: new Set(order.prioritized),
    shown: inputs.upNext.shown,
    unreadFirst: inputs.upNext.unreadFirst,
    fill: inputs.upNext.fill,
    freshWithinMs: UP_NEXT_FRESH_WINDOWS[inputs.upNext.freshWindow],
    exclude: (thread) => thread.id === inputs.viewing,
  });
  const names = new Map(sections.map((section) => [section.id, section.name]));
  const toThread = ({
    thread,
    workstreamId,
  }: Row<InventoryThread>): StreamDeckThread => {
    // The server has no live row indicator; BB's thread status still carries
    // a failed turn, and Up Next never lists a thread that is working.
    const mark = slotMarkFor({ ...thread, indicator: "none" }, workOf(thread));
    const name = workstreamId === null ? undefined : names.get(workstreamId);
    return {
      id: thread.id,
      title:
        thread.title.length <= TITLE_MAX
          ? thread.title
          : `${thread.title.slice(0, TITLE_MAX - 1)}…`,
      workstream:
        name === undefined
          ? null
          : {
              name,
              color: workstreamColorHex(
                colorForWorkstream(workstreamId!, {
                  groups: inputs.groups,
                  colors: inputs.colors,
                }),
              ),
            },
      mark:
        mark && SHOWN_MARKS.has(mark.kind)
          ? (mark.kind as StreamDeckMark)
          : null,
      unread: thread.isUnread,
      onYou: isBlockedOnUser(agedKind(thread, kindOf(thread), now)),
    };
  };
  return {
    protocol: STREAM_DECK_PROTOCOL,
    rows: selection.rows.map(toThread),
    more: selection.more.map(toThread),
  };
}

type Socket = { send(data: string): void };

/** How long changes settle before the feed reads Up Next again. */
const SETTLE_MS = 300;
/** The least time between two reads, however busy BB is. */
const MIN_INTERVAL_MS = 1_000;
/** Reads again this often anyway, for changes that only time makes. */
const REFRESH_MS = 60_000;

/**
 * Pushes Up Next to connected Stream Decks: a read after changes settle, sent
 * only when the snapshot differs from the last one sent. Reads never overlap;
 * a change during a read schedules one more.
 */
export class StreamDeckFeed {
  private readonly sockets = new Set<Socket>();
  private last: string | null = null;
  private lastReadAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refresh: ReturnType<typeof setInterval> | null = null;
  private stopWatching: (() => void) | null = null;
  private reading = false;
  private again = false;
  private disposed = false;

  constructor(
    private readonly deps: {
      read: () => Promise<StreamDeckSnapshot>;
      /** Starts listening for BB's own thread changes; returns the stop. */
      watch: (changed: () => void) => (() => void) | null;
      log: (message: string) => void;
      now?: () => number;
    },
  ) {}

  get connected(): number {
    return this.sockets.size;
  }

  add(socket: Socket): void {
    if (this.disposed) return;
    const first = this.sockets.size === 0;
    this.sockets.add(socket);
    if (first) {
      this.stopWatching = this.deps.watch(this.changed);
      this.refresh = setInterval(this.changed, REFRESH_MS);
    }
    if (this.last !== null) socket.send(this.last);
    else this.schedule(0);
  }

  remove(socket: Socket): void {
    if (!this.sockets.delete(socket) || this.sockets.size > 0) return;
    this.stop();
  }

  /** Something Up Next reads from changed. */
  changed = (): void => {
    if (this.sockets.size > 0) this.schedule(SETTLE_MS);
  };

  dispose(): void {
    this.disposed = true;
    this.sockets.clear();
    this.stop();
  }

  private stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    if (this.refresh) clearInterval(this.refresh);
    this.refresh = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.last = null;
  }

  private schedule(delay: number): void {
    if (this.timer) return;
    const now = this.deps.now?.() ?? Date.now();
    const wait = Math.max(delay, this.lastReadAt + MIN_INTERVAL_MS - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.read();
    }, wait);
  }

  private async read(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    this.lastReadAt = this.deps.now?.() ?? Date.now();
    try {
      const json = JSON.stringify(await this.deps.read());
      if (this.sockets.size > 0 && json !== this.last) {
        this.last = json;
        for (const socket of this.sockets) socket.send(json);
      }
    } catch (error) {
      this.deps.log(`Reading Up Next for Stream Deck failed: ${String(error)}`);
    } finally {
      this.reading = false;
      if (this.again && this.sockets.size > 0) {
        this.again = false;
        this.schedule(SETTLE_MS);
      }
    }
  }
}

const openBody = z.object({ threadId: z.string().min(1).max(200) }).strict();

export type StreamDeck = {
  /** Something Up Next reads from changed. */
  changed(): void;
  /** One app has `threadId` open, or no thread; the latest report wins. */
  view(threadId: string | null): void;
};

/**
 * Registers the Stream Deck routes. They take Workstreams' plugin token, so
 * only something that can run `bb plugin token workstreams` reaches them.
 */
export function registerStreamDeck(
  bb: BbPluginApi,
  read: () => Promise<Omit<StreamDeckInputs, "viewing">>,
): StreamDeck {
  let viewing: string | null = null;
  const snapshot = async () =>
    streamDeckSnapshot({ ...(await read()), viewing });
  const feed = new StreamDeckFeed({
    read: snapshot,
    watch: (changed) => {
      try {
        return bb.sdk.subscribe({ event: "thread:changed", callback: changed });
      } catch (error) {
        bb.log.warn(
          `Stream Deck can't follow thread changes: ${String(error)}`,
        );
        return null;
      }
    },
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => feed.dispose());

  bb.http.route(
    "GET",
    STREAM_DECK_ROUTES.upNext,
    async (context) => context.json(await snapshot()),
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    STREAM_DECK_ROUTES.open,
    async (context) => {
      const body = openBody.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!body.success)
        return context.json({ ok: false, error: "Send { threadId }." }, 400);
      const { threadId } = body.data;
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      if (
        !thread ||
        thread.archivedAt !== null ||
        thread.visibility === "hidden"
      )
        return context.json({ ok: false, error: "No such open thread." }, 404);
      const { delivered } = await bb.sdk.threads.open({ threadId, file: null });
      return context.json({ ok: true, delivered });
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    STREAM_DECK_ROUTES.next,
    async (context) => {
      bb.realtime.publish(STREAM_DECK_CHANNEL, {
        command: "next-up-thread",
      } satisfies StreamDeckCommand);
      return context.json({ ok: true });
    },
    { auth: "token" },
  );
  // A BB too old for plugin WebSockets still serves the routes above.
  if (typeof bb.http.experimental_websocket === "function")
    bb.http.experimental_websocket(
      STREAM_DECK_ROUTES.live,
      () => {
        // Each connection gets its own handlers, so this is its socket
        // whatever object the host passes to later callbacks.
        let joined: Socket | null = null;
        const leave = () => {
          if (joined) feed.remove(joined);
          joined = null;
        };
        return {
          onOpen: (socket) => {
            joined = socket;
            feed.add(socket);
          },
          onClose: leave,
          onError: leave,
        };
      },
      { auth: "token" },
    );
  return {
    changed: feed.changed,
    view: (threadId) => {
      if (threadId === viewing) return;
      viewing = threadId;
      feed.changed();
    },
  };
}

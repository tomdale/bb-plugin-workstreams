import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import {
  parseStreamDeckSnapshot,
  STREAM_DECK_CHANNEL,
  STREAM_DECK_ROUTES,
  type StreamDeckSnapshot,
} from "../../src/domain/streamDeck.ts";
import { StreamDeckFeed } from "../../src/server/streamDeck.ts";
import { workstreamColorHex } from "../../src/domain/workstreamColor.ts";
import { workstreamHue } from "../../src/domain/workstreamHue.ts";
import type { PrefsPatch } from "../../src/domain/prefs.ts";

const worlds: Awaited<ReturnType<typeof fakeWorld>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const w of worlds.splice(0)) await w.harness.lifecycle.dispose();
});

async function world(prefs?: PrefsPatch) {
  const w = await fakeWorld(prefs ? { prefs } : {});
  worlds.push(w);
  const opened: unknown[] = [];
  w.harness.inspection.sdk.stub("threads.open", async (args: never) => {
    opened.push(args);
    return { delivered: 1 };
  });
  const watchers = new Set<() => void>();
  w.harness.inspection.sdk.stub(
    "subscribe",
    (args: { callback: () => void }) => {
      watchers.add(args.callback);
      return () => watchers.delete(args.callback);
    },
  );
  const now = Date.now();
  const section = w.addSection("Workstreams: Stream Deck");
  w.addThread("ask", {
    title: "Choosing key layout",
    sectionId: section.id,
    latestAttentionAt: now - 5_000,
    hasPendingInteraction: true,
  } as never);
  w.addThread("failed", { status: "error", latestAttentionAt: now - 1_000 });
  w.addThread("fresh", { latestAttentionAt: now - 2_000 });
  w.addThread("seen", {
    latestAttentionAt: now - 3_000,
    lastReadAt: now,
  });
  w.addThread("running", { status: "active", latestAttentionAt: now });
  w.addThread("child", { parentThreadId: "fresh", latestAttentionAt: now });
  w.addThread("asleep", { latestAttentionAt: now });
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.callRpc("snooze", {
    threadIds: ["asleep"],
    until: now + 60_000,
  });
  return { ...w, section, opened, watchers };
}

const upNext = async (w: Awaited<ReturnType<typeof world>>) => {
  const response = await w.harness.behavior.fetchHttp(
    "GET",
    STREAM_DECK_ROUTES.upNext,
  );
  expect(response.status).toBe(200);
  const snapshot = parseStreamDeckSnapshot(await response.json());
  expect(snapshot).not.toBeNull();
  return snapshot!;
};
const ids = (threads: StreamDeckSnapshot["rows"]) =>
  threads.map((thread) => thread.id);

describe("Stream Deck routes", () => {
  it("lists Up Next as the sidebar ranks it, with each row's mark and workstream", async () => {
    const w = await world();
    const snapshot = await upNext(w);
    // Unread and blocked first, then unread by attention, then the read
    // thread filling the last row. Running, nested, and snoozed threads wait.
    expect(ids(snapshot.rows)).toEqual(["ask", "failed", "fresh", "seen"]);
    expect(snapshot.more).toEqual([]);
    expect(snapshot.rows[0]).toEqual({
      id: "ask",
      title: "Choosing key layout",
      workstream: {
        name: "Workstreams: Stream Deck",
        color: workstreamColorHex({
          hue: workstreamHue(w.section.id),
          level: 0,
        }),
      },
      mark: "needs-you",
      unread: true,
      onYou: true,
    });
    expect(snapshot.rows[1]).toMatchObject({
      mark: "error",
      unread: true,
      onYou: false,
      workstream: null,
    });
    expect(snapshot.rows[3]).toMatchObject({ mark: null, unread: false });
  });

  it("keeps to Threads shown, with the trimmed unread threads in more", async () => {
    const w = await world({ upNext: { shown: 2 } });
    const snapshot = await upNext(w);
    expect(ids(snapshot.rows)).toEqual(["ask", "failed"]);
    expect(ids(snapshot.more)).toEqual(["fresh"]);
  });

  it("opens a thread in the connected apps, and refuses anything else", async () => {
    const w = await world();
    const post = (body: unknown) =>
      w.harness.behavior.fetchHttp("POST", STREAM_DECK_ROUTES.open, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const response = await post({ threadId: "ask" });
    expect(await response.json()).toEqual({ ok: true, delivered: 1 });
    expect(w.opened).toEqual([{ threadId: "ask", file: null }]);

    w.addThread("archived", { archivedAt: Date.now() });
    expect((await post({ threadId: "archived" })).status).toBe(404);
    expect((await post({ threadId: "gone" })).status).toBe(404);
    expect((await post({ thread: "ask" })).status).toBe(400);
    expect(w.opened).toHaveLength(1);
  });

  it("relays the Next key to the apps, which know what each has open", async () => {
    const w = await world();
    const before = w.harness.inspection.realtimeSignals.length;
    const response = await w.harness.behavior.fetchHttp(
      "POST",
      STREAM_DECK_ROUTES.next,
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(w.harness.inspection.realtimeSignals.slice(before)).toEqual([
      expect.objectContaining({
        channel: STREAM_DECK_CHANNEL,
        payload: { command: "next-up-thread" },
      }),
    ]);
  });

  it("sends a connected Stream Deck Up Next, then each change, and stops when it leaves", async () => {
    const w = await world();
    const socket = await w.harness.behavior.experimental_openWebSocket(
      STREAM_DECK_ROUTES.live,
    );
    const received = () =>
      socket.sent.map((data) => parseStreamDeckSnapshot(JSON.parse(`${data}`)));
    await vi.waitFor(() => expect(received()).toHaveLength(1));
    expect(ids(received()[0]!.rows)).toEqual([
      "ask",
      "failed",
      "fresh",
      "seen",
    ]);
    expect(w.watchers.size).toBe(1);

    await w.harness.behavior.callRpc("snooze", {
      threadIds: ["failed"],
      until: Date.now() + 60_000,
    });
    await vi.waitFor(() => expect(received()).toHaveLength(2), {
      timeout: 3_000,
    });
    expect(ids(received()[1]!.rows)).toEqual(["ask", "fresh", "seen"]);

    await socket.close();
    expect(w.watchers.size).toBe(0);
  });
});

describe("StreamDeckFeed", () => {
  const snapshot = (rows: string[]): StreamDeckSnapshot => ({
    protocol: 1,
    rows: rows.map((id) => ({
      id,
      title: id,
      workstream: null,
      mark: null,
      unread: true,
      onYou: false,
    })),
    more: [],
  });

  it("reads once changes settle, at most once a second, and sends only what changed", async () => {
    vi.useFakeTimers();
    let rows = ["a"];
    const read = vi.fn(async () => snapshot(rows));
    const feed = new StreamDeckFeed({
      read,
      watch: () => null,
      log: () => {},
    });
    const sent: string[] = [];
    feed.add({ send: (data) => sent.push(data) });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);

    // Nothing new to send.
    feed.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);

    // A burst of changes is one read.
    rows = ["b"];
    for (let i = 0; i < 5; i++) feed.changed();
    await vi.advanceTimersByTimeAsync(299);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(sent.map((data) => JSON.parse(data).rows[0].id)).toEqual(["a", "b"]);

    // A later Stream Deck gets the last snapshot without another read.
    const late: string[] = [];
    feed.add({ send: (data) => late.push(data) });
    expect(late).toEqual([sent[1]]);
    expect(read).toHaveBeenCalledTimes(3);
    feed.dispose();
  });

  it("stops reading when the last Stream Deck leaves, and keeps the last snapshot on a failed read", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => snapshot(["a"]));
    const log = vi.fn();
    const stop = vi.fn();
    const feed = new StreamDeckFeed({ read, watch: () => stop, log });
    const socket = { send: vi.fn() };
    feed.add(socket);
    await vi.advanceTimersByTimeAsync(0);
    read.mockRejectedValueOnce(new Error("BB is restarting"));
    feed.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("BB is restarting"),
    );
    expect(socket.send).toHaveBeenCalledTimes(1);

    feed.remove(socket);
    expect(stop).toHaveBeenCalledTimes(1);
    feed.changed();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

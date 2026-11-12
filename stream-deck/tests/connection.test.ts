import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { StreamDeckSnapshot } from "../../src/domain/streamDeck.ts";
import { UpNextConnection, type UpNextState } from "../src/connection.ts";
import type { Discovery } from "../src/discovery.ts";

const ROUTES = "/api/v1/plugins/workstreams/http/stream-deck";

const snapshot = (id: string): StreamDeckSnapshot => ({
  protocol: 1,
  rows: [
    {
      id,
      title: `Thread ${id}`,
      workstream: null,
      mark: null,
      unread: true,
      onYou: false,
    },
  ],
  more: [],
});

/** A stand-in for BB serving Workstreams' Stream Deck routes. */
async function fakeBb(token = "good") {
  const posts: { path: string; body: unknown; token: unknown }[] = [];
  const sockets = new Set<WebSocket>();
  const state = { token, liveStatus: 0, current: snapshot("a") };
  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    posts.push({
      path: request.url ?? "",
      body: body ? JSON.parse(body) : null,
      token: request.headers["x-bb-plugin-token"],
    });
    const allowed = request.headers["x-bb-plugin-token"] === state.token;
    response
      .writeHead(allowed ? 200 : 401)
      .end(JSON.stringify({ ok: allowed }));
  });
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const status =
      state.liveStatus ||
      (request.url !== `${ROUTES}/live`
        ? 404
        : request.headers["x-bb-plugin-token"] !== state.token
          ? 401
          : 0);
    if (status) {
      socket.end(`HTTP/1.1 ${status} No\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.send(JSON.stringify(state.current));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    posts,
    sockets,
    state,
    push(next: StreamDeckSnapshot) {
      state.current = next;
      for (const ws of sockets) ws.send(JSON.stringify(next));
    },
    dropAll() {
      for (const ws of sockets) ws.terminate();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of sockets) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function connect(
  bb: Awaited<ReturnType<typeof fakeBb>>,
  tokens: string[] = ["good"],
  fromSettings = false,
  watch = true,
) {
  const discover = vi.fn(async (): Promise<Discovery> => ({
    serverUrl: bb.url,
    token: tokens.length > 1 ? tokens.shift()! : tokens[0]!,
    tokenFromSettings: fromSettings,
    app: "/Applications/bb.app",
  }));
  const bringForward = vi.fn();
  const connection = new UpNextConnection({
    discover,
    bringForward,
    log: () => {},
    timing: { backoff: [20], setupRetry: 50, stale: 150, ping: 60_000 },
  });
  const states: UpNextState[] = [];
  const unsubscribe = watch
    ? connection.subscribe((state) => states.push(state))
    : () => {};
  cleanups.push(unsubscribe);
  const rows = () => {
    const state = connection.current;
    return state.status === "ready"
      ? state.snapshot.rows.map((row) => row.id)
      : state.status;
  };
  return { connection, discover, bringForward, states, rows, unsubscribe };
}

it("shows each snapshot BB sends", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  const deck = connect(bb);
  expect(deck.states[0]).toEqual({ status: "connecting" });
  await vi.waitFor(() => expect(deck.rows()).toEqual(["a"]));
  bb.push(snapshot("b"));
  await vi.waitFor(() => expect(deck.rows()).toEqual(["b"]));
});

it("keeps the last snapshot through a short drop, then says BB is gone", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  const deck = connect(bb);
  await vi.waitFor(() => expect(deck.rows()).toEqual(["a"]));
  bb.push(snapshot("b"));
  await vi.waitFor(() => expect(deck.rows()).toEqual(["b"]));
  bb.dropAll();
  // Reconnects within the grace period and gets the current snapshot.
  await vi.waitFor(() => expect(bb.sockets.size).toBe(1));
  expect(deck.states.map((state) => state.status)).not.toContain("offline");

  bb.state.liveStatus = 503;
  bb.dropAll();
  await vi.waitFor(() => expect(deck.rows()).toBe("offline"));
  bb.state.liveStatus = 0;
  await vi.waitFor(() => expect(deck.rows()).toEqual(["b"]));
});

it("asks the bb CLI for the token again once when BB refuses it", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  const deck = connect(bb, ["rotated", "good"]);
  await vi.waitFor(() => expect(deck.rows()).toEqual(["a"]));
  expect(deck.discover).toHaveBeenCalledTimes(2);

  const fixed = await fakeBb("other");
  cleanups.push(fixed.close);
  const stuck = connect(fixed, ["mine"], true);
  await vi.waitFor(() => expect(stuck.rows()).toBe("refused"));
  expect(stuck.discover).toHaveBeenCalledTimes(1);
});

it("says Workstreams is missing when BB has no Stream Deck routes", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  bb.state.liveStatus = 404;
  const deck = connect(bb);
  await vi.waitFor(() => expect(deck.rows()).toBe("missing"));
});

it("sends presses with the token and brings BB forward when they land", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  const deck = connect(bb, ["stale", "good"], false, false);
  expect(await deck.connection.open("thr_1")).toBe(true);
  expect(await deck.connection.next()).toBe(true);
  expect(bb.posts).toEqual([
    { path: `${ROUTES}/open`, body: { threadId: "thr_1" }, token: "stale" },
    { path: `${ROUTES}/open`, body: { threadId: "thr_1" }, token: "good" },
    { path: `${ROUTES}/next`, body: {}, token: "good" },
  ]);
  expect(deck.bringForward).toHaveBeenCalledTimes(2);
  expect(deck.bringForward).toHaveBeenCalledWith("/Applications/bb.app");

  bb.state.token = "rotated-away";
  expect(await deck.connection.next()).toBe(false);
  expect(deck.bringForward).toHaveBeenCalledTimes(2);
});

it("disconnects when nothing shows Up Next", async () => {
  const bb = await fakeBb();
  cleanups.push(bb.close);
  const deck = connect(bb);
  await vi.waitFor(() => expect(bb.sockets.size).toBe(1));
  deck.unsubscribe();
  await vi.waitFor(() => expect(bb.sockets.size).toBe(0));
  expect(deck.connection.current).toEqual({ status: "connecting" });
});

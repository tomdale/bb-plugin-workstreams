import { afterEach, expect, it } from "vitest";
import { createTestPluginHost } from "./test-host.ts";
import { openDatabase } from "../../src/server/db.ts";
import { TraceStore } from "../../src/server/trace.ts";
import { linkSuggestionTraces } from "../../src/server/suggestionTrace.ts";
import type { NewTrace } from "../../src/domain/trace.ts";

let host: Awaited<ReturnType<typeof createTestPluginHost>> | null = null;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
  host = null;
});

const NOW = Date.now();
const TOPIC = "7a64f959-822c-4cb1-b4fd-918afd0531ba";
const OTHER_TOPIC = "8a6b5f0e-bba6-4729-8d51-4ccc29c21c50";
const THREAD = "thr_3kkc24izzr";

const trace = (overrides: Partial<NewTrace> = {}): NewTrace => ({
  at: NOW - 60_000,
  kind: "tidy",
  status: "ok",
  label: "12 threads, 4 topics",
  model: "test/model",
  durationMs: 1_000,
  replayOf: null,
  provider: "test",
  thinking: "off",
  system: "",
  prompt: "tidy the tree",
  input: null,
  response: "{}",
  reasoning: null,
  stopReason: "stop",
  parsed: {},
  outcome: null,
  usage: null,
  error: null,
  summary: null,
  ...overrides,
});

/** A world holding one suggestion row per `pending`, as an older version stored it. */
function world(
  rows: { id: string; kind: "split" | "edit"; at: number; body: object }[],
) {
  host = createTestPluginHost({ pluginId: "suggestion-trace" });
  const db = openDatabase(host.bb);
  const traces = new TraceStore(db);
  const insert = db.prepare(
    `INSERT INTO ws_suggestion(id, pass_id, kind, body, reason, summary, key, status, at)
     VALUES (?, 'pass', ?, ?, '', '', ?, 'pending', ?)`,
  );
  for (const row of rows)
    insert.run(row.id, row.kind, JSON.stringify(row.body), row.id, row.at);
  const linked = (id: string) =>
    (
      db.prepare("SELECT trace_id FROM ws_suggestion WHERE id = ?").get(id) as {
        trace_id: string | null;
      }
    ).trace_id;
  return { db, traces, linked };
}

it("gives a split the call that named its topic", () => {
  const { db, traces, linked } = world([
    {
      id: "s1",
      kind: "split",
      at: NOW - 1_000,
      body: { topicId: TOPIC, subgroups: [] },
    },
  ]);
  const mine = traces.add(
    trace({ kind: "split", at: NOW - 3_000, input: { topicId: TOPIC } }),
  );
  traces.add(
    trace({ kind: "split", at: NOW - 2_000, input: { topicId: OTHER_TOPIC } }),
  );
  expect(linkSuggestionTraces(db, traces)).toBe(1);
  expect(linked("s1")).toBe(mine);
});

it("gives a tidy edit the newest pass before it that names what it changes", () => {
  const { db, traces, linked } = world([
    {
      id: "e1",
      kind: "edit",
      at: NOW - 1_000,
      body: { op: "move", thread: THREAD, topic: OTHER_TOPIC },
    },
  ]);
  traces.add(
    trace({ at: NOW - 3_000, response: `{"edits":[{"thread":"thr_other"}]}` }),
  );
  const mine = traces.add(
    trace({ at: NOW - 2_000, response: `{"edits":[{"thread":"${THREAD}"}]}` }),
  );
  linkSuggestionTraces(db, traces);
  expect(linked("e1")).toBe(mine);
});

it("leaves a suggestion alone when no call still explains it", () => {
  const { db, traces, linked } = world([
    {
      id: "e1",
      kind: "edit",
      at: NOW - 1_000,
      body: { op: "rename", topic: TOPIC },
    },
    // Only a call about a different topic is stored, and it is hours old.
    { id: "s1", kind: "split", at: NOW - 2_000, body: { topicId: TOPIC } },
  ]);
  traces.add(
    // An answer that names neither the topic the rename is about nor anything
    // else, so it cannot be the pass that wrote the row.
    trace({ at: NOW - 2_000, response: '{"edits":[]}' }),
  );
  traces.add(
    trace({
      kind: "split",
      at: NOW - 600_000,
      input: { topicId: OTHER_TOPIC },
    }),
  );
  expect(linkSuggestionTraces(db, traces)).toBe(0);
  expect(linked("e1")).toBeNull();
  expect(linked("s1")).toBeNull();
});

it("runs once, so a later suggestion is never matched to an older call", () => {
  const { db, traces, linked } = world([
    {
      id: "e1",
      kind: "edit",
      at: NOW - 1_000,
      body: { op: "rename", topic: TOPIC },
    },
  ]);
  linkSuggestionTraces(db, traces);
  const added = traces.add(
    trace({ at: NOW - 2_000, response: `{"topic":"${TOPIC}"}` }),
  );
  expect(linkSuggestionTraces(db, traces)).toBe(0);
  expect(linked("e1")).toBeNull();
  expect(added).toBeTruthy();
});

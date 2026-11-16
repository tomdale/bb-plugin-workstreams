import { createTestPluginHost } from "./test-host.ts";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import { TraceStore } from "../../src/server/trace.ts";
import type { NewTrace } from "../../src/domain/trace.ts";

it("removes source-linked trace prompts and recursive replays without deleting unrelated traces", async () => {
  const host = createTestPluginHost({ pluginId: "trace-removal" });
  try {
    const db = openDatabase(host.bb);
    const traces = new TraceStore(db);
    const base: NewTrace = {
      at: Date.now(),
      kind: "turn-end",
      status: "ok",
      label: "source",
      model: "test",
      durationMs: 1,
      replayOf: null,
      provider: "test",
      thinking: "off",
      system: "",
      prompt: "private source",
      input: {},
      response: "{}",
      reasoning: null,
      stopReason: null,
      parsed: {},
      outcome: null,
      usage: null,
      error: null,
      summary: null,
    };
    const original = traces.add(base, [{ kind: "thread", ref: "deleted" }]);
    const replay = traces.add({ ...base, replayOf: original });
    const nested = traces.add({ ...base, replayOf: replay });
    const unrelated = traces.add({ ...base, prompt: "unrelated" }, [
      { kind: "thread", ref: "survivor" },
    ]);
    expect(traces.remove([], [{ kind: "thread", ref: "deleted" }])).toBe(3);
    expect(traces.get(original)).toBeNull();
    expect(traces.get(replay)).toBeNull();
    expect(traces.get(nested)).toBeNull();
    expect(traces.get(unrelated)?.prompt).toBe("unrelated");
    expect(
      db.prepare("SELECT * FROM ws_trace_link WHERE ref='deleted'").all(),
    ).toHaveLength(0);
    expect(traces.remove([original])).toBe(0);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("drops stored calls of a kind no current call records", async () => {
  const host = createTestPluginHost({ pluginId: "trace-retired-kind" });
  try {
    const db = openDatabase(host.bb);
    const traces = new TraceStore(db);
    const kept = traces.add({
      at: Date.now(),
      kind: "start",
      status: "ok",
      label: "kept",
      model: "test",
      durationMs: 1,
      replayOf: null,
      provider: "test",
      thinking: "off",
      system: "",
      prompt: "",
      input: {},
      response: "{}",
      reasoning: null,
      stopReason: null,
      parsed: {},
      outcome: null,
      usage: null,
      error: null,
      summary: null,
    });
    db.prepare(
      "INSERT INTO ws_trace (id, at, kind, status, label, model, duration_ms, replay_of, data) VALUES ('old', ?, 'retired-kind', 'ok', 'old', 'test', 1, NULL, '{}')",
    ).run(Date.now());
    traces.prune({ force: true });
    expect(traces.get("old")).toBeNull();
    expect(traces.get(kept)).not.toBeNull();
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

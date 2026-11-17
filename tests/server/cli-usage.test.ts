import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { PrefsPatch } from "../../src/domain/prefs.ts";
import {
  usageReportSchema,
  type NewUsageEntry,
} from "../../src/domain/usage.ts";
import { UsageLedger } from "../../src/server/usage.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

/** Every limit off, so a test sets only the ones it is about. */
const NO_LIMITS = {
  hourSpendWarn: null,
  hourSpendCap: null,
  daySpendWarn: null,
  daySpendCap: null,
  monthSpendWarn: null,
  monthSpendCap: null,
  hourCallsWarn: null,
  hourCallsCap: null,
};

async function setup(usage: NonNullable<PrefsPatch["usage"]> = {}) {
  world = await fakeWorld({ prefs: { usage: { ...NO_LIMITS, ...usage } } });
  const w = world;
  const db = openDatabase(w.bb);
  const ledger = new UsageLedger(db);
  const record = (entry: Partial<NewUsageEntry> = {}) =>
    ledger.record({
      at: Date.now() - 60_000,
      source: "turn-end",
      path: "gateway",
      model: "test-model",
      threadId: null,
      traceId: null,
      status: "ok",
      calls: 1,
      inputTokens: 2_000,
      outputTokens: 300,
      cost: 0.25,
      promptHash: null,
      promptChars: null,
      durationMs: 1_000,
      replay: false,
      ...entry,
    });
  const run = (...args: string[]) =>
    w.harness.behavior.runCli(["usage", ...args]);
  return { w, db, record, run };
}

describe("bb workstreams usage", () => {
  it("prints an empty ledger without limits", async () => {
    const { run } = await setup();
    const result = await run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Model calls are running.",
        "",
        "No limits are set.",
        "",
        "Last 24 hours",
        "  No requests.",
        "",
        "No flags.",
      ].join("\n"),
    );
  });

  it("prints the limits, the range's totals, the flags, and who spent", async () => {
    const { w, db, record, run } = await setup({
      hourSpendWarn: 3,
      hourSpendCap: 20,
      hourCallsCap: 500,
    });
    const store = new WorkstreamStore(db);
    const group = store.create("bb", "", null, []);
    const plugin = store.create("Plugin", "", group.id, []);
    w.addThread("thr_busy");
    store.assign("thr_busy", plugin.id, {
      provenance: "manual",
      evidence: "ev_1",
    });
    for (let i = 0; i < 40; i++) record({ threadId: "thr_busy", cost: 0.1 });
    record({ source: "tidy", model: "other-model", cost: 0.5 });
    record({ source: "start", path: "worker", cost: null, inputTokens: null });
    record({ status: "failed", cost: null });

    const { exitCode, stdout } = await run();
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");

    expect(lines[0]).toBe("Model calls are running.");
    expect(lines).toContain("Limits");
    expect(lines).toContain(
      "  The last hour's spend: $4.50 (warning at $3.00, pause at $20.00), warning reached",
    );
    expect(lines).toContain(
      "  Requests in the last hour: 43 (pause at 500), under its thresholds",
    );
    // A limit with no threshold is left out.
    expect(stdout).not.toContain("Today's spend");

    expect(lines).toContain("Last 24 hours");
    expect(lines).toContain("  Reported cost: $4.50");
    expect(lines).toContain("  Requests: 43 (1 did not succeed)");
    expect(lines).toContain("  Tokens: 84.0k in / 12.9k out");
    expect(lines).toContain("  Requests with no cost reported: 2");

    expect(lines).toContain(
      "  [warning] One thread made 40 requests in an hour",
    );
    expect(
      lines.some((line) => /^ {6}Thread thr_busy, 40 requests/.test(line)),
    ).toBe(true);

    expect(lines.slice(lines.indexOf("Top sources") + 1)).toEqual([
      "  Turn end: $4.00, 41 requests, 1 with no cost reported",
      "  Suggested changes: $0.50, 1 request",
      // Never $0.00: nothing here reported a cost.
      "  New thread: no cost reported, 1 request",
      "",
      "Top models",
      "  test-model: $4.00, 42 requests, 2 with no cost reported",
      "  other-model: $0.50, 1 request",
      "",
      "Top workstreams",
      "  bb › Plugin: $4.00, 40 requests",
      "  No workstream: $0.50, 3 requests, 2 with no cost reported",
    ]);

    // The sections come in reading order.
    const order = [
      "Model calls are running.",
      "Limits",
      "Last 24 hours",
      "Flags",
      "Top sources",
    ].map((line) => lines.indexOf(line));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  it("totals the range it is given", async () => {
    const { record, run } = await setup();
    record({ at: Date.now() - 3 * 3_600_000, cost: 1 });
    record({ cost: 0.25 });

    const hour = await run("--range", "1h");
    expect(hour.stdout).toContain("Last hour\n  Reported cost: $0.25");
    const week = await run("--range", "7d");
    expect(week.stdout).toContain("Last 7 days\n  Reported cost: $1.25");

    const unknown = await run("--range", "2h");
    expect(unknown.exitCode).not.toBe(0);
  });

  it("prints the report as JSON", async () => {
    const { record, run } = await setup({ hourSpendCap: 10 });
    record();
    const { exitCode, stdout } = await run("--json", "--range", "30d");
    expect(exitCode).toBe(0);
    const report = usageReportSchema.parse(JSON.parse(stdout));
    expect(report.range).toBe("30d");
    expect(report.totals).toMatchObject({ cost: 0.25, calls: 1 });
    expect(report.windows.hour).toEqual({ cost: 0.25, calls: 1, unmetered: 0 });
    expect(report.state.limits.map((limit) => limit.key)).toEqual([
      "hourSpend",
    ]);
  });

  it("says calls are paused at a cap, and resume lets them through", async () => {
    const { record, run } = await setup({ hourCallsCap: 3 });
    for (let i = 0; i < 3; i++) record();

    const paused = await run();
    expect(paused.exitCode).toBe(0);
    const [first] = paused.stdout.split("\n");
    expect(first).toContain(
      "Workstreams is paused: requests in the last hour reached the limit of 3.",
    );
    expect(first).toContain("`bb workstreams usage resume`");
    expect(paused.stdout.split("\n")).toContain(
      "  Requests in the last hour: 3 (pause at 3), limit reached, paused",
    );

    const resumed = await run("resume");
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout.split("\n")[0]).toBe("Model calls are running.");
    expect(resumed.stdout).toMatch(
      /Requests in the last hour: 3 \(pause at 3\), limit reached, resumed until \d{4}-\d\d-\d\d \d\d:\d\d/,
    );
    expect((await run()).stdout.split("\n")[0]).toBe(
      "Model calls are running.",
    );
  });

  it("prints the new state as JSON after a resume", async () => {
    const { record, run } = await setup({ hourCallsCap: 1 });
    record();
    const { exitCode, stdout } = await run("resume", "--json");
    expect(exitCode).toBe(0);
    const { state } = JSON.parse(stdout) as {
      state: { level: string; limits: { resumedUntil: number | null }[] };
    };
    expect(state.level).toBe("warning");
    expect(state.limits[0]?.resumedUntil).toBeGreaterThan(Date.now());
  });

  it("prints the message when usage cannot be read", async () => {
    const { db, run } = await setup({ hourCallsCap: 1 });
    db.exec("DROP TABLE ws_usage");

    const shown = await run();
    expect(shown.exitCode).toBe(1);
    expect(shown.stderr).toContain("ws_usage");
    expect(shown.stdout).toBe("");

    const resumed = await run("resume");
    expect(resumed.exitCode).toBe(1);
    expect(resumed.stderr).toContain("ws_usage");
  });
});

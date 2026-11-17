/*
 * Organizing suggestions while a spend cap pauses Workstreams, in the whole
 * plugin: a refused pass puts back what it took beforehand (the waiting edits
 * it replaced, the last pass's record, the division request), counts as no
 * failure, and is due again when the pause lifts. Accepting a suggestion is
 * refused only when it needs a model call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import type { SuggestionsStateWire } from "../../src/server/contract.ts";
import { getMeta, openDatabase } from "../../src/server/db.ts";
import { UsageLedger } from "../../src/server/usage.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { createTestPluginHost } from "./test-host.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
  world = null;
});

const SPLIT = "Consider whether this top-level workstream";
/** How the call that moves a waiting split's newcomers opens. */
const REPAIR = "holds threads of its own beside its workstreams";
const TIDY = "You maintain the workstreams and groups";
const PAUSED = /^Workstreams is paused: requests in the last hour reached/;
/** No thresholds, so only `pause` pauses. */
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

type Decided = {
  applied: string[];
  failed: { id: string; reason: string }[];
};

/** A world whose model answers split and tidy prompts with these. */
async function setup(
  answers: {
    split?: (prompt: string) => object;
    tidy?: (prompt: string) => object;
  } = {},
) {
  world = await fakeWorld({
    prefs: { usage: NO_LIMITS },
    complete: ({ prompt }) =>
      JSON.stringify(
        prompt.includes(SPLIT) || prompt.includes(REPAIR)
          ? (answers.split?.(prompt) ?? {
              reason: "",
              workstreams: [],
              threads: [],
            })
          : prompt.includes(TIDY)
            ? (answers.tidy?.(prompt) ?? { edits: [] })
            : { recap: "r", state: "needs-input" },
      ),
  });
  const w = world;
  const db = openDatabase(w.bb);
  const workstreamStore = new WorkstreamStore(db);
  const rpc = <T = unknown>(method: string, input: unknown = null) =>
    w.harness.behavior.callRpc(method, input) as Promise<T>;
  const state = async () =>
    (await rpc<{ state: SuggestionsStateWire }>("suggestions")).state;
  const run = async () =>
    (await rpc<{ state: SuggestionsStateWire }>("suggestionsRun")).state;
  const accept = (id: string) =>
    rpc<Decided>("suggestionsDecide", { ids: [id], decision: "accept" });
  /**
   * Reaches the requests cap: the rolling hour has no calendar boundary, so
   * the pause lasts however far a test moves its timers.
   */
  const pause = async () => {
    new UsageLedger(db).record({
      at: Date.now(),
      source: "turn-end",
      path: "worker",
      model: "test",
      threadId: null,
      traceId: null,
      status: "ok",
      calls: 1_000,
      inputTokens: null,
      outputTokens: null,
      cost: null,
      promptHash: null,
      promptChars: null,
      durationMs: 1,
      replay: false,
    });
    await rpc("setPrefs", { patch: { usage: { hourCallsCap: 500 } } });
    expect((await rpc<{ level: string }>("usageStatus")).level).toBe("capped");
  };
  const resume = () => rpc("usageResume");
  /** What the last tidy pass recorded. */
  const memo = () =>
    JSON.parse(getMeta(db, "suggestions_tidy")!) as {
      at: number;
      fingerprint: string;
    };
  /** The prompts asked so far that open with `marker`. */
  const asked = (marker: string) =>
    w.completions.filter((c) => c.prompt.includes(marker));
  /** Lets an organizer pass check suggestions, then waits out the debounce. */
  const check = async () => {
    await rpc("organizeStatus", { action: "rebuild" });
    await vi.advanceTimersByTimeAsync(2_500);
  };
  return {
    w,
    workstreamStore,
    rpc,
    state,
    run,
    accept,
    pause,
    resume,
    memo,
    asked,
    check,
  };
}

const tidyEdit = (fields: Record<string, unknown>) => ({
  op: "rename",
  reason: "Because",
  from: null,
  into: null,
  workstream: null,
  parent: null,
  name: null,
  description: null,
  children: null,
  thread: null,
  ...fields,
});
/** A tidy answer that renames Alpha, read from the prompt's own ids. */
const renameAlpha = (prompt: string) => ({
  edits: [
    tidyEdit({
      workstream: prompt.match(/\[([a-z0-9-]+)\] Alpha /)?.[1] ?? null,
      name: "Alpha Two",
    }),
  ],
});
/** A split of Automations: r1–r3 to Planning, r4–r6 to Triggers. */
const planningAndTriggers = {
  reason: "Planning apart from triggers",
  workstreams: [
    { name: "Planning", description: "Design" },
    { name: "Triggers", description: "Events" },
  ],
  threads: [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `r${n}`,
    workstream: n <= 3 ? "Planning" : "Triggers",
  })),
};

describe("Suggest changes during a pause", () => {
  it("leaves the waiting edits it would have replaced waiting, and the last pass's record as it was", async () => {
    const s = await setup({ tidy: renameAlpha });
    const alpha = s.workstreamStore.create("Alpha", "");
    await s.rpc("refresh");
    const [edit] = (await s.run()).suggestions;
    expect(edit).toMatchObject({
      summary: "Rename Alpha to Alpha Two",
      status: "pending",
    });
    const before = s.memo();
    await s.pause();
    // Later than the last pass, so a rewritten record would differ.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 });

    await expect(s.run()).rejects.toThrow(PAUSED);
    const paused = await s.state();
    expect(paused.suggestions).toEqual([edit]);
    expect(paused).toMatchObject({
      running: false,
      error: null,
      lastRunAt: before.at,
    });
    expect(s.memo()).toEqual(before);
    expect(s.asked(TIDY)).toHaveLength(1);

    // It is a waiting suggestion in every way: accepting it applies it.
    expect((await s.accept(edit!.id)).applied).toEqual([edit!.id]);
    expect(s.workstreamStore.getById(alpha.id)?.name).toBe("Alpha Two");
  });

  it("replaces the waiting edits as usual once the pause is resumed", async () => {
    let name = "Alpha Two";
    const s = await setup({
      tidy: (prompt) => ({
        edits: [{ ...renameAlpha(prompt).edits[0]!, name }],
      }),
    });
    s.workstreamStore.create("Alpha", "");
    await s.rpc("refresh");
    const [first] = (await s.run()).suggestions;
    await s.pause();
    await expect(s.run()).rejects.toThrow(PAUSED);

    name = "Alpha Three";
    await s.resume();
    const after = await s.run();
    expect(s.asked(TIDY)).toHaveLength(2);
    expect(after.suggestions.map((x) => [x.summary, x.status])).toEqual([
      ["Rename Alpha to Alpha Three", "pending"],
      ["Rename Alpha to Alpha Two", "stale"],
    ]);
    expect(after.suggestions[1]).toMatchObject({
      id: first!.id,
      problem: "A newer pass replaced it.",
    });
  });

  it("keeps showing the failure the last pass left, not the pause", async () => {
    let offline = true;
    const s = await setup({
      tidy: () => {
        if (offline) throw new Error("model offline");
        return { edits: [] };
      },
    });
    s.workstreamStore.create("Alpha", "");
    await s.rpc("refresh");
    await expect(s.run()).rejects.toThrow("model offline");
    const failed = (await s.state()).error;
    expect(failed).toContain("model offline");

    await s.pause();
    await expect(s.run()).rejects.toThrow(PAUSED);
    expect((await s.state()).error).toBe(failed);

    // A pass that is asked and answers clears it.
    offline = false;
    await s.resume();
    expect((await s.run()).error).toBeNull();
  });
});

describe("an automatic pass during a pause", () => {
  it("asks nothing and records no failure, and runs by itself when the pause lifts", async () => {
    const s = await setup();
    s.workstreamStore.create("Alpha", "");
    await s.rpc("refresh");
    await s.run();
    const before = s.memo();
    expect(s.asked(TIDY)).toHaveLength(1);

    await s.pause();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date"],
      now: Date.now() + 60_000,
    });
    // The workstreams changed, so a pass is due.
    s.workstreamStore.create("Beta", "");
    await s.check();
    expect(s.asked(TIDY)).toHaveLength(1);
    expect(s.memo()).toEqual(before);
    expect(await s.state()).toMatchObject({
      error: null,
      lastRunAt: before.at,
    });
    // A failed pass is not asked again for the same workstreams; a refused
    // one is, on every look.
    await s.check();
    expect(s.asked(TIDY)).toHaveLength(1);

    await s.resume();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(s.asked(TIDY)).toHaveLength(2);
    expect(s.memo().fingerprint).not.toBe(before.fingerprint);
    expect((await s.state()).error).toBeNull();
  });
});

describe("a division request during a pause", () => {
  const SCOPE = { name: "Billing", description: "Billing capability" };

  /** Product holds three threads, and a proposal asked to divide it. */
  async function divided() {
    const s = await setup({
      split: () => ({
        reason: "Billing is its own area",
        workstreams: [
          { name: "Billing", description: "Billing capability" },
          { name: "Catalog", description: "The rest" },
        ],
        threads: [1, 2, 3].map((n) => ({
          id: `r${n}`,
          workstream: n === 1 ? "Billing" : "Catalog",
        })),
      }),
    });
    const product = s.workstreamStore.create("Product", "The product");
    for (let i = 1; i <= 3; i++) {
      s.w.addThread(`t${i}`, { title: `Task ${i}` });
      s.workstreamStore.assign(`t${i}`, product.id);
    }
    await s.rpc("refresh");
    // Adding the first child to a workstream with threads asks for a split.
    s.workstreamStore.rememberProposal({ ...SCOPE, parentId: product.id });
    expect(s.workstreamStore.divisionRequests()).toEqual({
      [product.id]: SCOPE,
    });
    return { ...s, product };
  }

  it("is put back when Suggest changes is refused its split", async () => {
    const s = await divided();
    await s.pause();
    await expect(s.run()).rejects.toThrow(PAUSED);
    expect(s.workstreamStore.divisionRequests()).toEqual({
      [s.product.id]: SCOPE,
    });
    expect(s.asked(SPLIT)).toHaveLength(0);
    expect((await s.state()).suggestions).toEqual([]);
  });

  it("is put back when an automatic pass is refused, and the split is asked with it when the pause lifts", async () => {
    const s = await divided();
    await s.pause();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await s.check();
    expect(s.asked(SPLIT)).toHaveLength(0);
    expect(s.workstreamStore.divisionRequests()).toEqual({
      [s.product.id]: SCOPE,
    });

    // An automatic pass asks for a split only where a request waits.
    await s.resume();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(s.asked(SPLIT)).toHaveLength(1);
    expect(s.asked(SPLIT)[0]!.prompt).toContain("Billing — Billing capability");
    expect(s.workstreamStore.divisionRequests()).toEqual({});
    expect((await s.state()).suggestions).toMatchObject([
      { kind: "split", status: "pending" },
    ]);
  });
});

describe("restoring a division request", () => {
  it("puts back a taken request, and leaves one made meanwhile standing", async () => {
    const host = createTestPluginHost({ pluginId: "division-request-restore" });
    try {
      const store = new WorkstreamStore(openDatabase(host.bb));
      const product = store.create("Product", "");
      store.assign("t1", product.id);
      const taken = { name: "Billing", description: "Billing capability" };
      store.rememberProposal({ ...taken, parentId: product.id });
      store.consumeDivisionRequest(product.id);
      expect(store.divisionRequests()).toEqual({});

      store.restoreDivisionRequest(product.id, taken);
      expect(store.divisionRequests()).toEqual({ [product.id]: taken });

      // A newer request arrives while the refused call was out.
      store.consumeDivisionRequest(product.id);
      const newer = { name: "Exports", description: "CSV exports" };
      store.rememberProposal({ ...newer, parentId: product.id });
      store.restoreDivisionRequest(product.id, taken);
      expect(store.divisionRequests()).toEqual({ [product.id]: newer });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });
});

describe("accepting a suggestion during a pause", () => {
  /** A waiting split of Automations' six threads. */
  async function splitWaiting() {
    const prompts: string[] = [];
    const s = await setup({
      split: (prompt) => {
        prompts.push(prompt);
        return prompts.length > 1
          ? // The newcomer, moved among the proposed workstreams.
            {
              reason: "",
              workstreams: [{ name: "Triggers", description: "" }],
              threads: [{ id: "r1", workstream: "Triggers" }],
            }
          : planningAndTriggers;
      },
    });
    const auto = s.workstreamStore.create("Automations", "The product");
    for (let i = 1; i <= 6; i++) {
      s.w.addThread(`t${i}`, { title: `Task ${i}` });
      s.workstreamStore.assign(`t${i}`, auto.id);
    }
    await s.rpc("refresh");
    const [split] = (await s.run()).suggestions;
    expect(split).toMatchObject({ kind: "split", status: "pending" });
    return { ...s, auto, split: split! };
  }
  const accepted = async (s: Awaited<ReturnType<typeof setup>>) =>
    (
      await s.rpc<{ entries: { action: string }[] }>("journal", {})
    ).entries.filter((entry) => entry.action === "suggestion-accepted");

  it("applies one that needs no model call", async () => {
    const s = await splitWaiting();
    const calls = s.w.completions.length;
    await s.pause();
    expect(await s.accept(s.split.id)).toMatchObject({
      applied: [s.split.id],
      failed: [],
    });
    expect(s.workstreamStore.assignment("t1").label).toBe(
      "Automations › Planning",
    );
    expect(s.workstreamStore.assignment("t6").label).toBe(
      "Automations › Triggers",
    );
    expect(s.w.completions).toHaveLength(calls);
  });

  it("refuses a split whose group threads joined, says the pause is why, and leaves it waiting with nothing moved", async () => {
    const s = await splitWaiting();
    s.w.addThread("t7", { title: "Task 7" });
    s.workstreamStore.assign("t7", s.auto.id);
    await s.rpc("refresh");
    expect((await s.state()).suggestions[0]?.arrivals).toEqual([
      { id: "t7", title: "Task 7" },
    ]);
    await s.pause();

    const refused = await s.accept(s.split.id);
    expect(refused.applied).toEqual([]);
    expect(refused.failed).toEqual([
      {
        id: s.split.id,
        reason: expect.stringMatching(
          /^Couldn't move the threads that joined since: Workstreams is paused: requests in the last hour reached/,
        ),
      },
    ]);
    // The call to move the newcomer was never asked, and nothing moved.
    expect(s.asked(REPAIR)).toHaveLength(0);
    expect(s.workstreamStore.workstreams(s.auto.id)).toBe(0);
    for (let i = 1; i <= 7; i++)
      expect(s.workstreamStore.assignment(`t${i}`).workstreamId).toBe(
        s.auto.id,
      );
    expect(await accepted(s)).toEqual([]);
    // It still waits, as it was: the refusal did not retire it.
    expect((await s.state()).suggestions).toMatchObject([
      {
        id: s.split.id,
        status: "pending",
        problem: null,
        arrivals: [{ id: "t7", title: "Task 7" }],
      },
    ]);

    await s.resume();
    expect((await s.accept(s.split.id)).applied).toEqual([s.split.id]);
    expect(s.asked(REPAIR)).toHaveLength(1);
    expect(s.workstreamStore.assignment("t1").label).toBe(
      "Automations › Planning",
    );
    expect(s.workstreamStore.assignment("t7").label).toBe(
      "Automations › Triggers",
    );
    expect(await accepted(s)).toHaveLength(1);
  });
});

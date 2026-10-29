import { afterEach, expect, it, vi } from "vitest";
import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { RECAP_TOOL } from "../../src/domain/recap.ts";
import { ERROR_GRACE_MS } from "../../src/domain/wake.ts";
import { PR_POLL_MS } from "../../src/server/snoozeWake.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const w of worlds.splice(0)) await w.harness.lifecycle.dispose();
});

async function world() {
  const w = await fakeWorld();
  worlds.push(w);
  w.addThread("t1", { latestAttentionAt: 500, status: "active" });
  w.addThread("d1", {
    latestAttentionAt: 500,
    status: "active",
    parentThreadId: "t1",
  });
  await w.harness.behavior.callRpc("refresh", null);
  return w;
}

type Snoozes = Record<string, { until: number | null; events?: boolean }>;
const snoozes = async (w: World) =>
  (
    (await w.harness.behavior.callRpc("state", null)) as {
      snoozes: Snoozes;
    }
  ).snoozes;
const snooze = (w: World, until: number | null, events?: boolean) =>
  w.harness.behavior.callRpc("snooze", { threadIds: ["t1"], until, events });
const refresh = (w: World) => w.harness.behavior.callRpc("refresh", null);

/** Ends `id`'s turn after the snooze, reported by its agent as `state`. */
async function endTurn(
  w: World,
  id: string,
  state: "complete" | "review" | "waiting",
) {
  await w.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      thread: { id, parentThreadId: w.threads.get(id)!.parentThreadId },
    }),
  );
  w.turn(id);
  await w.harness.behavior.callAgentTool(
    RECAP_TOOL,
    {
      state,
      goal: "Did the work",
      latest: state === "waiting" ? [] : ["Did it"],
      ...(state === "review" ? { review: ["Look at it"] } : {}),
      ...(state === "waiting" ? { timeout: 600 } : {}),
    },
    { threadId: id },
  );
  w.threads.set(id, {
    ...w.threads.get(id)!,
    status: "idle",
    latestAttentionAt: Date.now() + 1,
  });
  await refresh(w);
}

it("wakes an Until it needs me snooze when the turn ends ready for review", async () => {
  const w = await world();
  await snooze(w, null);
  await endTurn(w, "t1", "review");
  expect(await snoozes(w)).toEqual({});
  expect(w.markedUnread).toContain("t1");
});

it("keeps sleeping through a turn that ends still waiting", async () => {
  const w = await world();
  await snooze(w, null);
  await endTurn(w, "t1", "waiting");
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
});

it("wakes a timed snooze early only when it was set to wake on events", async () => {
  const w = await world();
  const until = Date.now() + 3_600_000;
  await snooze(w, until);
  expect((await snoozes(w)).t1).toEqual(
    expect.not.objectContaining({ events: true }),
  );
  await endTurn(w, "t1", "complete");
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);

  w.threads.set("t1", { ...w.threads.get("t1")!, status: "active" });
  await refresh(w);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await snooze(w, until, true);
  expect((await snoozes(w)).t1).toMatchObject({ until, events: true });
  await endTurn(w, "t1", "complete");
  expect(await snoozes(w)).toEqual({});
});

it("leaves a snooze alone when its wake event is turned off", async () => {
  const w = await world();
  await w.harness.behavior.callRpc("setSnoozePrefs", {
    patch: { events: { done: false } },
  });
  await snooze(w, null);
  await endTurn(w, "t1", "complete");
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
});

it("wakes a snoozed thread when it or a delegate asks a question", async () => {
  const w = await world();
  const ask = (id: string) =>
    w.harness.behavior.emitThreadEvent("interaction.pending", {
      thread: w.threads.get(id)!,
      interaction: { id: `i-${id}`, origin: null },
    } as never);
  await snooze(w, null);
  await ask("d1");
  expect(await snoozes(w)).toEqual({});

  await snooze(w, null);
  await w.harness.behavior.callRpc("setSnoozePrefs", {
    patch: { events: { "needs-you": false } },
  });
  await ask("t1");
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
});

it("wakes a delegate's root when the delegate's turn needs review", async () => {
  const w = await world();
  await snooze(w, null);
  await endTurn(w, "d1", "complete");
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
  w.threads.set("d1", { ...w.threads.get("d1")!, status: "active" });
  await endTurn(w, "d1", "review");
  expect(await snoozes(w)).toEqual({});
});

it("wakes on a failed turn once BB has had time to queue a retry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const w = await world();
  await snooze(w, null);
  vi.setSystemTime(Date.now() + 1);
  w.threads.set("t1", {
    ...w.threads.get("t1")!,
    status: "error",
    latestAttentionAt: Date.now() + 1,
  });
  await w.harness.behavior.emitThreadEvent("thread.failed", {
    thread: w.threads.get("t1")!,
    error: "boom",
  });
  await refresh(w);
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
  vi.setSystemTime(Date.now() + ERROR_GRACE_MS);
  await refresh(w);
  expect(await snoozes(w)).toEqual({});
});

it("wakes when the pull request changes into feedback, not for its state at snooze time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const w = await world();
  w.pullRequests.set("env_1", "checks_failed");
  await snooze(w, null);
  await refresh(w);
  expect((await snoozes(w)).t1).toMatchObject({ pr: "checks_failed" });

  w.pullRequests.set("env_1", "checks_pending");
  vi.setSystemTime(Date.now() + PR_POLL_MS);
  await refresh(w);
  expect((await snoozes(w)).t1).toMatchObject({ pr: "checks_pending" });

  w.pullRequests.set("env_1", "checks_failed");
  await refresh(w);
  // Looked up at most every few minutes.
  expect(Object.keys(await snoozes(w))).toEqual(["t1"]);
  vi.setSystemTime(Date.now() + PR_POLL_MS);
  await refresh(w);
  expect(await snoozes(w)).toEqual({});
});

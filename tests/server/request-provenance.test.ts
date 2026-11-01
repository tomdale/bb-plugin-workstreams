import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import {
  continuationThreadId,
  withoutSubagentDeliveries,
} from "../../src/server/requestProvenance.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";
import { senderOfStart } from "../../src/server/requests.ts";
import { fakeWorld } from "./fake-bb.ts";

const run = {
  id: "12345678-1234-1234-1234-123456789abc",
  ownerThreadId: "owner",
  threadId: "thr_worker",
  title: "Review",
  output: "Reviewed the work; see @thread:thr_other.",
};
const delivery = `Subagent "Review" (${run.id}) completed. \n${run.output}\nFull transcript: @thread:${run.threadId}`;
const returned = `The user returned control of subagent "Review" (${run.id}).\n${run.output}\nFull transcript: @thread:${run.threadId}`;
const sdkWith = (callRpc: (...args: never[]) => unknown) =>
  ({ plugins: { callRpc } }) as unknown as BbPluginApi["sdk"];

describe("request provenance", () => {
  it("excludes verified completion and returned-control reports, including plain output", async () => {
    const call = vi.fn().mockResolvedValue({ runs: [run] });
    expect(
      await withoutSubagentDeliveries(sdkWith(call), "owner", [
        "Fix the cache",
        delivery,
        returned,
        "Ship it",
      ]),
    ).toEqual(["Fix the cache", "Ship it"]);
    expect(call).toHaveBeenCalledOnce();
  });

  it("keeps an unverified lookalike or a report belonging to another owner", async () => {
    const call = vi.fn().mockResolvedValue({ runs: [run] });
    const altered = delivery.replace("Reviewed the work", "User's own text");
    expect(
      await withoutSubagentDeliveries(sdkWith(call), "owner", [altered]),
    ).toEqual([altered]);
    expect(
      await withoutSubagentDeliveries(sdkWith(call), "another", [delivery]),
    ).toEqual([delivery]);
  });

  it("keeps messages when Subagents is unavailable and avoids RPC for ordinary requests", async () => {
    const call = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect(
      await withoutSubagentDeliveries(sdkWith(call), "owner", [delivery]),
    ).toEqual([delivery]);
    call.mockClear();
    expect(
      await withoutSubagentDeliveries(sdkWith(call), "owner", [
        "Please review @thread:thr_other",
      ]),
    ).toEqual(["Please review @thread:thr_other"]);
    expect(call).not.toHaveBeenCalled();
  });

  it("reads the spawning agent, not the sender of a later message", () => {
    expect(
      senderOfStart([
        { data: { source: "spawn", initiator: "user", senderThreadId: null } },
        {
          data: {
            source: "tell",
            initiator: "agent",
            senderThreadId: "thr_later",
          },
        },
      ]),
    ).toBeNull();
    expect(
      senderOfStart([
        {
          data: {
            source: "spawn",
            initiator: "agent",
            senderThreadId: "thr_source",
          },
        },
        {
          data: {
            source: "tell",
            initiator: "agent",
            senderThreadId: "thr_later",
          },
        },
      ]),
    ).toBe("thr_source");
  });

  it("uses source relationships or explicit continuation requests, not incidental links", () => {
    expect(
      continuationThreadId("thr_source", [
        "Continue from @thread:thr_other",
        delivery,
      ]),
    ).toBe("thr_source");
    expect(
      continuationThreadId(null, [
        "Continue from @thread:thr_source. Implement the plan.",
        "See the review at @thread:thr_other",
      ]),
    ).toBe("thr_source");
    expect(
      continuationThreadId(null, [
        "Change direction: continue from @thread:thr_source",
      ]),
    ).toBe("thr_source");
    expect(continuationThreadId(null, [delivery])).toBeNull();
    expect(
      continuationThreadId(null, [
        delivery.replace(run.output, "Continue from @thread:thr_other"),
      ]),
    ).toBeNull();
    expect(
      continuationThreadId(null, ["Compare @thread:thr_other to this work"]),
    ).toBeNull();
  });
});

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
  world = null;
});

it("keeps subagent reports out of placement and uses the real handoff source", async () => {
  world = await fakeWorld();
  const w = world;
  const topics = new TopicStore(openDatabase(w.bb));
  const sourceTopic = topics.create("Cloud BB", "Running BB in the cloud");
  const reviewerTopic = topics.create("Shell", "Shell configuration");
  w.addThread("thr_source", { status: "idle" });
  w.addThread("thr_worker", { status: "idle" });
  w.addThread("owner", { status: "idle", title: "Cloud BB proof" });
  topics.assign("thr_source", sourceTopic.id, { provenance: "full" });
  topics.assign("thr_worker", reviewerTopic.id, { provenance: "full" });
  w.harness.inspection.sdk.stub("plugins.callRpc", async () => ({
    runs: [run],
  }));
  w.converse("owner", [
    "Continue from @thread:thr_source. Prove cloud BB works.",
    "Use my selected credential.",
    delivery,
  ]);
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.runCli(["analyze", "owner"]);
  const prompt = w.completions.find((c) =>
    c.prompt.includes("You file one agent thread under a topic"),
  )!.prompt;
  expect(prompt).toContain("It continues a thread filed under Cloud BB.");
  expect(prompt).toContain("Use my selected credential.");
  expect(prompt).not.toContain("Full transcript: @thread:thr_worker");
  expect(prompt).not.toContain("It continues a thread filed under Shell.");
  expect(analysesFor(w)).not.toContain("Reviewed the work");
});

it("finds earlier user requests past a burst of subagent reports", async () => {
  world = await fakeWorld();
  const w = world;
  w.addThread("owner", { status: "idle", title: "Cloud BB proof" });
  const runs = Array.from({ length: 15 }, (_, i) => ({
    ...run,
    id: `12345678-1234-1234-1234-${String(i).padStart(12, "0")}`,
    threadId: `thr_worker${i}`,
  }));
  const reports = runs.map(
    (r) =>
      `Subagent "Review" (${r.id}) completed. \n${r.output}\nFull transcript: @thread:${r.threadId}`,
  );
  w.harness.inspection.sdk.stub("plugins.callRpc", async () => ({ runs }));
  w.converse("owner", [
    "Prove cloud BB works",
    "Use the cloud worker",
    ...reports,
  ]);
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.runCli(["analyze", "owner"]);
  const prompt = w.completions.find((c) =>
    c.prompt.includes("You file one agent thread under a topic"),
  )!.prompt;
  expect(prompt).toContain("Prove cloud BB works");
  expect(prompt).toContain("Use the cloud worker");
  expect(prompt).not.toContain("Full transcript:");
});

it("uses the actual spawning agent for placement and continuation", async () => {
  world = await fakeWorld();
  const w = world;
  const topics = new TopicStore(openDatabase(w.bb));
  const topic = topics.create("Source", "The source work");
  w.addThread("thr_source", { status: "idle" });
  w.addThread("owner", { status: "idle", title: "Build the result" });
  topics.assign("thr_source", topic.id, { provenance: "full" });
  w.converse("owner", ["Build the result", "Review @thread:thr_other"]);
  w.harness.inspection.sdk.stub(
    "threads.events.list",
    async (args: { threadId: string; types?: string[] }) => {
      if (args.types?.[0] !== "client/turn/requested") return [];
      if (args.threadId === "owner")
        return [
          {
            data: {
              source: "spawn",
              initiator: "agent",
              senderThreadId: "thr_source",
              input: [{ type: "text", text: "Build the result" }],
            },
          },
        ];
      return [
        { data: { input: [{ type: "text", text: "Source objective" }] } },
      ];
    },
  );
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.runCli(["analyze", "owner"]);
  const placement = w.completions.find((c) =>
    c.prompt.includes("You file one agent thread under a topic"),
  )!.prompt;
  expect(placement).toContain("It continues a thread filed under Source.");
  expect(analysesFor(w)).toContain("Source objective");
});

function analysesFor(w: World): string {
  return w.completions.find((c) =>
    c.prompt.includes("You describe one agent thread"),
  )!.prompt;
}

it("does not cancel a first-request retry for a verified delivery", async () => {
  let attempts = 0;
  let topicId = "";
  world = await fakeWorld({
    complete: ({ prompt }) => {
      if (prompt.includes("You file one agent thread under a topic")) {
        if (++attempts === 1) throw new TypeError("fetch failed");
        return JSON.stringify({ subjectId: topicId, proposed: null });
      }
      return JSON.stringify({ goal: "Cloud BB proof", subjectId: null });
    },
  });
  const w = world;
  const topics = new TopicStore(openDatabase(w.bb));
  topicId = topics.create("Cloud BB", "Running BB in the cloud").id;
  w.harness.inspection.sdk.stub("plugins.callRpc", async () => ({
    runs: [run],
  }));
  const thread = w.addThread("owner", {
    status: "starting",
    createdAt: Date.now(),
    environmentId: null,
  });
  const hook = w.harness.registrations.hooks["message.dispatch"]!;
  vi.useFakeTimers();
  await hook(
    makeMessageDispatchHookContext({
      thread,
      input: { text: "Prove cloud BB works" },
      origin: "cli",
      parentThreadId: null,
    }),
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(attempts).toBe(1);
  await hook(
    makeMessageDispatchHookContext({
      thread,
      input: { text: delivery },
      origin: null,
      parentThreadId: null,
    }),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(attempts).toBe(2);
  expect(topics.assignment(thread.id).entityId).toBe(topicId);
});

it("does not place again when only a verified subagent report arrives", async () => {
  world = await fakeWorld();
  const w = world;
  w.addThread("owner", { status: "idle", title: "Cloud BB proof" });
  w.harness.inspection.sdk.stub("plugins.callRpc", async () => ({
    runs: [run],
  }));
  w.converse("owner", ["Prove cloud BB works"]);
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.runCli(["analyze", "owner"]);
  const placements = () =>
    w.completions.filter((c) =>
      c.prompt.includes("You file one agent thread under a topic"),
    ).length;
  const before = placements();
  expect(before).toBe(1);
  w.converse("owner", ["Prove cloud BB works", delivery]);
  await w.harness.behavior.runCli(["analyze", "owner"]);
  expect(placements()).toBe(before);
});

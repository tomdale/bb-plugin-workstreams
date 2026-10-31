import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
});

describe("what Full analysis reads besides the thread", () => {
  it("reads a continuation reference supplied after the opening request", async () => {
    world = await fakeWorld();
    const w = world;
    w.addThread("source");
    w.converse("source", ["Audit the billing pipeline architecture"]);
    w.addThread("t", { status: "idle" });
    w.converse("t", [
      "Discuss the release pipeline",
      "Change direction: continue from @thread:source",
    ]);
    await w.harness.behavior.runCli(["analyze", "t"]);
    expect(w.completions.at(-1)?.prompt).toContain(
      "Audit the billing pipeline architecture",
    );
  });

  it("includes bounded opening intent from an explicit continuation thread", async () => {
    world = await fakeWorld();
    const w = world;
    w.addThread("source");
    w.converse("source", ["Audit the release pipeline architecture"]);
    w.addThread("t", { status: "idle" });
    w.converse("t", ["Continue from @thread:source and review my changes"]);
    await w.harness.behavior.runCli(["analyze", "t"]);
    expect(w.completions.at(-1)?.prompt).toContain(
      "Audit the release pipeline architecture",
    );
    expect(w.completions.at(-1)?.prompt).toContain(
      "Referenced continuation context",
    );
  });

  it("treats a bare continuation as status-only", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          recap: "Working",
          state: "in_progress",
          goal: "Building release pipeline",
        }),
    });
    const w = world;
    w.addThread("t", { status: "idle", latestAttentionAt: 10 });
    w.converse("t", ["Build the release pipeline"]);
    await w.harness.behavior.runCli(["analyze", "t"]);
    w.converse("t", ["Build the release pipeline", "continue"]);
    w.threads.set("t", { ...w.threads.get("t")!, latestAttentionAt: 20 });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await w.harness.behavior.emitThreadEvent("thread.idle", {
      thread: w.threads.get("t")!,
      lastAssistantText: "Still working",
    });
    await vi.advanceTimersByTimeAsync(6000);
    const last = w.completions
      .filter((c) => c.prompt.includes("You describe one agent thread"))
      .at(-1)!;
    expect(last.prompt).not.toContain("- goal:");
  });

  it("keeps credentials in a request out of the prompt and what it stores", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          recap: "Working",
          state: "in_progress",
          goal: "Auditing release pipeline",
        }),
    });
    const w = world;
    const credential = "sk-" + "x".repeat(24);
    w.addThread("t", { status: "idle" });
    w.converse("t", [`Audit the pipeline using ${credential}`]);
    await w.harness.behavior.runCli(["analyze", "t"]);
    expect(w.completions.at(-1)?.prompt).not.toContain(credential);
    const state = await w.harness.behavior.callRpc("state", null);
    expect(JSON.stringify(state)).not.toContain(credential);
  });
});

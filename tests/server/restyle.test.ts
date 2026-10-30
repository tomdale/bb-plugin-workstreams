import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { writeTitleRecord } from "../../src/server/titles.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const RESTYLE = "You rename one agent thread whose title was written";

/** A world whose model restyles each title from this table. */
async function setup(titles: Record<string, string>) {
  world = await fakeWorld({
    complete: ({ prompt }) => {
      if (!prompt.includes(RESTYLE)) return JSON.stringify({});
      const from = Object.keys(titles).find((t) =>
        prompt.includes(`<title>\n${t}\n</title>`),
      );
      return JSON.stringify({ title: from ? titles[from] : "Unknown" });
    },
  });
  const w = world;
  const db = openDatabase(w.bb);
  /** A thread titled by Workstreams, or renamed by hand when `locked`. */
  const titled = (id: string, title: string, locked = false) => {
    w.addThread(id, { title, status: "idle", latestAttentionAt: 10 });
    writeTitleRecord(db, id, {
      observed: title,
      written: locked ? "Earlier title" : title,
      locked,
      retitledAt: 1,
      provisional: false,
    });
  };
  const cli = (...args: string[]) =>
    w.harness.behavior.runCli(["titles", "restyle", ...args]);
  return { w, titled, cli };
}

describe("titles restyle", () => {
  it("proposes new titles for the threads Workstreams titled, and renames them on --apply", async () => {
    const { w, titled, cli } = await setup({
      "Review Phase 1 security and boundaries": "Phase 1 security review",
      "Redesign the Work tab": "Work tab redesign",
    });
    titled("a", "Review Phase 1 security and boundaries");
    titled("b", "Redesign the Work tab");
    titled("mine", "My own name", true);
    w.addThread("bb", { title: "Named by BB", status: "idle" });
    await w.harness.behavior.callRpc("refresh", null);

    const dry = await cli("--json");
    // In the order of their current titles.
    expect(JSON.parse(dry.stdout)).toEqual([
      {
        threadId: "b",
        from: "Redesign the Work tab",
        to: "Work tab redesign",
        result: "proposed",
      },
      {
        threadId: "a",
        from: "Review Phase 1 security and boundaries",
        to: "Phase 1 security review",
        result: "proposed",
      },
    ]);
    expect(w.threads.get("a")!.title).toBe(
      "Review Phase 1 security and boundaries",
    );

    const applied = await cli("--apply");
    expect(applied.stdout).toContain("Renamed 2; 0 skipped");
    expect(w.threads.get("a")!.title).toBe("Phase 1 security review");
    expect(w.threads.get("b")!.title).toBe("Work tab redesign");
    expect(w.threads.get("mine")!.title).toBe("My own name");
    expect(w.threads.get("bb")!.title).toBe("Named by BB");
  });

  it("skips a thread whose turn is running", async () => {
    const { w, titled, cli } = await setup({
      "Redesign the Work tab": "Work tab redesign",
    });
    titled("b", "Redesign the Work tab");
    w.threads.set("b", { ...w.threads.get("b")!, status: "active" });
    await w.harness.behavior.callRpc("refresh", null);
    const applied = await cli("--json", "--apply");
    expect(JSON.parse(applied.stdout)).toMatchObject([
      { threadId: "b", result: "skipped", reason: "stale" },
    ]);
    expect(w.threads.get("b")!.title).toBe("Redesign the Work tab");
  });
});

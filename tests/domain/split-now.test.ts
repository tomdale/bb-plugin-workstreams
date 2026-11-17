import { describe, expect, it } from "vitest";
import { splitNow, type Split, type TreeState } from "../../src/domain/tidy.ts";

const tree = (
  threadWorkstream: Record<string, string | null>,
  extra: TreeState["workstreams"] = [],
): TreeState => ({
  workstreams: [{ id: "auto", name: "Automations", parentId: null }, ...extra],
  held: {},
  threadWorkstream,
});

const split: Split = {
  workstreamId: "auto",
  workstreams: [
    { name: "PR Upkeep", description: "", threadIds: ["a1", "a2"] },
    { name: "Design", description: "", threadIds: ["a3", "a4"] },
  ],
};

describe("splitNow", () => {
  it("applies as proposed when nothing changed", () => {
    expect(
      splitNow(split, tree({ a1: "auto", a2: "auto", a3: "auto", a4: "auto" })),
    ).toEqual({ split, arrivals: [], problem: null, moot: false });
  });

  it("drops threads that moved or closed since, and still applies", () => {
    const now = splitNow(
      split,
      tree({ a1: "auto", a3: "auto", a4: "elsewhere" }),
    );
    expect(now.problem).toBeNull();
    expect(now.split.workstreams.map((g) => [g.name, g.threadIds])).toEqual([
      ["PR Upkeep", ["a1"]],
      ["Design", ["a3"]],
    ]);
  });

  it("lists threads that joined since, to be moved when accepted", () => {
    const now = splitNow(
      split,
      tree({ a1: "auto", a2: "auto", a3: "auto", a4: "auto", n1: "auto" }),
    );
    expect(now).toMatchObject({ arrivals: ["n1"], problem: null });
  });

  it("stops when more threads joined than remain", () => {
    expect(
      splitNow(split, tree({ a1: "auto", n1: "auto", n2: "auto" })).problem,
    ).toBe("2 threads joined Automations since; ask again to include them.");
  });

  it("stops when none of its threads remain, or the split leaves one workstream", () => {
    expect(splitNow(split, tree({ n1: "auto" }))).toMatchObject({
      problem: "None of its threads are in Automations anymore.",
      moot: true,
    });
    expect(splitNow(split, tree({ a1: "auto", a2: "auto" }))).toMatchObject({
      problem: "Only one of its workstreams still has threads.",
      moot: false,
    });
    expect(splitNow(split, tree({}, [])).problem).toBe(
      "None of its threads are in Automations anymore.",
    );
    expect(
      splitNow({ ...split, workstreamId: "gone" }, tree({ a1: "auto" }))
        .problem,
    ).toBe("Its group is gone.");
  });

  it("lets a move of threads beside workstreams go ahead with one workstream, until none are left", () => {
    const repair: Split = {
      workstreamId: "auto",
      repair: true,
      workstreams: [
        { name: "Alerts", description: "", threadIds: ["a1"] },
        { name: "Design", description: "", threadIds: ["a2"] },
      ],
    };
    const alerts = [{ id: "alerts", name: "Alerts", parentId: "auto" }];
    const now = splitNow(repair, tree({ a1: "auto", a2: "x" }, alerts));
    expect(now.problem).toBeNull();
    expect(now.split.workstreams.map((g) => g.name)).toEqual(["Alerts"]);
    expect(splitNow(repair, tree({ a1: "x" }, alerts)).problem).toBe(
      "Automations no longer holds threads beside its workstreams.",
    );
  });
});

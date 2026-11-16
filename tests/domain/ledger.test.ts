import { describe, expect, it } from "vitest";
import { ledgerKind, ledgerRows } from "../../src/domain/ledger.ts";
import type { WorkstreamPlace } from "../../src/domain/suggestion-change.ts";

const at = (...names: string[]): WorkstreamPlace =>
  names.map((name) => ({ name, created: false }));
const fresh = (place: WorkstreamPlace, name: string): WorkstreamPlace => [
  ...place,
  { name, created: true },
];
const thread = (id: string) => ({ id, title: `Thread ${id}` });

describe("ledgerRows", () => {
  it("lists a split's threads one per row, Now once, and marks each new group where it first appears", () => {
    const change = {
      op: "split" as const,
      moves: [
        {
          from: at("Automations"),
          to: fresh(at("Automations"), "PR Upkeep"),
          threads: [thread("a1"), thread("a2")],
          carried: 0,
        },
        {
          from: at("Color Settings"),
          to: fresh(at("Automations"), "Design"),
          threads: [thread("a3")],
          carried: 0,
        },
      ],
    };
    expect(ledgerKind(change)).toBe("threads");
    expect(
      ledgerRows(change).map((r) => [r.subject, r.now, r.after, r.created]),
    ).toEqual([
      ["Thread a1", "Automations", "PR Upkeep", true],
      ["Thread a2", "", "PR Upkeep", false],
      ["Thread a3", "Color Settings", "Design", true],
    ]);
  });

  it("shows a thread in no workstream as No workstream", () => {
    const [row] = ledgerRows({
      op: "move-thread",
      moves: [
        { from: null, to: at("Sync"), threads: [thread("u")], carried: 0 },
      ],
    });
    expect(row).toMatchObject({ now: "No workstream", other: true, after: "Sync" });
  });

  it("names group changes by group: a move under a parent, a rename, a merge", () => {
    const rows = (
      op: "move-workstream" | "rename" | "merge",
      from: WorkstreamPlace,
      to: WorkstreamPlace,
    ) =>
      ledgerRows({ op, moves: [{ from, to, threads: [], carried: 2 }] }).map(
        (r) => [r.subject, r.now, r.verb, r.after],
      );
    expect(rows("move-workstream", at("Workforest"), at("bb", "Workforest"))).toEqual([
      ["Workforest", "Top level", null, "bb"],
    ]);
    expect(
      rows(
        "move-workstream",
        at("Vercel Agent Code Review"),
        at("Vercel Agent", "Code Review"),
      ),
    ).toEqual([
      [
        "Vercel Agent Code Review",
        "Top level",
        null,
        "Vercel Agent › Code Review",
      ],
    ]);
    expect(rows("rename", at("bb", "Todo"), at("bb", "Todo Plugin"))).toEqual([
      ["Todo", "bb", null, "Todo Plugin"],
    ]);
    expect(
      rows("merge", at("Sandbox Settings"), at("bb", "Sandbox Plugin")),
    ).toEqual([["Sandbox Settings", "Top level", "into", "Sandbox Plugin"]]);
  });
});

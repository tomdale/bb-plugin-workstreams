import { describe, expect, it } from "vitest";
import {
  nextThreadAfterLeaving,
  nextUpNextThread,
  upNextFocus,
  upNextOrder,
} from "../../src/domain/upNextNavigation.ts";
import type { LayoutNode } from "../../src/domain/layout.ts";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { thread } from "./fixtures.ts";

const sections = [
  { id: "ws", name: "Workstream" },
  { id: "elsewhere", name: "Elsewhere" },
];
const kindOf = (thread: { hasPendingInteraction: boolean }) =>
  thread.hasPendingInteraction ? ("question" as const) : ("other" as const);
/** Up Next options; open questions never age, so the clock doesn't matter. */
const options = { kindOf, now: 0 };
const asking = (latestAttentionAt: number, sectionId = "ws") => ({
  sectionId,
  hasPendingInteraction: true,
  latestAttentionAt,
});

/** Up Next ranks first, second, third; quiet and the child are not in it. */
const listing = [
  thread("first", asking(300)),
  thread("child", { ...asking(400), parentThreadId: "first" }),
  thread("second", asking(200)),
  thread("third", asking(100, "elsewhere")),
];
const projection = projectWorkstreams(listing, sections, { now: 0 });
const order = upNextOrder(projection, options, { focused: [] });

describe("nextUpNextThread", () => {
  it("takes the row after the thread in view, wrapping to the top", () => {
    expect(order).toEqual(["first", "second", "third"]);
    expect(nextUpNextThread(projection, order, "first")).toBe("second");
    expect(nextUpNextThread(projection, order, "third")).toBe("first");
  });

  it("starts at the top with no thread or one Up Next doesn't list", () => {
    expect(nextUpNextThread(projection, order, null)).toBe("first");
    expect(nextUpNextThread(projection, order, "missing")).toBe("first");
    expect(nextUpNextThread(projection, ["only"], "only")).toBeNull();
    expect(nextUpNextThread(projection, [], null)).toBeNull();
  });

  it("places a child thread on its parent thread's row", () => {
    expect(nextUpNextThread(projection, order, "child")).toBe("second");
  });

  it("follows the order it is given, such as the sidebar's held one", () => {
    // The sidebar holds an open thread in place after reading it re-ranks it.
    const held = ["second", "first", "third"];
    expect(nextUpNextThread(projection, held, "second")).toBe("first");
  });

  it("skips the threads leaving with the one in view", () => {
    expect(
      nextUpNextThread(projection, order, "first", new Set(["second"])),
    ).toBe("third");
  });
});

describe("nextThreadAfterLeaving", () => {
  it("opens the thread the next Up Next command would", () => {
    for (const id of [...order, "child"])
      expect(nextThreadAfterLeaving(projection, order, id, new Set())).toBe(
        nextUpNextThread(projection, order, id),
      );
  });

  it("keeps going past Up Next when it has nothing else", () => {
    const quiet = projectWorkstreams(
      [
        thread("root", { sectionId: "ws", latestAttentionAt: 300 }),
        thread("child", { sectionId: "ws", parentThreadId: "root" }),
        thread("sibling", { sectionId: "ws", latestAttentionAt: 100 }),
        thread("recent", { sectionId: "elsewhere", latestAttentionAt: 200 }),
      ],
      sections,
      { now: 0 },
    );
    // A child thread going away leaves the user on its parent thread.
    expect(nextThreadAfterLeaving(quiet, [], "child", new Set())).toBe("root");
    // A top-level thread goes on in its workstream, past its own subtree.
    expect(nextThreadAfterLeaving(quiet, [], "root", new Set(["child"]))).toBe(
      "sibling",
    );
    // With its workstream empty, the most recently active thread.
    expect(
      nextThreadAfterLeaving(quiet, [], "sibling", new Set(["root", "child"])),
    ).toBe("recent");
    expect(
      nextThreadAfterLeaving(
        quiet,
        [],
        "recent",
        new Set(["root", "child", "sibling"]),
      ),
    ).toBeNull();
  });

  it("wraps within the workstream, skipping snoozed and leaving threads", () => {
    const quiet = projectWorkstreams(
      [
        thread("a", { sectionId: "ws", latestAttentionAt: 300 }),
        thread("b", { sectionId: "ws", latestAttentionAt: 200 }),
        thread("c", { sectionId: "ws", latestAttentionAt: 100 }),
        thread("napping", { sectionId: "ws", latestAttentionAt: 50 }),
      ],
      sections,
      {
        now: 0,
        snoozedUntil: (t) => (t.id === "napping" ? null : undefined),
      },
    );
    expect(nextThreadAfterLeaving(quiet, [], "c", new Set())).toBe("a");
    expect(nextThreadAfterLeaving(quiet, [], "c", new Set(["a"]))).toBe("b");
  });
});

describe("upNextFocus", () => {
  const nested = [
    { id: "sec_alerts", name: "Beacon › Alerts" },
    { id: "sec_cli", name: "Beacon › CLI" },
    { id: "sec_else", name: "Else" },
  ];
  const layoutNode = (
    workstreamId: string,
    name: string,
    children: LayoutNode[] = [],
  ): LayoutNode => ({
    workstreamId,
    name,
    prefix: [],
    lists: children.length === 0,
    total: 0,
    children,
  });
  const workstreams = {
    workstreams: [
      { id: "beacon", name: "Beacon", parentId: null },
      { id: "alerts", name: "Alerts", parentId: "beacon" },
      { id: "cli", name: "CLI", parentId: "beacon" },
      { id: "else", name: "Else", parentId: null },
    ],
    bindings: { sec_alerts: "alerts", sec_cli: "cli", sec_else: "else" },
    layout: [
      layoutNode("beacon", "Beacon", [
        layoutNode("alerts", "Alerts"),
        layoutNode("cli", "CLI"),
      ]),
      layoutNode("else", "Else"),
    ],
  };
  const focusing = projectWorkstreams(
    [
      thread("alert", asking(100, "sec_alerts")),
      thread("cli", asking(200, "sec_cli")),
      thread("else", asking(300, "sec_else")),
    ],
    nested,
    { now: 0 },
  );

  it("covers every section of the focused top-level workstream", () => {
    expect(
      [...upNextFocus(focusing, ["sec_alerts"], workstreams)].sort(),
    ).toEqual(["sec_alerts", "sec_cli"]);
    expect(upNextFocus(focusing, [], workstreams).size).toBe(0);
  });

  it("ranks Up Next under that focus", () => {
    expect(
      upNextOrder(focusing, options, { focused: ["sec_alerts"], workstreams }),
    ).toEqual(["cli", "alert"]);
  });
});

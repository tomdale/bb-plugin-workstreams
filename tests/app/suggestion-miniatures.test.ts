import { describe, expect, it } from "vitest";
import {
  miniature,
  miniatureBase,
  TICK_CAP,
  type MiniatureInput,
  type MiniWorkstream,
} from "../../src/app/sidebar/suggestionMiniatures.ts";
import {
  changeDelta,
  newTopicId,
  type ChangeContext,
} from "../../src/domain/suggestion-change.ts";
import type { Split, TidyEdit } from "../../src/domain/tidy.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 400 * DAY;

const topics = [
  { id: "billing", name: "Billing", parentId: null },
  { id: "invoices", name: "Invoices", parentId: "billing" },
  { id: "payments", name: "Payments", parentId: "billing" },
  { id: "docs", name: "Docs", parentId: null },
  { id: "infra", name: "Infra", parentId: null },
];
const sectionOf: Record<string, string> = {
  invoices: "sec_invoices",
  payments: "sec_payments",
  docs: "sec_docs",
  infra: "sec_infra",
};
/** Thread id, topic, title, last activity in days. */
const threads = [
  ["i1", "invoices", "Fix invoice totals", 1],
  ["i2", "invoices", "Add invoice export", 2],
  ["p1", "payments", "Retry failed payments", 3],
  ["d1", "docs", "Write the quick start", 4],
  ["d2", "docs", "Document the API", 5],
  ["d3", "docs", "Review error messages", 6],
  ["f1", "infra", "Cache cold builds", 7],
  ["u1", null, "Loose thread", 8],
] as const;

const input = (extra: Partial<MiniatureInput> = {}): MiniatureInput => ({
  threads: threads.map(([id, topic, title, ago]) => ({
    id,
    title,
    sectionId: topic ? sectionOf[topic]! : null,
    activeAt: NOW - ago * DAY,
  })),
  topics,
  filing: Object.fromEntries(threads.map(([id, topic]) => [id, topic])),
  colors: {
    groups: Object.fromEntries(
      Object.entries(sectionOf).map(([topic, section]) => [section, topic]),
    ),
    colors: {
      billing: { hue: 200, level: 0 },
      invoices: { hue: 210, level: 0 },
      payments: { hue: 230, level: 0 },
      docs: { hue: 300, level: 0 },
      infra: { hue: 40, level: 0 },
    },
  },
  sort: "alphabetical",
  sections: Object.values(sectionOf),
  manualOrder: [],
  delta: { topics: [], removed: [], assignments: [] },
  now: NOW,
  ...extra,
});

const context = (): ChangeContext => ({
  topics,
  threadTopic: Object.fromEntries(threads.map(([id, topic]) => [id, topic])),
  title: (id) => id,
});
const delta = (body: TidyEdit | Split) => changeDelta(body, context())!;

const label = (w: MiniWorkstream) =>
  w.prefix ? `${w.prefix}: ${w.name}` : w.name;
const labels = (list: readonly MiniWorkstream[]) => list.map(label);
const find = (list: readonly MiniWorkstream[], name: string) =>
  list.find((w) => label(w) === name)!;
const flowed = (w: MiniWorkstream) =>
  w.ticks.filter((t) => t.flow !== null).length;

describe("miniature", () => {
  it("draws every workstream with a visible thread, Unfiled last", () => {
    const m = miniature(input())!;
    expect(labels(m.now)).toEqual([
      "Billing: Invoices",
      "Billing: Payments",
      "Docs",
      "Infra",
      "Unfiled",
    ]);
    expect(find(m.now, "Docs").ticks).toHaveLength(3);
    expect(m.flows).toEqual([]);
    expect(m.now.every((w) => !w.hot)).toBe(true);
  });

  it("draws dormant workstreams, which the sidebar hides", () => {
    const base = input();
    const old = miniature(
      input({
        threads: base.threads.map((t) => ({ ...t, activeAt: 1 })),
      }),
    )!;
    expect(labels(old.now)).toContain("Docs");
  });

  it("draws a refile as one thread moving between two marked workstreams", () => {
    const m = miniature(
      input({
        delta: delta({ op: "move", thread: "d1", topic: "infra" }),
      }),
    )!;
    expect(m.flows).toHaveLength(1);
    expect(m.flows[0]).toMatchObject({
      to: { prefix: null, name: "Infra" },
      threads: [{ id: "d1", title: "Write the quick start" }],
    });
    expect(m.flows[0]!.color).toEqual({ hue: 40, level: 0 });
    const hot = (list: readonly MiniWorkstream[]) =>
      list.filter((w) => w.hot).map(label);
    expect(hot(m.now)).toEqual(["Docs", "Infra"]);
    expect(hot(m.after)).toEqual(["Docs", "Infra"]);
    expect(find(m.now, "Docs").ticks).toHaveLength(3);
    expect(find(m.after, "Docs").ticks).toHaveLength(2);
    // The moved thread is the last tick of its new workstream.
    expect(find(m.after, "Infra").ticks.map((t) => t.flow)).toEqual([null, 0]);
    expect(find(m.now, "Docs").ticks.map((t) => t.flow)).toEqual([
      null,
      null,
      0,
    ]);
  });

  it("draws a split as new workstreams each taking a share of the threads", () => {
    const m = miniature(
      input({
        delta: delta({
          topicId: "docs",
          subgroups: [
            { name: "Guides", description: "", threadIds: ["d1", "d2"] },
            { name: "Reference", description: "", threadIds: ["d3"] },
          ],
        }),
      }),
    )!;
    expect(labels(m.after)).toEqual([
      "Billing: Invoices",
      "Billing: Payments",
      "Docs: Guides",
      "Docs: Reference",
      "Infra",
      "Unfiled",
    ]);
    expect(m.flows.map((f) => f.threads.length)).toEqual([2, 1]);
    expect(find(m.after, "Docs: Guides").prefix).toBe("Docs");
    expect(flowed(find(m.now, "Docs"))).toBe(3);
    // Each new workstream gets a color of its own, from its parent's.
    const [guides, reference] = m.flows;
    expect(guides!.color).not.toEqual(reference!.color);
  });

  it("draws a merge: the merged workstream leaves, its threads arrive", () => {
    const m = miniature(
      input({
        delta: delta({ op: "merge", from: "payments", into: "invoices" }),
      }),
    )!;
    expect(labels(m.after)).not.toContain("Billing: Payments");
    expect(find(m.after, "Billing: Invoices").ticks).toHaveLength(3);
    expect(m.flows[0]).toMatchObject({
      to: { prefix: "Billing", name: "Invoices" },
    });
    expect(find(m.now, "Billing: Payments").hot).toBe(true);
  });

  it("draws a rename as the same threads under a new name", () => {
    const m = miniature(
      input({
        delta: delta({ op: "rename", topic: "docs", name: "Guides" }),
      }),
    )!;
    expect(m.flows).toHaveLength(1);
    expect(m.flows[0]).toMatchObject({
      to: { name: "Guides" },
      threads: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
    });
    expect(find(m.after, "Guides").hot).toBe(true);
    expect(find(m.after, "Infra").hot).toBe(false);
  });

  it("draws a move under a new parent as the prefix of its name", () => {
    const m = miniature(
      input({
        delta: delta({ op: "reparent", topic: "docs", parent: "billing" }),
      }),
    )!;
    expect(find(m.after, "Billing: Docs").prefix).toBe("Billing");
    expect(m.flows[0]!.to).toEqual({ prefix: "Billing", name: "Docs" });
  });

  it("draws a change that moves no visible thread with no flows", () => {
    const m = miniature(
      input({
        delta: delta({
          op: "create",
          name: "Ops",
          description: "",
          parent: null,
          children: [],
        }),
      }),
    )!;
    expect(m.flows).toEqual([]);
    expect(labels(m.after)).toEqual(labels(m.now));
  });

  it("applies the user's sort to both sides", () => {
    const base = input({
      delta: delta({ op: "move", thread: "f1", topic: "docs" }),
    });
    const alphabetical = miniature(base)!;
    expect(labels(alphabetical.now)).toEqual([
      "Billing: Invoices",
      "Billing: Payments",
      "Docs",
      "Infra",
      "Unfiled",
    ]);
    const activity = miniature({ ...base, sort: "activity" })!;
    // Most recent first: invoices (1 day), payments, docs, infra.
    expect(labels(activity.now)).toEqual([
      "Billing: Invoices",
      "Billing: Payments",
      "Docs",
      "Infra",
      "Unfiled",
    ]);
    const manual = miniature({
      ...base,
      sort: "manual",
      manualOrder: ["sec_infra", "sec_docs", "sec_payments", "sec_invoices"],
    })!;
    expect(labels(manual.now)).toEqual([
      "Infra",
      "Docs",
      "Billing: Payments",
      "Billing: Invoices",
      "Unfiled",
    ]);
  });

  it("puts a new workstream beside its parent under manual order, in the after state only", () => {
    const base = input({
      sort: "manual",
      manualOrder: ["sec_docs", "sec_infra", "sec_invoices", "sec_payments"],
      delta: delta({
        topicId: "docs",
        subgroups: [
          { name: "Guides", description: "", threadIds: ["d1", "d2"] },
          { name: "Reference", description: "", threadIds: ["d3"] },
        ],
      }),
    });
    const m = miniature(base)!;
    expect(labels(m.now)).toEqual([
      "Docs",
      "Infra",
      "Billing: Invoices",
      "Billing: Payments",
      "Unfiled",
    ]);
    expect(labels(m.after)).toEqual([
      "Docs: Guides",
      "Docs: Reference",
      "Infra",
      "Billing: Invoices",
      "Billing: Payments",
      "Unfiled",
    ]);
  });

  it("caps a large workstream's ticks and keeps each flow's real share", () => {
    const many = Array.from({ length: 300 }, (_, i) => `m${i}`);
    const big = input();
    const withMany = input({
      threads: [
        ...big.threads,
        ...many.map((id, i) => ({
          id,
          title: `Thread ${i}`,
          sectionId: "sec_docs",
          activeAt: NOW - i,
        })),
      ],
      filing: {
        ...big.filing,
        ...Object.fromEntries(many.map((id) => [id, "docs"])),
      },
    });
    const ctx = {
      ...context(),
      threadTopic: { ...context().threadTopic, ...withMany.filing },
    };
    const m = miniature({
      ...withMany,
      delta: changeDelta(
        {
          topicId: "docs",
          subgroups: [
            {
              name: "Small",
              description: "",
              threadIds: many.slice(0, 30),
            },
            {
              name: "Large",
              description: "",
              threadIds: [...many.slice(30), "d1", "d2", "d3"],
            },
          ],
        },
        ctx,
      )!,
    })!;
    const docs = find(m.now, "Docs");
    expect(docs.ticks.length).toBeLessThanOrEqual(TICK_CAP + 1);
    expect(docs.ticks.reduce((n, t) => n + t.threads, 0)).toBe(303);
    const share = (flow: number) =>
      docs.ticks
        .filter((t) => t.flow === flow)
        .reduce((n, t) => n + t.threads, 0);
    // Flows run in the order of their destinations: Large, then Small.
    expect(share(0)).toBe(273);
    expect(share(1)).toBe(30);
    // Thickness follows the share: far more ticks to the large flow.
    expect(docs.ticks.filter((t) => t.flow === 0).length).toBeGreaterThan(
      docs.ticks.filter((t) => t.flow === 1).length * 5,
    );
    // Exact counts are only in the flows' thread lists.
    expect(m.flows.map((f) => f.threads.length)).toEqual([273, 30]);
  });

  it("is null when the changed sidebar cannot be laid out", () => {
    expect(
      miniature(
        input({
          delta: {
            topics: [
              { id: newTopicId("docs", "Sub"), name: "Sub", parentId: "docs" },
            ],
            removed: [],
            assignments: [],
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("miniatureBase", () => {
  const row = (id: string, depth: number, title: string | null = id) => ({
    depth,
    thread: { id, title, latestAttentionAt: 5 },
  });
  const sidebar = (
    catalog: Parameters<typeof miniatureBase>[0]["catalog"],
  ) => ({
    projection: {
      all: [
        { id: "sec_docs", rows: [row("d1", 0, "Quick start"), row("d2", 1)] },
        { id: "sec_empty", rows: [] },
      ],
      unsorted: { id: "unsorted", rows: [row("u1", 0, null)] },
    },
    catalog,
    sort: "activity" as const,
    manualOrder: ["sec_docs"],
    sections: [{ id: "sec_docs" }],
    now: 9,
  });

  it("takes the root threads of every group, with each one's topic", () => {
    const base = miniatureBase(
      sidebar({
        entities: topics,
        groups: { sec_docs: "docs" },
        assignments: { d1: { entityId: "docs" } },
      }),
    )!;
    expect(base.threads).toEqual([
      { id: "d1", title: "Quick start", sectionId: "sec_docs", activeAt: 5 },
      { id: "u1", title: "Untitled thread", sectionId: null, activeAt: 5 },
    ]);
    expect(base.filing).toEqual({ d1: "docs", u1: null });
    expect(base).toMatchObject({
      sort: "activity",
      manualOrder: ["sec_docs"],
      sections: ["sec_docs"],
      now: 9,
    });
  });

  it("is null until the topics have been read", () => {
    expect(miniatureBase(sidebar(undefined))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  categoryAction,
  categoryCollectionKey,
  categoryPrompt,
  categorySchema,
  parseCategories,
  pruneCategories,
  type CategoryInput,
} from "../../src/domain/categories.ts";

const input = (): CategoryInput => ({
  topicId: "workstreams",
  label: "bb: Workstreams Plugin",
  roots: Array.from({ length: 6 }, (_, i) => ({
    id: `thread-${i}`,
    title: `Work ${i}`,
    work: `Purpose ${i}`,
    workKey: `request-${i}`,
  })),
  current: null,
});
const arrangement = () => ({
  keep: false,
  reason: "Separates sidebar behavior from agent replies.",
  categories: [
    { id: null, name: "Sidebar", threadIds: ["r1", "r2", "r3"] },
    { id: null, name: "Agent replies", threadIds: ["r4", "r5", "r6"] },
  ],
});
const generation = () => ({
  id: "generation-a",
  categories: [
    {
      id: "sidebar",
      name: "Sidebar",
      threadIds: ["thread-0", "thread-1", "thread-2"],
    },
    {
      id: "replies",
      name: "Agent replies",
      threadIds: ["thread-3", "thread-4", "thread-5"],
    },
  ],
});

describe("category lifecycle", () => {
  it.each([0, 1, 2, 3])("discards a generation at %i roots", (n) => {
    expect(categoryAction(generation(), n)).toBe("discard");
  });
  it.each([4, 5])("preserves hysteresis at %i roots", (n) => {
    expect(categoryAction(null, n)).toBe("none");
    expect(categoryAction(generation(), n)).toBe("classify");
  });
  it.each([6, 7, 100])("creates categories at %i roots", (n) => {
    expect(categoryAction(null, n)).toBe("classify");
  });
  it("fingerprints membership and requests, not status, titles, or order", () => {
    const a = input();
    const b = {
      ...a,
      roots: [...a.roots].reverse().map((root) => ({
        ...root,
        title: "Retitled",
        work: "Paraphrased purpose",
      })),
    };
    expect(categoryCollectionKey(a)).toBe(categoryCollectionKey(b));
    b.roots[0]!.workKey = "new substantive request";
    expect(categoryCollectionKey(a)).not.toBe(categoryCollectionKey(b));
    expect(categoryCollectionKey({ ...a, roots: a.roots.slice(1) })).not.toBe(
      categoryCollectionKey(a),
    );
  });
  it("removes departed roots and empty categories without mutating the snapshot", () => {
    const before = generation();
    const after = pruneCategories(before, input().roots.slice(0, 2));
    expect(after).toEqual({
      id: before.id,
      categories: [
        { ...before.categories[0], threadIds: ["thread-0", "thread-1"] },
      ],
    });
    expect(before.categories).toHaveLength(2);
  });
});

describe("category classifier contract", () => {
  it("uses explicit nullable category schemas accepted by the Organization model", () => {
    expect(categorySchema(input())).toMatchObject({
      properties: {
        categories: { items: { properties: { id: { type: "null" } } } },
      },
    });
    expect(categorySchema({ ...input(), current: generation() })).toMatchObject(
      {
        properties: {
          categories: {
            items: {
              properties: {
                id: {
                  anyOf: [
                    { type: "null" },
                    { type: "string", enum: ["c1", "c2"] },
                  ],
                },
              },
            },
          },
        },
      },
    );
  });
  it("maps short prompt IDs back to actual roots", () => {
    expect(
      parseCategories(JSON.stringify(arrangement()), input()).categories[0]!
        .threadIds,
    ).toEqual(["thread-0", "thread-1", "thread-2"]);
  });
  it("can retain a complete existing arrangement", () => {
    expect(
      parseCategories(
        JSON.stringify({
          keep: true,
          reason: "These distinctions still fit.",
          categories: [],
        }),
        { ...input(), current: generation() },
      ).keep,
    ).toBe(true);
  });
  it("can retain one remaining category after departures", () => {
    const collection = input();
    const current = {
      id: "g",
      categories: [
        {
          id: "a",
          name: "Sidebar",
          threadIds: collection.roots.map((root) => root.id),
        },
      ],
    };
    expect(
      parseCategories(
        JSON.stringify({
          keep: true,
          reason: "The remaining work is coherent.",
          categories: [],
        }),
        { ...collection, current },
      ).keep,
    ).toBe(true);
  });
  it("cannot keep an arrangement that omits an arrival", () => {
    const current = generation();
    current.categories[0]!.threadIds.shift();
    expect(() =>
      parseCategories(
        JSON.stringify({ keep: true, reason: "Keep", categories: [] }),
        { ...input(), current },
      ),
    ).toThrow("cover");
  });
  it("cannot claim to keep categories before their creation", () => {
    expect(() =>
      parseCategories(
        JSON.stringify({ keep: true, reason: "Keep", categories: [] }),
        input(),
      ),
    ).toThrow("cover");
  });
  it("reuses a category's actual ID when its meaning survives", () => {
    const decision = arrangement();
    (decision.categories[0] as { id: string | null }).id = "c1";
    expect(
      parseCategories(JSON.stringify(decision), {
        ...input(),
        current: generation(),
      }).categories[0]!.id,
    ).toBe("sidebar");
  });
  it.each([
    "omission",
    "duplicate",
    "unknown",
    "duplicate name",
    "unknown category",
    "repeated category",
    "empty category",
  ])("rejects %s", (problem) => {
    const decision = arrangement();
    if (problem === "omission") decision.categories[0]!.threadIds.pop();
    if (problem === "duplicate") decision.categories[0]!.threadIds[0] = "r4";
    if (problem === "unknown")
      decision.categories[0]!.threadIds[0] = "not-a-root";
    if (problem === "duplicate name") decision.categories[1]!.name = "sidebar";
    if (problem === "unknown category")
      (decision.categories[0] as { id: string | null }).id = "missing";
    if (problem === "repeated category")
      for (const category of decision.categories)
        (category as { id: string | null }).id = "c1";
    if (problem === "empty category") decision.categories[0]!.threadIds = [];
    expect(() =>
      parseCategories(JSON.stringify(decision), {
        ...input(),
        current: generation(),
      }),
    ).toThrow();
  });
  it("requires a real division at creation but permits a live generation to contract", () => {
    const answer = {
      keep: false,
      reason: "The remaining work is one coherent area.",
      categories: [
        {
          id: null,
          name: "Sidebar",
          threadIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
        },
      ],
    };
    expect(() => parseCategories(JSON.stringify(answer), input())).toThrow(
      "at least two",
    );
    expect(
      parseCategories(JSON.stringify(answer), {
        ...input(),
        current: generation(),
      }).categories,
    ).toHaveLength(1);
  });
  it("gives the whole collection and current arrangement to the classifier", () => {
    const prompt = categoryPrompt({ ...input(), current: generation() });
    expect(prompt).toContain("[r6] Work 5");
    expect(prompt).toContain("[c1] Sidebar: r1, r2, r3");
    expect(prompt).toContain(
      "Minor or superficial improvements do not justify changes",
    );
  });
});

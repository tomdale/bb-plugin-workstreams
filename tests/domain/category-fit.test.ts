import { describe, expect, it } from "vitest";
import {
  applyCategoryFit,
  categoryFitPrompt,
  categoryFitSchema,
  mostlySingletons,
  parseCategoryFit,
  type CategoryFitInput,
} from "../../src/domain/categories.ts";

const root = (id: string, title: string) => ({
  id,
  title,
  work: `Work on ${title}`,
  workKey: "k",
});

const input: CategoryFitInput = {
  topicId: "harbor",
  label: "Harbor",
  roots: [
    root("a", "Invoice rounding"),
    root("b", "Annual plans"),
    root("c", "Role checks"),
    root("d", "Membership audit"),
    root("e", "Invoice PDF totals"),
  ],
  current: {
    id: "g",
    categories: [
      { id: "billing", name: "Billing", threadIds: ["a", "b"] },
      { id: "access", name: "Access", threadIds: ["c", "d"] },
    ],
  },
  changed: ["a", "e"],
};

describe("category fit check", () => {
  it("shows the staying members and only the changed threads' work", () => {
    const prompt = categoryFitPrompt(input);
    expect(prompt).toContain("[c1] Billing: Annual plans");
    expect(prompt).toContain("Work on Invoice PDF totals");
    expect(prompt).not.toContain("Work on Role checks");
    expect(
      (categoryFitSchema(input) as { properties: object }).properties,
    ).toHaveProperty("threads");
  });

  it("files every changed thread where the check put it", () => {
    const fit = parseCategoryFit(
      JSON.stringify({
        threads: [
          { thread: "r1", category: "c2" },
          { thread: "r5", category: "c1" },
        ],
      }),
      input,
    );
    expect(fit).toEqual({ a: "access", e: "billing" });
    expect(applyCategoryFit(input, fit)?.categories).toEqual([
      { id: "billing", name: "Billing", threadIds: ["b", "e"] },
      { id: "access", name: "Access", threadIds: ["a", "c", "d"] },
    ]);
  });

  it("rearranges when any thread fits nowhere or is left out", () => {
    expect(applyCategoryFit(input, { a: "billing", e: null })).toBeNull();
    expect(applyCategoryFit(input, { a: "billing" })).toBeNull();
    expect(() =>
      parseCategoryFit(
        JSON.stringify({ threads: [{ thread: "r1", category: "c1" }] }),
        input,
      ),
    ).toThrow(/left a thread out/);
    expect(() =>
      parseCategoryFit(
        JSON.stringify({
          threads: [
            { thread: "r1", category: "c9" },
            { thread: "r5", category: "c1" },
          ],
        }),
        input,
      ),
    ).toThrow(/unknown category/);
  });

  it("sends an arrangement of mostly singletons to a rearrangement", () => {
    expect(mostlySingletons(input.current)).toBe(false);
    expect(
      mostlySingletons({
        id: "g",
        categories: [
          { id: "x", name: "X", threadIds: ["a"] },
          { id: "y", name: "Y", threadIds: ["b"] },
          { id: "z", name: "Z", threadIds: ["c", "d"] },
        ],
      }),
    ).toBe(true);
  });
});

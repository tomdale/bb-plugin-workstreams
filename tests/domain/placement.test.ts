import { describe, expect, it } from "vitest";
import {
  parsePlacement,
  placementIds,
  placementPrompt,
  placementSchema,
  type PlacementInput,
} from "../../src/domain/placement.ts";
import {
  placementRequests,
  pointsElsewhere,
} from "../../src/server/placement.ts";

const topic = (
  id: string,
  name: string,
  parentId: string | null,
  description = "",
) => ({ id, name, description, parentId, aliases: [] as string[] });

const entities = [
  topic("vercel", "Vercel", null),
  topic("auto", "Automations", "vercel", "The Automations product"),
  topic("planning", "Planning", "auto", "Design and rollout"),
  topic("triggers", "Triggers", "auto", "Events that start runs"),
  topic("review", "Code Review", "vercel"),
];

const input: PlacementInput = {
  title: "Design the CLI commands",
  requests: ["Design CLI commands for automations"],
  project: "vercel/api",
  checkout: "/Users/me/Code/Repos/api/main",
  entities,
  counts: { planning: 2, triggers: 1 },
  hints: ["It continues a thread filed under Vercel: Automations: Planning."],
  current: null,
};

describe("placementPrompt", () => {
  it("lists topics by name slug, marking the ones that can't hold threads", () => {
    const ids = placementIds(entities);
    expect([...ids.entries()]).toEqual([
      ["vercel", "vercel"],
      ["auto", "automations"],
      ["planning", "planning"],
      ["triggers", "triggers"],
      ["review", "code-review"],
    ]);
    const prompt = placementPrompt(input);
    expect(prompt).toContain("- [vercel] Vercel (has subtopics)");
    expect(prompt).toContain(
      "    - [planning] Planning — Design and rollout (2 threads)",
    );
    expect(prompt).toContain("  - [code-review] Code Review (0 threads)");
    expect(prompt).toContain(
      "<hint>\nIt continues a thread filed under Vercel: Automations: Planning.\n</hint>",
    );
    expect(prompt).toContain(
      "<checkout>\n/Users/me/Code/Repos/api/main\n</checkout>",
    );
    expect(prompt).not.toContain("current_topic");
  });

  it("tells topics with the same name apart by their parents", () => {
    const ids = placementIds([
      topic("a", "Alpha", null),
      topic("b", "Beta", null),
      topic("as", "Sidebar", "a"),
      topic("bs", "Sidebar", "b"),
    ]);
    expect([...ids.values()]).toEqual([
      "alpha",
      "sidebar",
      "beta",
      "beta-sidebar",
    ]);
  });

  it("constrains the answer to topics that hold threads", () => {
    const schema = placementSchema(input) as {
      properties: {
        topic: { enum: unknown[] };
        propose: { anyOf: { properties?: { parent: { enum: unknown[] } } }[] };
      };
    };
    expect(schema.properties.topic.enum).toEqual([
      null,
      "planning",
      "triggers",
      "code-review",
    ]);
    expect(schema.properties.propose.anyOf[1]!.properties!.parent.enum).toEqual(
      [null, "vercel", "automations", "planning", "triggers", "code-review"],
    );
  });
});

describe("parsePlacement", () => {
  const parse = (answer: object) =>
    parsePlacement(JSON.stringify(answer), input);

  it("maps a slug back to its topic", () => {
    expect(
      parse({ topic: "planning", propose: null, scopeShift: false }),
    ).toEqual({
      subjectId: "planning",
      proposed: null,
      scopeShift: false,
    });
  });

  it("refuses a topic with subtopics, or one it wasn't shown", () => {
    expect(() => parse({ topic: "automations", propose: null })).toThrow();
    expect(() => parse({ topic: "billing", propose: null })).toThrow();
  });

  it("anchors a proposal and resolves one that names an existing topic", () => {
    expect(
      parse({
        topic: null,
        propose: {
          name: "CLI",
          description: "Commands",
          parent: "automations",
        },
      }),
    ).toEqual({
      subjectId: null,
      proposed: {
        name: "CLI",
        description: "Commands",
        parentId: "auto",
      },
      scopeShift: false,
    });
    expect(
      parse({
        topic: null,
        propose: { name: "triggers", description: "", parent: "automations" },
      }).subjectId,
    ).toBe("triggers");
    expect(() =>
      parse({
        topic: null,
        propose: { name: "A: B", description: "", parent: null },
      }),
    ).toThrow();
  });

  it("reads both fields null as no topic", () => {
    expect(parse({ topic: null, propose: null })).toEqual({
      subjectId: null,
      proposed: null,
      scopeShift: false,
    });
  });
});

describe("placement within a user-chosen group", () => {
  const scoped = {
    ...input,
    within: "auto",
    current: { label: "Vercel: Code Review", inherited: false },
  };
  it("limits structured output to existing leaves inside the destination", () => {
    const schema = placementSchema(scoped) as {
      properties: { topic: { enum: string[] }; propose: { type: string } };
    };
    expect(schema.properties.topic.enum).toEqual(["planning", "triggers"]);
    expect(schema.properties.propose).toEqual({ type: "null" });
    expect(placementPrompt(scoped)).toContain(
      "The user moved this thread into Vercel: Automations",
    );
    expect(
      parsePlacement('{"topic":"planning","propose":null}', scoped).subjectId,
    ).toBe("planning");
  });
  it.each([
    { topic: "code-review", propose: null },
    { topic: "automations", propose: null },
    { topic: null, propose: null },
    {
      topic: null,
      propose: { name: "CLI", description: "", parent: "automations" },
    },
    {
      topic: "planning",
      propose: { name: "CLI", description: "", parent: "automations" },
    },
  ])("rejects an answer outside the chosen existing leaves: %j", (answer) => {
    expect(() => parsePlacement(JSON.stringify(answer), scoped)).toThrow();
  });
  it("rejects an unknown destination", () => {
    expect(() => placementSchema({ ...scoped, within: "missing" })).toThrow();
    expect(() =>
      parsePlacement('{"topic":"planning"}', { ...scoped, within: "missing" }),
    ).toThrow();
  });
});

describe("placement evidence", () => {
  it("keeps the first, second, and latest substantive requests, unwrapped", () => {
    expect(
      placementRequests([
        "[bb message from thread:thr_1] Fix the cache",
        "continue",
        "Also the CLI",
        "ok",
        "Ship it",
      ]),
    ).toEqual(["Fix the cache", "Also the CLI", "Ship it"]);
    expect(placementRequests(["Only one", "yes"])).toEqual(["Only one"]);
  });

  it("tells requests that point at another repository", () => {
    const checkout = "/Users/me/Code/Repos/toolbelt/main";
    expect(
      pointsElsewhere(
        "See https://github.com/tomdale/toolbelt/pull/4",
        checkout,
      ),
    ).toBe(false);
    expect(
      pointsElsewhere("Review https://github.com/vercel/api/pull/9", checkout),
    ).toBe(true);
    expect(
      pointsElsewhere("Edit ~/Code/Repos/toolbelt/main/x.ts", checkout),
    ).toBe(false);
    expect(pointsElsewhere("Open ~/Code/Repos/bb/main/app.ts", checkout)).toBe(
      true,
    );
  });
});

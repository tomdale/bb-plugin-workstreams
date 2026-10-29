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
  it("lists topics by short ID, marking the ones that can't hold threads", () => {
    const ids = placementIds(entities);
    expect([...ids.entries()]).toEqual([
      ["vercel", "t1"],
      ["auto", "t2"],
      ["planning", "t3"],
      ["triggers", "t4"],
      ["review", "t5"],
    ]);
    const prompt = placementPrompt(input);
    expect(prompt).toContain("- [t1] Vercel (has subtopics)");
    expect(prompt).toContain(
      "    - [t3] Planning — Design and rollout (2 threads)",
    );
    expect(prompt).toContain("  - [t5] Code Review (0 threads)");
    expect(prompt).toContain(
      "<hint>\nIt continues a thread filed under Vercel: Automations: Planning.\n</hint>",
    );
    expect(prompt).toContain(
      "<checkout>\n/Users/me/Code/Repos/api/main\n</checkout>",
    );
    expect(prompt).not.toContain("current_topic");
  });

  it("constrains the answer to topics that hold threads", () => {
    const schema = placementSchema(input) as {
      properties: {
        topic: { enum: unknown[] };
        propose: { anyOf: { properties?: { parent: { enum: unknown[] } } }[] };
      };
    };
    expect(schema.properties.topic.enum).toEqual([null, "t3", "t4", "t5"]);
    expect(schema.properties.propose.anyOf[1]!.properties!.parent.enum).toEqual(
      [null, "t1", "t2", "t3", "t4", "t5"],
    );
  });
});

describe("parsePlacement", () => {
  const parse = (answer: object) =>
    parsePlacement(JSON.stringify(answer), input);

  it("maps a short ID back to its topic", () => {
    expect(parse({ topic: "t3", propose: null, scopeShift: false })).toEqual({
      subjectId: "planning",
      proposed: null,
      scopeShift: false,
    });
  });

  it("refuses a topic with subtopics, or one it wasn't shown", () => {
    expect(() => parse({ topic: "t2", propose: null })).toThrow();
    expect(() => parse({ topic: "t9", propose: null })).toThrow();
  });

  it("anchors a proposal and resolves one that names an existing topic", () => {
    expect(
      parse({
        topic: null,
        propose: { name: "CLI", description: "Commands", parent: "t2" },
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
        propose: { name: "triggers", description: "", parent: "t2" },
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

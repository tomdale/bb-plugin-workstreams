import { describe, expect, it } from "vitest";
import {
  parseTidy,
  tidyPrompt,
  tidySchema,
  type TidyInput,
} from "../../src/domain/tidy.ts";

const topic = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  description: null,
  aliases: [],
});

const input: TidyInput = {
  topics: [
    topic("beacon", "Beacon"),
    topic("auto", "Automations", "beacon"),
    topic("review", "Beacon Code Review"),
  ],
  held: { auto: 2, review: 2 },
  threads: [],
  coordination: [],
  decisions: [],
  declined: [],
};

const edit = (fields: Record<string, unknown>) => ({
  op: "reparent",
  from: null,
  into: null,
  topic: "beacon-code-review",
  parent: "beacon",
  name: null,
  description: null,
  children: null,
  thread: null,
  reason: "It's part of Beacon.",
  ...fields,
});

const parse = (...edits: Record<string, unknown>[]) =>
  parseTidy(JSON.stringify({ edits: edits.map(edit) }), input);

describe("parseTidy", () => {
  it("reads a move that renames the topic", () => {
    expect(parse({ name: "Code Review" })).toEqual([
      {
        edit: {
          op: "reparent",
          topic: "review",
          parent: "beacon",
          name: "Code Review",
        },
        reason: "It's part of Beacon.",
      },
    ]);
  });

  it("drops a rename to the name the topic has, or an invalid one", () => {
    for (const name of ["Beacon Code Review", "beacon code review", "A: B"])
      expect(parse({ name })[0]!.edit).toEqual({
        op: "reparent",
        topic: "review",
        parent: "beacon",
      });
  });

  it("cuts a reason off where the model writes past it", () => {
    expect(
      parse({
        reason: `It's part of Beacon.}]}</br>I need to correct this`,
      })[0]!.reason,
    ).toBe("It's part of Beacon.");
    expect(parse({ reason: "It's part of Beacon.','" })[0]!.reason).toBe(
      "It's part of Beacon.",
    );
  });
});

describe("tidyPrompt", () => {
  it("asks for the edit before its reason", () => {
    const schema = tidySchema() as {
      properties: { edits: { items: { properties: object } } };
    };
    expect(Object.keys(schema.properties.edits.items.properties).at(-1)).toBe(
      "reason",
    );
    expect(tidyPrompt(input)).toContain(
      '"Beacon Code Review" under "Beacon" becomes "Code Review"',
    );
  });
});

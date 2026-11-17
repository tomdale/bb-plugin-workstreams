import { describe, expect, it } from "vitest";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../../src/domain/turnEnd.ts";
import type { WorkstreamChoiceInput } from "../../src/domain/workstreamChoice.ts";

const workstream = (id: string, name: string, parentId: string | null) => ({
  id,
  name,
  description: "",
  parentId,
  aliases: [] as string[],
});

const choice: WorkstreamChoiceInput = {
  title: null,
  requests: ["Add themes to the viewer"],
  project: "atlas",
  checkout: null,
  workstreams: [
    workstream("atlas", "Atlas", null),
    workstream("billing", "Billing", "atlas"),
    workstream("viewer", "Viewer", "atlas"),
  ],
  hints: [],
  current: { label: "Atlas › Billing", inherited: false },
  digest: "A digest placement must not repeat.",
};

const input: TurnEndInput = {
  title: "New thread",
  titledBy: "none",
  goal: null,
  digest: "Atlas viewer work; themes requested.",
  requests: [{ text: "Add themes to the viewer", initial: true }],
  lastAssistantText: "Added a theme picker.",
  report: null,
  mode: "full",
  listing: { workstream: "Atlas › Billing", parent: null },
  choice,
};

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({
    recap: "Added a theme picker.",
    state: "review",
    ask: null,
    goal: "Let readers pick a viewer theme.",
    digest: "Atlas viewer themes.",
    title: { verb: "Adding", subject: "Atlas viewer themes" },
    workstream: "viewer",
    propose: null,
    scopeShift: false,
    ...fields,
  });

describe("turn-end call", () => {
  it("asks for the workstream beside the description only when the workstream choice is supplied", () => {
    const prompt = turnEndPrompt(input);
    expect(prompt).toContain("decide which workstream it belongs in now");
    expect(prompt).toContain("[viewer] Viewer");
    expect(prompt).toContain("<current_workstream>");
    // The digest appears once, as the call's own memory.
    expect(prompt).not.toContain("A digest placement must not repeat.");
    expect(prompt.match(/<thread_digest>/g)).toHaveLength(1);
    expect(Object.keys(turnEndSchema(input).properties as object)).toEqual(
      expect.arrayContaining([
        "recap",
        "digest",
        "title",
        "workstream",
        "propose",
      ]),
    );

    const alone = { ...input, choice: null };
    expect(turnEndPrompt(alone)).not.toContain("workstream_tree");
    expect(turnEndSchema(alone).properties).not.toHaveProperty("workstream");
  });

  it("titles the thread beside the workstream it chose", () => {
    const output = parseTurnEnd(answer({}), input);
    expect(output.workstream).toEqual({
      workstreamId: "viewer",
      proposed: null,
      scopeShift: false,
    });
    expect(output.title).toBe("Adding viewer themes");
    expect(output.status?.state).toBe("review");
  });

  it("refuses an invalid workstream without losing the description", () => {
    const output = parseTurnEnd(answer({ workstream: "atlas" }), input);
    expect(output.workstream).toBeNull();
    expect(output.workstreamError).toMatch(/Invalid workstream/);
    expect(output.status?.recap).toBe("Added a theme picker.");
    expect(output.goal).toBe("Let readers pick a viewer theme.");
  });
});

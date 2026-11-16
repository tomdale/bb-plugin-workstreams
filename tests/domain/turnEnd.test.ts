import { describe, expect, it } from "vitest";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../../src/domain/turnEnd.ts";
import type { PlacementInput } from "../../src/domain/placement.ts";

const topic = (id: string, name: string, parentId: string | null) => ({
  id,
  name,
  description: "",
  parentId,
  aliases: [] as string[],
});

const placement: PlacementInput = {
  title: null,
  requests: ["Add themes to the viewer"],
  project: "atlas",
  checkout: null,
  entities: [
    topic("atlas", "Atlas", null),
    topic("billing", "Billing", "atlas"),
    topic("viewer", "Viewer", "atlas"),
  ],
  hints: [],
  current: { label: "Atlas: Billing", inherited: false },
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
  listing: { group: "Atlas: Billing", parent: null },
  placement,
};

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({
    recap: "Added a theme picker.",
    state: "review",
    ask: null,
    goal: "Let readers pick a viewer theme.",
    digest: "Atlas viewer themes.",
    title: { verb: "Adding", subject: "Atlas viewer themes" },
    topic: "viewer",
    propose: null,
    scopeShift: false,
    ...fields,
  });

describe("turn-end call", () => {
  it("asks for the topic beside the description only when placement is supplied", () => {
    const prompt = turnEndPrompt(input);
    expect(prompt).toContain("decide which topic it belongs under now");
    expect(prompt).toContain("[viewer] Viewer");
    expect(prompt).toContain("<current_topic>");
    // The digest appears once, as the call's own memory.
    expect(prompt).not.toContain("A digest placement must not repeat.");
    expect(prompt.match(/<thread_digest>/g)).toHaveLength(1);
    expect(Object.keys(turnEndSchema(input).properties as object)).toEqual(
      expect.arrayContaining(["recap", "digest", "title", "topic", "propose"]),
    );

    const alone = { ...input, placement: null };
    expect(turnEndPrompt(alone)).not.toContain("topic_tree");
    expect(turnEndSchema(alone).properties).not.toHaveProperty("topic");
  });

  it("titles the thread beside the topic it chose", () => {
    const output = parseTurnEnd(answer({}), input);
    expect(output.topic).toEqual({
      subjectId: "viewer",
      proposed: null,
      scopeShift: false,
    });
    expect(output.title).toBe("Adding viewer themes");
    expect(output.status?.state).toBe("review");
  });

  it("refuses an invalid topic without losing the description", () => {
    const output = parseTurnEnd(answer({ topic: "atlas" }), input);
    expect(output.topic).toBeNull();
    expect(output.topicError).toMatch(/Invalid topic/);
    expect(output.status?.recap).toBe("Added a theme picker.");
    expect(output.goal).toBe("Let readers pick a viewer theme.");
  });
});

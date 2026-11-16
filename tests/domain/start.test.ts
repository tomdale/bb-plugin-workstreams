import { describe, expect, it } from "vitest";
import {
  parseStart,
  startPrompt,
  startSchema,
  type StartInput,
} from "../../src/domain/start.ts";

const topic = (id: string, name: string, parentId: string | null) => ({
  id,
  name,
  description: "",
  parentId,
  aliases: [] as string[],
});

const root: StartInput = {
  request: "Fix the Atlas invoice export timeouts",
  project: "atlas",
  placement: {
    entities: [
      topic("atlas", "Atlas", null),
      topic("billing", "Billing", "atlas"),
      topic("viewer", "Viewer", "atlas"),
    ],
    project: "atlas",
    checkout: null,
    hints: ["It was started from the Atlas workstream."],
    current: null,
  },
};

describe("start call", () => {
  it("names a root and files it with placement's rules", () => {
    const prompt = startPrompt(root);
    expect(prompt).toContain("and file it under a topic");
    expect(prompt).toContain("[billing] Billing");
    expect(prompt).toContain("<hint>");
    // The opening request is the evidence once, not again as a requests block.
    expect(prompt.match(/<opening_request>/g)).toHaveLength(1);
    expect(Object.keys(startSchema(root).properties as object)).toEqual([
      "title",
      "topic",
      "propose",
      "scopeShift",
    ]);
    const output = parseStart(
      JSON.stringify({
        title: { verb: "Fixing", subject: "Atlas Billing export timeouts" },
        topic: "billing",
        propose: null,
        scopeShift: false,
      }),
      root,
    );
    expect(output.topic?.subjectId).toBe("billing");
    // The title drops the names of the topic the same answer chose.
    expect(output.title).toBe("Fixing export timeouts");
  });

  it("only names a child thread", () => {
    const child: StartInput = {
      request: "Review Phase 3",
      project: null,
      placement: null,
      listing: { group: "Orion", parent: "Building Orion sync" },
    };
    expect(startPrompt(child)).not.toContain("topic_tree");
    expect(startPrompt(child)).toContain("<parent_thread>");
    expect(Object.keys(startSchema(child).properties as object)).toEqual([
      "title",
    ]);
    expect(
      parseStart(
        JSON.stringify({ title: { verb: "Reviewing", subject: "Phase 3" } }),
        child,
      ),
    ).toEqual({ title: "Reviewing Phase 3", topic: null });
  });

  it("refuses a topic that can't hold threads and keeps the title", () => {
    const output = parseStart(
      JSON.stringify({
        title: { verb: "Fixing", subject: "export timeouts" },
        topic: "atlas",
        propose: null,
      }),
      root,
    );
    expect(output.topic).toBeNull();
    expect(output.topicError).toMatch(/Invalid topic/);
    expect(output.title).toBe("Fixing export timeouts");
  });
});

import { describe, expect, it } from "vitest";
import { mootEdit, refusal, type TreeState } from "../../src/domain/tidy.ts";

const state: TreeState = {
  topics: [
    { id: "bb", name: "bb", parentId: null },
    { id: "todo", name: "Todo", parentId: "bb" },
    { id: "cli", name: "Cli", parentId: null },
  ],
  held: { todo: 1 },
  threadTopic: { t1: "todo" },
};

describe("mootEdit", () => {
  it("names edits that would change nothing: gone or already done", () => {
    expect(mootEdit({ op: "move", thread: "gone", topic: "cli" }, state)).toBe(
      "That thread is gone.",
    );
    expect(mootEdit({ op: "move", thread: "t1", topic: "todo" }, state)).toBe(
      "The thread is already there.",
    );
    expect(
      mootEdit({ op: "reparent", topic: "todo", parent: "bb" }, state),
    ).toBe("The topic is already there.");
    expect(mootEdit({ op: "rename", topic: "cli", name: "Cli" }, state)).toBe(
      "It already has that name.",
    );
    expect(mootEdit({ op: "merge", from: "gone", into: "cli" }, state)).toBe(
      "A topic it names is gone.",
    );
    const create = { op: "create" as const, name: "X", description: "" };
    expect(
      mootEdit({ ...create, parent: null, children: ["gone"] }, state),
    ).toBe("The topics it would hold are gone.");
    // One child left still makes a parent worth creating.
    expect(
      mootEdit({ ...create, parent: null, children: ["gone", "cli"] }, state),
    ).toBeNull();
    expect(
      refusal({ ...create, parent: null, children: ["gone", "cli"] }, state),
    ).toBe("A topic it names is gone.");
  });

  it("leaves rule breaks, which may pass later, to refusal", () => {
    const edit = { op: "reparent" as const, topic: "cli", parent: "todo" };
    expect(mootEdit(edit, state)).toBeNull();
    expect(refusal(edit, state)).toBe(
      "The new parent holds threads, so it can't take subtopics.",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  mootEdit,
  prefixMoves,
  refusal,
  type TreeState,
} from "../../src/domain/tidy.ts";

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
    expect(refusal(edit, state)).toBe("Topic identity has at most two levels.");
  });
});

describe("prefixMoves", () => {
  const tree = (
    topics: TreeState["topics"],
    held: TreeState["held"] = {},
  ): TreeState => ({ topics, held, threadTopic: {} });

  it("moves a top-level topic under the topic its name begins with", () => {
    const moves = prefixMoves(
      tree([
        { id: "va", name: "Vercel Agent", parentId: null },
        { id: "auto", name: "Automations", parentId: "va" },
        { id: "cr", name: "Vercel Agent Code Review", parentId: null },
        // A topic without subtopics isn't a group to move under.
        { id: "v", name: "Vercel", parentId: null },
      ]),
    );
    expect(moves).toEqual([
      {
        edit: {
          op: "reparent",
          topic: "cr",
          parent: "va",
          name: "Code Review",
        },
        reason:
          "Its name begins with Vercel Agent, so it belongs under that topic.",
      },
    ]);
  });

  it("moves under a matching owner only when the subtree still fits two levels", () => {
    const moves = prefixMoves(
      tree([
        { id: "va", name: "Vercel Agent", parentId: null },
        { id: "auto", name: "Automations", parentId: "va" },
        { id: "v", name: "Vercel", parentId: null },
        { id: "iv", name: "Inside Vercel", parentId: "v" },
        { id: "cr", name: "Vercel Agent Code Review", parentId: null },
      ]),
    );
    expect(moves.map((m) => m.edit)).toEqual([
      { op: "reparent", topic: "cr", parent: "va", name: "Code Review" },
    ]);
  });

  it("matches whole words and leaves nested topics where they are", () => {
    expect(
      prefixMoves(
        tree([
          { id: "bb", name: "bb", parentId: null },
          { id: "fx", name: "bb-plugin-fx-provider", parentId: null },
          { id: "bb-todo", name: "Todo", parentId: "bb" },
          { id: "w", name: "Workstreams", parentId: null },
          { id: "w-ui", name: "UI", parentId: "w" },
          { id: "x", name: "Other", parentId: null },
          { id: "wp", name: "Workstreams Plugin", parentId: "x" },
        ]),
      ),
    ).toEqual([]);
  });

  it("doesn't move a topic under one that holds threads", () => {
    expect(
      prefixMoves(
        tree(
          [
            { id: "w", name: "Workstreams", parentId: null },
            { id: "w-ui", name: "UI", parentId: "w" },
            { id: "wp", name: "Workstreams Plugin", parentId: null },
          ],
          // A legacy topic holding threads beside its subtopics.
          { w: 2 },
        ),
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  mootEdit,
  prefixMoves,
  refusal,
  type TreeState,
} from "../../src/domain/tidy.ts";

const state: TreeState = {
  workstreams: [
    { id: "bb", name: "bb", parentId: null },
    { id: "todo", name: "Todo", parentId: "bb" },
    { id: "cli", name: "Cli", parentId: null },
  ],
  held: { todo: 1 },
  threadWorkstream: { t1: "todo" },
};

describe("mootEdit", () => {
  it("names edits that would change nothing: gone or already done", () => {
    expect(
      mootEdit({ op: "move-thread", thread: "gone", workstream: "cli" }, state),
    ).toBe("That thread is gone.");
    expect(
      mootEdit({ op: "move-thread", thread: "t1", workstream: "todo" }, state),
    ).toBe("The thread is already there.");
    expect(
      mootEdit(
        { op: "move-workstream", workstream: "todo", parent: "bb" },
        state,
      ),
    ).toBe("The workstream is already there.");
    expect(
      mootEdit({ op: "rename", workstream: "cli", name: "Cli" }, state),
    ).toBe("It already has that name.");
    expect(mootEdit({ op: "merge", from: "gone", into: "cli" }, state)).toBe(
      "A workstream it names is gone.",
    );
    const create = { op: "group" as const, name: "X", description: "" };
    expect(
      mootEdit({ ...create, parent: null, children: ["gone"] }, state),
    ).toBe("The workstreams it would hold are gone.");
    // One child left still makes a group worth creating.
    expect(
      mootEdit({ ...create, parent: null, children: ["gone", "cli"] }, state),
    ).toBeNull();
    expect(
      refusal({ ...create, parent: null, children: ["gone", "cli"] }, state),
    ).toBe("A workstream it names is gone.");
  });

  it("leaves rule breaks, which may pass later, to refusal", () => {
    const edit = {
      op: "move-workstream" as const,
      workstream: "cli",
      parent: "todo",
    };
    expect(mootEdit(edit, state)).toBeNull();
    expect(refusal(edit, state)).toBe(
      "Workstreams go at most two levels deep.",
    );
  });
});

describe("prefixMoves", () => {
  const tree = (
    workstreams: TreeState["workstreams"],
    held: TreeState["held"] = {},
  ): TreeState => ({ workstreams, held, threadWorkstream: {} });

  it("moves a top-level workstream under the group its name begins with", () => {
    const moves = prefixMoves(
      tree([
        { id: "va", name: "Vercel Agent", parentId: null },
        { id: "auto", name: "Automations", parentId: "va" },
        { id: "cr", name: "Vercel Agent Code Review", parentId: null },
        // A workstream with no children isn't a group to move under.
        { id: "v", name: "Vercel", parentId: null },
      ]),
    );
    expect(moves).toEqual([
      {
        edit: {
          op: "move-workstream",
          workstream: "cr",
          parent: "va",
          name: "Code Review",
        },
        reason:
          "Its name begins with Vercel Agent, so it belongs in that group.",
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
      {
        op: "move-workstream",
        workstream: "cr",
        parent: "va",
        name: "Code Review",
      },
    ]);
  });

  it("matches whole words and leaves nested workstreams where they are", () => {
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

  it("doesn't move a workstream under one that holds threads", () => {
    expect(
      prefixMoves(
        tree(
          [
            { id: "w", name: "Workstreams", parentId: null },
            { id: "w-ui", name: "UI", parentId: "w" },
            { id: "wp", name: "Workstreams Plugin", parentId: null },
          ],
          // A legacy group holding threads beside its workstreams.
          { w: 2 },
        ),
      ),
    ).toEqual([]);
  });
});

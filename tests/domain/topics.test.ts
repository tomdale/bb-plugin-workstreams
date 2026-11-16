import { describe, expect, it } from "vitest";
import { resolveProposal, type Workstream } from "../../src/domain/topics.ts";

const workstream = (id: string, parentId: string | null = null): Workstream => ({
  id,
  name: id,
  description: "",
  parentId,
  aliases: [],
});

describe("resolveProposal", () => {
  const tree: Workstream[] = [
    { ...workstream("subagents"), name: "Subagents" },
    { ...workstream("bb-plugin", "subagents"), name: "BB Plugin" },
    { ...workstream("workstreams"), name: "Workstreams", aliases: ["WS"] },
    { ...workstream("recaps", "workstreams"), name: "Recap Cards" },
  ];
  const draft = (
    name: string,
    parentId: string | null,
    ancestors: string[] = [],
  ) => ({
    name,
    description: `${name} scope`,
    parentId,
    ancestors: ancestors.map((a) => ({ name: a, description: `${a} scope` })),
  });

  it("drops an ancestor that restates the proposal's existing parent", () => {
    // A classifier's answer for Workforest work: Subagents is both its parent
    // and its first "missing" ancestor.
    expect(
      resolveProposal(draft("Workforest", "subagents", ["Subagents"]), tree),
    ).toEqual({
      workstreamId: null,
      proposed: draft("Workforest", "subagents"),
    });
  });

  it("reuses existing ancestry restated from the root or by alias", () => {
    expect(
      resolveProposal(
        draft("Countdown", "recaps", ["Workstreams", "Recap Cards", "Waiting"]),
        tree,
      ),
    ).toEqual({
      workstreamId: null,
      proposed: draft("Countdown", "recaps", ["Waiting"]),
    });
    expect(
      resolveProposal(draft("Waiting", null, [" ws ", "recap cards"]), tree),
    ).toEqual({ workstreamId: null, proposed: draft("Waiting", "recaps") });
  });

  it("resolves a proposal whose whole path already exists", () => {
    expect(resolveProposal(draft("Subagents", "subagents"), tree)).toEqual({
      workstreamId: "subagents",
      proposed: null,
    });
    expect(
      resolveProposal(draft("BB Plugin", null, ["Subagents"]), tree),
    ).toEqual({ workstreamId: "bb-plugin", proposed: null });
  });

  it("returns a proposal with no existing ancestry unchanged", () => {
    const proposal = draft("Workforest", null, ["Toolbelt"]);
    expect(resolveProposal(proposal, tree).proposed).toBe(proposal);
  });
});

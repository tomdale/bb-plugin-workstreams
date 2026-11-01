import { describe, expect, it } from "vitest";
import { resolveProposal, type Topic } from "../../src/domain/topics.ts";

const entity = (id: string, parentId: string | null = null): Topic => ({
  id,
  name: id,
  description: "",
  parentId,
  aliases: [],
});

describe("resolveProposal", () => {
  const catalog: Topic[] = [
    { ...entity("subagents"), name: "Subagents" },
    { ...entity("bb-plugin", "subagents"), name: "BB Plugin" },
    { ...entity("workstreams"), name: "Workstreams", aliases: ["WS"] },
    { ...entity("recaps", "workstreams"), name: "Recap Cards" },
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
      resolveProposal(draft("Workforest", "subagents", ["Subagents"]), catalog),
    ).toEqual({
      subjectId: null,
      proposed: draft("Workforest", "subagents"),
    });
  });

  it("reuses existing ancestry restated from the root or by alias", () => {
    expect(
      resolveProposal(
        draft("Countdown", "recaps", ["Workstreams", "Recap Cards", "Waiting"]),
        catalog,
      ),
    ).toEqual({
      subjectId: null,
      proposed: draft("Countdown", "recaps", ["Waiting"]),
    });
    expect(
      resolveProposal(draft("Waiting", null, [" ws ", "recap cards"]), catalog),
    ).toEqual({ subjectId: null, proposed: draft("Waiting", "recaps") });
  });

  it("resolves a proposal whose whole path already exists", () => {
    expect(resolveProposal(draft("Subagents", "subagents"), catalog)).toEqual({
      subjectId: "subagents",
      proposed: null,
    });
    expect(
      resolveProposal(draft("BB Plugin", null, ["Subagents"]), catalog),
    ).toEqual({ subjectId: "bb-plugin", proposed: null });
  });

  it("returns a proposal with no existing ancestry unchanged", () => {
    const proposal = draft("Workforest", null, ["Toolbelt"]);
    expect(resolveProposal(proposal, catalog).proposed).toBe(proposal);
  });
});

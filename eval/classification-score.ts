import type { TopicAnswer } from "../src/domain/classify.ts";
import {
  assertProposalLevels,
  resolveProposal,
  topicAncestors,
} from "../src/domain/topics.ts";
import type { ClassifyInput } from "./classification-cases.ts";
type Result = TopicAnswer;
/** Evaluation-only synonym sets; production routing never uses them. Score baseline and candidate with the same sets. */
const aliases: Record<string, RegExp> = {
  Automations:
    /^(automations?|automation runs|automation scheduling|scheduled actions|action scheduling|actions)$/i,
  Investigations: /^(investigations?|alert investigations?)$/i,
  Recaps: /^(recaps?|summaries|summary cards)$/i,
  Questions: /^(questions?|question (cards?|answers?)|q&a( cards?)?)$/i,
  Providers: /^(providers?|provider([ -]id)? routing|provider integration)$/i,
  SDK: /^(sdk|plugin sdk)$/i,
  "Gutter mode":
    /^(gutter( mode| display)?|floating gutter( display| mode)?|floating( mode| display)?)$/i,
};
export function scoreClassification(
  value: Result,
  input: ClassifyInput,
  expected: string | null,
  cold: boolean,
  expectNew?: { outside?: string; inside?: string },
  kind: "quick" | "placement" = "quick",
) {
  let resolved: ReturnType<typeof resolveProposal> | null = null;
  try {
    resolved = value.proposed
      ? resolveProposal(value.proposed, input.entities)
      : null;
    if (resolved?.proposed)
      assertProposalLevels(resolved.proposed, input.entities);
    const selected = value.subjectId ?? resolved?.subjectId;
    if (selected && topicAncestors(selected, input.entities).length > 2)
      throw new Error("Topic depth exceeds two levels.");
  } catch {
    return {
      owner: false,
      capability: false,
      hierarchy: false,
      exact: false,
      pass: false,
    };
  }
  if (expectNew) {
    // Resolve restated ancestry before measuring scope and depth.
    const ancestry: string[] = [];
    let anchor = resolved?.proposed?.parentId ?? null;
    while (anchor && !ancestry.includes(anchor)) {
      ancestry.push(anchor);
      anchor = input.entities.find((e) => e.id === anchor)?.parentId ?? null;
    }
    const pass =
      !value.subjectId &&
      !!resolved?.proposed &&
      !(expectNew.outside && ancestry.includes(expectNew.outside)) &&
      !(expectNew.inside && !ancestry.includes(expectNew.inside));
    return {
      owner: pass,
      capability: pass,
      hierarchy: pass,
      exact: pass,
      pass,
    };
  }
  if (!expected) {
    const pass = !value.subjectId && !value.proposed;
    return {
      owner: pass,
      capability: pass,
      hierarchy: pass,
      exact: pass,
      pass,
    };
  }
  const path: string[] = [];
  let id: string | null = expected;
  while (id) {
    const e = input.entities.find((e) => e.id === id)!;
    path.unshift(e.name);
    id = e.parentId;
  }
  if (!cold) {
    const pass = value.subjectId === expected && !value.proposed;
    return {
      owner: pass,
      capability: pass,
      hierarchy: pass,
      exact: pass,
      pass,
    };
  }
  const actual = [
    ...(value.proposed?.ancestors ?? []).map((a) => a.name),
    ...(value.proposed ? [value.proposed.name] : []),
  ];
  const matches = (name: string, target: string) =>
    (
      aliases[target] ??
      new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    ).test(name.trim());
  const owner = !!actual[0] && matches(actual[0], path[0]!);
  const capability =
    path.length === 1
      ? owner
      : actual.some((name) => matches(name, path.at(-1)!));
  // Every required parent remains in order within the two-level identity limit.
  const hierarchy =
    actual.length >= path.length &&
    path.every((name, i) => !!actual[i] && matches(actual[i]!, name));
  const exact = actual.join("/").toLowerCase() === path.join("/").toLowerCase();
  return {
    owner,
    capability,
    hierarchy,
    exact,
    // Placement proposes one topic, so an empty tree can establish only its root owner.
    pass: owner && (kind === "placement" || (capability && hierarchy)),
  };
}

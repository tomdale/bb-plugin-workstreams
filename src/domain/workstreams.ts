import type { CategoryGeneration } from "./categories.ts";
import type { LayoutNode } from "./layout.ts";
import type { WorkstreamColor } from "./workstreamColor.ts";

export type Workstream = {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  aliases: string[];
  projectId?: string | null;
  projectSource?: "manual" | "learned" | "disabled" | null;
  projectRevision?: number;
};

/**
 * Where a thread's workstream came from, in priority order: a workstream you set, one
 * inherited from the thread or workstream the thread was started from, one
 * chosen automatically from its requests (a thread's start or a turn's end),
 * and one a composer preview showed for earlier text of the draft. A later
 * source never replaces an earlier one, except that an automatic choice
 * replaces an inherited workstream when the scope shifts.
 */
export type AssignmentProvenance =
  "manual" | "inherited" | "automatic" | "composer";

type AssignmentStatus = "assigned" | "none";

export type WorkstreamAssignment = {
  threadId: string;
  workstreamId: string | null;
  status: AssignmentStatus;
  provenance: AssignmentProvenance | null;
  label: string | null;
  ancestorIds: string[];
  evidence: string | null;
  inheritedFrom: string | null;
};

export type WorkstreamState = {
  workstreams: Workstream[];
  groups: Record<string, string>;
  assignments: Record<string, WorkstreamAssignment>;
  revision: number;
  /** The groups the organizer last applied (see `layoutGroups`). */
  layout?: readonly LayoutNode[];
  categories?: { [workstreamId: string]: CategoryGeneration };
  /** Persistent colors for workstreams that have been assigned a color. */
  colors?: Record<string, WorkstreamColor>;
};

type DraftAncestor = {
  name: string;
  description: string;
};

export type DraftWorkstreamProposal = {
  name: string;
  description: string;
  parentId?: string | null;
  ancestors?: DraftAncestor[] | null;
};

/**
 * Whether a workstream can hold threads: a group holds workstreams and never
 * threads, so only a workstream that isn't a group can be chosen.
 */
export const takesThreads = (
  id: string,
  workstreams: readonly { parentId: string | null }[],
) => !workstreams.some((workstream) => workstream.parentId === id);

/** Returns ancestor workstream IDs from nearest up to the top. */
export function workstreamAncestors(
  id: string,
  workstreams: readonly { id: string; parentId: string | null }[],
): string[] {
  const result: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) throw new Error("A workstream is inside itself.");
    seen.add(current);
    result.push(current);
    const workstream = workstreams.find((e) => e.id === current);
    if (!workstream) throw new Error(`Unknown workstream: ${current}`);
    current = workstream.parentId;
  }
  return result;
}

export function assertWorkstreamLevels(
  workstreams: readonly { id: string; parentId: string | null }[],
): void {
  for (const workstream of workstreams)
    if (workstreamAncestors(workstream.id, workstreams).length > 2)
      throw new Error(
        "Workstreams go at most two levels deep. Review the migration preview before applying this.",
      );
}

export function assertProposalLevels(
  proposal: DraftWorkstreamProposal,
  workstreams: readonly { id: string; parentId: string | null }[],
): void {
  const depth =
    (proposal.parentId
      ? workstreamAncestors(proposal.parentId, workstreams).length
      : 0) +
    (proposal.ancestors?.length ?? 0) +
    1;
  if (depth > 2) throw new Error("Workstreams go at most two levels deep.");
}

/** A proposal resolved against the workstreams and groups: an existing workstream, or a discovery. */
type ResolvedProposal =
  | { workstreamId: string; proposed: null }
  | { workstreamId: null; proposed: DraftWorkstreamProposal };

const sameName = (
  workstream: { name: string; aliases: readonly string[] },
  name: string,
) => {
  const target = name.trim().toLowerCase();
  return [workstream.name, ...workstream.aliases].some(
    (candidate) => candidate.trim().toLowerCase() === target,
  );
};

/**
 * Anchors a proposal at its deepest existing ancestor, so `parentId` names that
 * workstream and `ancestors` lists only missing parents. Classifiers sometimes
 * restate existing ancestry in `ancestors` (parent "Subagents" with ancestors
 * ["Subagents"]); taken verbatim, that creates a same-named copy of the parent.
 *
 * Each segment, outermost first and the leaf last, that names a workstream on
 * the anchor's own path or an existing child of the anchor (an existing
 * top-level workstream without one) becomes the anchor; the first other segment
 * starts the missing remainder. Names match by name or alias, ignoring case, as
 * the workstreams and groups' sibling lookup does. When the leaf resolves too,
 * the proposal is that existing workstream.
 */
export function resolveProposal(
  proposal: DraftWorkstreamProposal,
  workstreams: readonly {
    id: string;
    name: string;
    parentId: string | null;
    aliases: readonly string[];
  }[],
): ResolvedProposal {
  const byId = new Map(
    workstreams.map((workstream) => [workstream.id, workstream]),
  );
  const segments = [...(proposal.ancestors ?? []), proposal];
  let anchor = proposal.parentId ?? null;
  let resolved = 0;
  for (const segment of segments) {
    const restated = anchor
      ? workstreamAncestors(anchor, workstreams).find((id) =>
          sameName(byId.get(id)!, segment.name),
        )
      : undefined;
    const next =
      restated ??
      workstreams.find(
        (workstream) =>
          workstream.parentId === anchor && sameName(workstream, segment.name),
      )?.id;
    if (!next) break;
    anchor = next;
    resolved++;
  }
  if (resolved === segments.length && anchor)
    return { workstreamId: anchor, proposed: null };
  if (resolved === 0) return { workstreamId: null, proposed: proposal };
  return {
    workstreamId: null,
    proposed: {
      ...proposal,
      parentId: anchor,
      ancestors: (proposal.ancestors ?? []).slice(resolved),
    },
  };
}

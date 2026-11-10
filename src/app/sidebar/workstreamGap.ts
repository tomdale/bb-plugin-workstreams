import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { splitWorkstreamName } from "../WorkstreamName.tsx";

/**
 * Spacing between two consecutive workstream groups, in pixels. A group is
 * identified by its section id, or by its inline owner when its name is an
 * "Owner: Area" pair (see `splitWorkstreamName`). Siblings of one owner and
 * standalone workstreams get the item gap; crossing an owner boundary widens
 * to the inline boundary gap. Collapsing the previous group shrinks both to
 * their collapsed values. `prev` is null for a list's first group, which
 * leads with no gap. The values live in `SIDEBAR_GEOMETRY.gaps`.
 */
export function workstreamGap(
  prev: GapGroup | null,
  curr: GapGroup,
  prevCollapsed: boolean,
): number {
  if (!prev) return 0;
  const prevLabel = prev.label ?? prev.name;
  const currLabel = curr.label ?? curr.name;
  const prevOwner = splitWorkstreamName(prevLabel)?.owner ?? null;
  const currOwner = splitWorkstreamName(currLabel)?.owner ?? null;
  const prevKey = prevOwner ?? prev.id;
  const currKey = currOwner ?? curr.id;
  const isSame = prevKey === currKey;
  const isInlineBoundary =
    !isSame && (Boolean(prevOwner) || Boolean(currOwner));

  const { gaps } = SIDEBAR_GEOMETRY;
  if (prevCollapsed)
    return isInlineBoundary
      ? gaps.collapsedInlineBoundary
      : gaps.sameParentCollapsed;
  return isInlineBoundary ? gaps.inlineBoundary : gaps.item;
}

/**
 * The identity a gap reads from a group: its inline-owner `label` when it
 * has one, else its `name`.
 */
type GapGroup = {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
};

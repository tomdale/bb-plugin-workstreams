import type { CSSProperties, ReactNode } from "react";
import type { ReplyLeaf, ReplyPart } from "../../domain/replyComponents.ts";
import { Panel } from "./Panel.tsx";
import { partReportsFailure } from "./status.ts";

type Group = Extract<ReplyPart, { type: "group" }>;

/** A peer's narrowest readable column, and the gap between columns (gap-x-6). */
const PEER_MIN_REM = 13;
const PEER_GAP_REM = 1.5;

/**
 * A group's children in their relationship. Peers are separate parts, so they
 * get no frame: they share the width in equal columns when the message column
 * has room and stack when it does not, never wrapping some of them. Supporting
 * children are one object with the point they qualify, so they share one panel:
 * the first child, then the rest indented under a thin rule in the reply accent.
 * A child that is a list stays together in one cell.
 */
export function GroupBody({
  part,
  renderChild,
}: {
  part: Group;
  /** Draws a child inside the group's own frame: no frame of its own, no gutter. */
  renderChild: (child: ReplyLeaf) => ReactNode;
}) {
  const cell = (
    child: Group["children"][number],
    i: number,
    className = "min-w-0",
  ) =>
    Array.isArray(child) ? (
      <div
        key={i}
        data-reply-group-child="list"
        className={`${className} space-y-4`}
      >
        {child.map((leaf, j) => (
          <div key={j} className="min-w-0">
            {renderChild(leaf)}
          </div>
        ))}
      </div>
    ) : (
      <div key={i} data-reply-group-child="" className={className}>
        {renderChild(child)}
      </div>
    );
  if (part.relationship === "peers") {
    const count = part.children.length;
    // All peers share one row or each takes the full width, never a ragged
    // wrap: a cell's basis is zero once the row is wider than every peer's
    // minimum width together, and larger than the row otherwise.
    const minimum = `${count * PEER_MIN_REM + (count - 1) * PEER_GAP_REM}rem`;
    return (
      <div
        data-reply-group="peers"
        className="flex min-w-0 flex-wrap gap-x-6 gap-y-4"
        style={{ "--ws-peers-min": minimum } as CSSProperties}
      >
        {part.children.map((child, i) =>
          cell(
            child,
            i,
            "min-w-0 grow basis-[calc((var(--ws-peers-min)_-_100%)_*_999)]",
          ),
        )}
      </div>
    );
  }
  const [point, ...support] = part.children;
  return (
    <Panel part="group" failed={partReportsFailure(part)}>
      <div
        data-reply-group="supporting"
        className="min-w-0 space-y-3 px-3.5 py-2.5"
      >
        {cell(point!, 0)}
        <div
          data-reply-group-support=""
          className="min-w-0 space-y-4 border-l-2 border-(--ws-reply-accent,var(--border))/40 pl-3.5"
        >
          {support.map((child, i) => cell(child, i + 1))}
        </div>
      </div>
    </Panel>
  );
}

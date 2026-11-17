import { memo, type ReactNode } from "react";
import type { UsageGroup } from "../../domain/usage.ts";
import { formatCost, formatCount, formatTokens } from "./format.ts";
import { unmeteredNote } from "./text.ts";

const NUMBER = "py-1.5 pl-3 text-right tabular-nums";
const TOKENS = `${NUMBER} hidden sm:table-cell`;

/** Tokens a group reported; none reported shows the dash an unreported cost does. */
const tokens = (count: number) =>
  count > 0 ? formatTokens(count) : formatCost(null);

/**
 * One grouping of the range's usage, as a table: requests, tokens, and
 * reported cost per group. The number columns have fixed widths, so they line
 * up from one grouping's table to the next. A group none of whose requests reported a cost
 * shows a dash for it and says so under its name; a group that reported some
 * says how many requests its cost leaves out.
 */
export const Breakdown = memo(function Breakdown({
  heading,
  groups,
  name,
}: {
  /** What the groups are, as the first column's header. */
  heading: string;
  groups: readonly UsageGroup[];
  /** How a group is named; its label when omitted. */
  name?: (group: UsageGroup) => ReactNode;
}) {
  if (!groups.length) return null;
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col />
        <col className="w-20" />
        <col className="hidden w-24 sm:table-column" />
        <col className="hidden w-24 sm:table-column" />
        <col className="w-28" />
      </colgroup>
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 text-left font-medium">
            {heading}
          </th>
          <th scope="col" className={`${NUMBER} font-medium`}>
            Requests
          </th>
          <th scope="col" className={`${TOKENS} font-medium`}>
            Tokens in
          </th>
          <th scope="col" className={`${TOKENS} font-medium`}>
            Tokens out
          </th>
          <th scope="col" className={`${NUMBER} font-medium`}>
            Reported cost
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const note = unmeteredNote(group);
          return (
            <tr
              key={group.key}
              className="border-t border-border align-baseline focus-within:bg-state-hover/50 hover:bg-state-hover/50"
            >
              <th
                scope="row"
                className="py-1.5 text-left font-normal [overflow-wrap:anywhere]"
              >
                {name ? name(group) : group.label}
                {note ? (
                  <span className="block text-xs text-muted-foreground">
                    {note}
                  </span>
                ) : null}
              </th>
              <td className={NUMBER}>{formatCount(group.calls)}</td>
              <td className={TOKENS}>{tokens(group.inputTokens)}</td>
              <td className={TOKENS}>{tokens(group.outputTokens)}</td>
              <td className={NUMBER}>
                {formatCost(group.unmetered >= group.calls ? null : group.cost)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

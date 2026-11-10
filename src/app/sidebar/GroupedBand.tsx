/**
 * One band's rows, drawn as the band's own trees or grouped by workstream.
 *
 * Recent, Snoozed, and Archived can each group their rows by workstream: the
 * band then draws one folded section per workstream, named for it and
 * carrying the number of trees beneath it, with the workstream's trees inside
 * (see `planBandRows`). A group's fold is stored under `<placement>:<id>`, so
 * it is independent of the workstream's own header fold and of the same
 * workstream in another band; Archived groups start folded because they hold
 * many old threads. Ungrouped, the band draws its trees in one list.
 *
 * The rows themselves are drawn by the caller's `renderRow`, so a band's rows
 * look and behave like every other row in the list; this module owns only how
 * the band arranges them.
 */
import { type ReactNode } from "react";

import { UNFILED_NAME } from "../../domain/project.ts";
import { BandGroup } from "./Bands.tsx";
import {
  foldDefault,
  foldKey,
  visibleEntries,
  type BandGroupPlan,
  type ThreadRow,
} from "./rows.ts";
import { type BandId } from "./useBandOptions.ts";
import { type RenderRow } from "./types.ts";

/** The name a band's group regions carry: "Archived", "Recent", "Snoozed". */
const regionLabel = (placement: BandId) =>
  `${placement[0]!.toUpperCase()}${placement.slice(1)}`;

export function GroupedBand({
  placement,
  planned,
  grouped,
  slotWidth,
  renderRow,
  isCollapsed,
  toggle,
}: {
  /** The band whose rows these are, which also selects its fold keys. */
  placement: BandId;
  /** The band's trees, sorted, and split by workstream while grouped. */
  planned: readonly BandGroupPlan[];
  grouped: boolean;
  /** The status slot width every row in the band shares (see `slotWidthOf`). */
  slotWidth: number;
  renderRow: RenderRow;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
  toggle: (id: string, byDefault?: boolean) => void;
}) {
  /** Each tree's visible entries, as this band shows them. */
  const rows = (trees: readonly (readonly ThreadRow[])[]) =>
    trees.flatMap((tree) =>
      visibleEntries(tree, placement, (id) =>
        isCollapsed(foldKey(placement, id), foldDefault(placement)),
      ).map((entry) => renderRow(entry, { placement, slotWidth })),
    );
  if (!grouped) return <>{rows(planned[0]!.trees)}</>;
  const label = regionLabel(placement);
  return (
    <>
      {planned.map(({ id, name, trees }) => {
        const key = `${placement}:${id ?? "__unsorted"}`;
        const byDefault = placement === "archived";
        const collapsed = isCollapsed(key, byDefault);
        return (
          <li key={key} className="list-none">
            <BandGroup
              label={label}
              name={name ?? UNFILED_NAME}
              count={trees.length}
              collapsed={collapsed}
              onToggle={() => toggle(key, byDefault)}
            >
              {rows(trees)}
            </BandGroup>
          </li>
        );
      })}
    </>
  );
}

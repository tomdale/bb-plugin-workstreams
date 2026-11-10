import { useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Row } from "../../domain/project.ts";
import type { TopicColor } from "../../domain/workstreamColor.ts";
import type { ServerState, WorkView } from "../useWorkstreams.ts";
import { hasStatusMark } from "../sidebar/presentation.ts";
import { FocusIcon } from "../sidebar/FocusIcon.tsx";
import { HIDDEN_NOW, HomeThreadRow } from "./HomeRow.tsx";
import { presenceProps, useSlotList } from "../sidebar/motion.ts";

/** One of Up Next's slots on Home: a row, or Show more below the rows. */
type Item =
  | { readonly kind: "row"; readonly row: Row<PluginSidebarThread> }
  | { readonly kind: "more"; readonly count: number };
const MORE_KEY = ":more";
const itemKey = (item: Item) =>
  item.kind === "row" ? item.row.thread.id : MORE_KEY;

/**
 * Up Next on Home: the rows `selectUpNext` chose, in the sidebar's Up
 * Next block, with Show more for the trimmed threads still unread or blocked on
 * the user. Each row names its workstream in the workstream's hue. Rows and
 * Show more move as in the sidebar (see `useSlotList`).
 */
export function UpNextBlock({
  rows: kept,
  more,
  trimmed,
  current,
  focused,
  work,
  analysis,
  recaps,
  workstreamOf,
  now,
  showAge,
}: {
  rows: readonly Row<PluginSidebarThread>[];
  /** What Show more reveals below `rows`. */
  more: readonly Row<PluginSidebarThread>[];
  /** Every thread the row limit kept out, `more` included. */
  trimmed: readonly Row<PluginSidebarThread>[];
  /** Each visible row by thread id, for drawing a row on its way out. */
  current: ReadonlyMap<string, Row<PluginSidebarThread>>;
  /** Focus left other workstreams' threads out. */
  focused: boolean;
  work: (thread: PluginSidebarThread) => WorkView;
  analysis: ServerState["analysis"];
  recaps: ServerState["recaps"];
  workstreamOf: (row: Row<PluginSidebarThread>) => {
    name: string;
    color: TopicColor;
  } | null;
  now: number;
  showAge: boolean;
}) {
  const [showMore, setShowMore] = useState(false);
  // With nothing left to reveal Show more closes, so the next reveal starts
  // collapsed, as in the sidebar.
  if (showMore && more.length === 0) setShowMore(false);
  const rows = showMore ? [...kept, ...more] : kept;
  const marks = rows.some((row) => hasStatusMark(row.thread, work(row.thread)));
  const items = useMemo<Item[]>(
    () => [
      ...rows.map((row) => ({ kind: "row" as const, row })),
      ...(more.length > 0
        ? [{ kind: "more" as const, count: more.length }]
        : []),
    ],
    [rows, more.length],
  );
  const hidden = useMemo(() => {
    const shown = new Set(rows.map((row) => row.thread.id));
    return new Set(
      trimmed.map((row) => row.thread.id).filter((id) => !shown.has(id)),
    );
  }, [rows, trimmed]);
  const slots = useSlotList(items, itemKey, {
    trimmed: hidden,
    edge: MORE_KEY,
    immediate: String(showMore),
    arranged: (item) => item.kind === "more",
  });
  return (
    <section aria-label="Up Next" className="ws-home-up-next ws-needs">
      <h2 className="ws-home-up-next-head">
        <span>Up Next</span>
        {focused ? (
          <span
            role="img"
            aria-label="Showing focused workstreams"
            className="ws-home-flag"
          >
            <FocusIcon className="ws-home-flag-icon" />
          </span>
        ) : null}
        {rows.length > 1 ? (
          <span className="ws-needs-count">
            <span aria-hidden="true">{rows.length}</span>
            <span className="sr-only">, {rows.length} threads</span>
          </span>
        ) : null}
      </h2>
      <ul className="ws-home-rows" role="list">
        {slots.map((slot) => {
          if (slot.item.kind === "more")
            return (
              <li
                key={slot.key}
                ref={slot.ref}
                className="ws-home-more-slot"
                {...presenceProps(slot.leaving ? "leave" : "idle")}
              >
                <button
                  type="button"
                  className="ws-home-more ws-needs-you-text"
                  aria-expanded={showMore}
                  onClick={() => setShowMore(!showMore)}
                >
                  {showMore ? "Show less" : `Show ${slot.item.count} more`}
                </button>
              </li>
            );
          const row = current.get(slot.item.row.thread.id) ?? slot.item.row;
          const workstream = workstreamOf(row);
          return (
            <HomeThreadRow
              key={slot.key}
              slotRef={slot.ref}
              leaving={slot.leaving}
              thread={row.thread}
              analysis={analysis[row.thread.id]}
              recap={recaps[row.thread.id]}
              now={showAge ? now : HIDDEN_NOW}
              variant="attention"
              showMarkSlot={marks}
              showAge={showAge}
              workstreamName={workstream?.name}
              workstreamHue={workstream?.color.hue}
              workstreamLevel={workstream?.color.level}
            />
          );
        })}
      </ul>
    </section>
  );
}

import { useRef, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Row } from "../../domain/project.ts";
import type { TopicColor } from "../../domain/workstreamColor.ts";
import type { ServerState, WorkView } from "../useWorkstreams.ts";
import { hasStatusMark } from "../sidebar/presentation.ts";
import { FocusIcon } from "../sidebar/FocusIcon.tsx";
import { HIDDEN_NOW, HomeThreadRow } from "./HomeRow.tsx";
import { useRowFlip } from "../sidebar/motion.ts";

/**
 * Up Next on Home: the rows `selectUpNext` chose, in the sidebar's Up
 * Next block, with Show more for the trimmed threads still unread or blocked on
 * the user. Each row names its workstream in the workstream's hue.
 */
export function UpNextBlock({
  rows: kept,
  more,
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
  const marks = rows.some((row) =>
    hasStatusMark(row.thread, work(row.thread), true),
  );
  const listRef = useRef<HTMLUListElement>(null);
  const captureRows = useRowFlip(
    listRef,
    rows.map((row) => row.thread.id).join(" "),
  );
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
      <ul
        ref={listRef}
        onClickCapture={captureRows}
        className="ws-home-rows"
        role="list"
      >
        {rows.map((row) => {
          const workstream = workstreamOf(row);
          return (
            <HomeThreadRow
              key={row.thread.id}
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
      {more.length > 0 ? (
        <button
          type="button"
          className="ws-home-more ws-needs-you-text"
          aria-expanded={showMore}
          onClick={() => setShowMore(!showMore)}
        >
          {showMore ? "Show less" : `Show ${more.length} more`}
        </button>
      ) : null}
    </section>
  );
}

import type { Projection } from "../../domain/project.ts";
import {
  holdInPlace,
  selectUpNext,
  type UpNextOptions,
  type UpNextThread,
} from "../../domain/upNext.ts";

/** The selected row's anchor and the row order from the last committed view. */
export type UpNextState = {
  readonly threadId: string | null;
  readonly index: number;
  readonly shown: readonly string[];
};

export const initialUpNextState: UpNextState = {
  threadId: null,
  index: -1,
  shown: [],
};

/**
 * Plans the sidebar's live Up Next rows without moving the selected row when
 * reading, answering, or focusing changes its rank. Commit the returned state
 * after displaying the view; an abandoned React render must not move the anchor.
 */
export function planSidebarUpNext<T extends UpNextThread>(
  previous: UpNextState,
  projection: Projection<T>,
  options: UpNextOptions<T>,
  activeThreadId: string | null,
  expanded: boolean,
) {
  const selection = selectUpNext(projection, options);
  expanded = expanded && selection.more.length > 0;
  const listed = expanded
    ? [...selection.rows, ...selection.more]
    : selection.rows;
  let index =
    previous.threadId === activeThreadId
      ? previous.index
      : activeThreadId
        ? previous.shown.indexOf(activeThreadId)
        : -1;
  if (index < 0)
    index = listed.findIndex((row) => row.thread.id === activeThreadId);
  // Resolve from live groups, not the prior view: explicitly hidden, archived,
  // and snoozed threads must leave even while selected.
  const openRow = activeThreadId
    ? [...projection.groups, projection.unsorted, ...projection.dormant]
        .flatMap((group) => group.rows)
        .find((row) => row.thread.id === activeThreadId)
    : undefined;
  const rows = holdInPlace(listed, openRow, index);
  return {
    state: {
      threadId: activeThreadId,
      index,
      shown: rows.map((row) => row.thread.id),
    },
    rows,
    expanded,
    moreCount: selection.more.filter((row) => !rows.includes(row)).length,
    focused: selection.focused,
  };
}

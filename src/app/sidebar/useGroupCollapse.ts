import { useCallback, type Dispatch, type SetStateAction } from "react";
import { groupCollapseKey, useCollapsed } from "./useCollapsed.ts";
import type { TopicState } from "../../domain/topics.ts";

/** What names a group's collapse state: its section, and its topic when it has one. */
export type CollapseRef = {
  readonly id: string;
  readonly topicId?: string | null;
};

export type CollapseScope = {
  /** Collapsed until the user opens it. */
  byDefault?: boolean;
  /**
   * A workstream below the focused ones. While focus tiers the list, these
   * start collapsed on every reveal and open only for this session (see
   * `lowerExpanded`); otherwise they fold like any other group.
   */
  lower?: boolean;
};

/**
 * Every group fold in the thread list. A group's stored state follows its
 * topic, so it survives its section being deleted and recreated; a shared
 * topic's header has no section to look the topic up by, so it names its own.
 * Folded threads and bands use the stored state directly (`isCollapsed`,
 * `toggle`).
 */
export function useGroupCollapse({
  groups,
  tiered,
  lowerExpanded,
  setLowerExpanded,
}: {
  /**
   * The catalog's section-to-topic bindings. Only these name a fold, so a
   * catalog change elsewhere leaves the fold callbacks as they were.
   */
  groups: TopicState["groups"] | undefined;
  tiered: boolean;
  lowerExpanded: ReadonlySet<string>;
  setLowerExpanded: Dispatch<SetStateAction<ReadonlySet<string>>>;
}) {
  const { isCollapsed, toggle } = useCollapsed();
  const keyOf = useCallback(
    (group: CollapseRef) =>
      groupCollapseKey(group.id, group.topicId ?? groups?.[group.id]),
    [groups],
  );
  const stored = useCallback(
    (group: CollapseRef, byDefault: boolean) =>
      isCollapsed(keyOf(group), isCollapsed(group.id, byDefault)),
    [isCollapsed, keyOf],
  );
  const groupCollapsed = useCallback(
    (
      group: CollapseRef,
      { byDefault = false, lower = false }: CollapseScope = {},
    ) =>
      lower && tiered
        ? !lowerExpanded.has(keyOf(group))
        : stored(group, byDefault),
    [keyOf, lowerExpanded, stored, tiered],
  );
  const toggleGroup = useCallback(
    (
      group: CollapseRef,
      { byDefault = false, lower = false }: CollapseScope = {},
    ) => {
      const key = keyOf(group);
      if (!(lower && tiered)) return toggle(key, stored(group, byDefault));
      setLowerExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    },
    [keyOf, setLowerExpanded, stored, tiered, toggle],
  );
  return { isCollapsed, toggle, groupCollapsed, toggleGroup };
}

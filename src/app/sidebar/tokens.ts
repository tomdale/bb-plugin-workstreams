/**
 * Sidebar geometry, in pixels, shared by the workstream list's layout code.
 * Each group names the element it sizes (see ThreadList for the markup).
 */
export const SIDEBAR_GEOMETRY = {
  container: { paddingX: 8, paddingY: 12 },
  sectionHeading: { height: 13, topMargin: 8, bottomMargin: 9, leftInset: 10 },
  workstreamHeader: { height: 22, indent: 10 },
  row: { rootHeight: 21, childHeight: 28, rootInset: 5, childIndent: 20 },
  category: {
    height: 14,
    indent: 20,
    firstTopGap: 4,
    /** Top margin for subsequent categories: 4px catGap + 9px categoryBetween = 13px. */
    betweenGap: 13,
    afterGap: 3,
  },
  gaps: {
    item: 9,
    inlineBoundary: 22,
    collapsedInlineBoundary: 4,
    sameParentCollapsed: 0,
  },
  lowerToggle: { height: 15.2, topMargin: 16, bottomMargin: 10, inset: 6 },
} as const;

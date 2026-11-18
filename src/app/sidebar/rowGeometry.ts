import { FULL_SLOT_PX, childIndent } from "./statusSlot.ts";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";

/** Children indent at most this many levels; deeper rows stay put. */
export const MAX_INDENT = 3;

type RowHeight =
  | typeof SIDEBAR_GEOMETRY.row.rootHeight
  | typeof SIDEBAR_GEOMETRY.row.childHeight;

/**
 * The Tailwind class for each one-line row height token. Tailwind generates
 * only classes spelled out in source, so a token cannot build its class at
 * run time; a token value without an entry here fails the typecheck.
 */
const ROW_HEIGHT_CLASS = {
  21: "h-[21px]",
  28: "h-7",
} as const satisfies Record<RowHeight, string>;

/**
 * The layout values a sidebar row derives from its depth and location: its left
 * padding, its height and line-height classes, and whether its hover actions
 * draw at the compact (top-level) size.
 */
export function rowGeometry(options: {
  depth: number;
  /** The width of the list's status slot; children indent past it. */
  slotWidth?: number;
  inGroup?: boolean;
  hasSubtitle?: boolean;
}): {
  paddingLeft: number;
  heightClass: string;
  leadingClass: string;
  compactActions: boolean;
} {
  // A workstream's top-level threads share one inset whether or not a
  // category heading sits over them; overlay bands have their own.
  const baseIndent = options.inGroup
    ? SIDEBAR_GEOMETRY.row.rootInset
    : SIDEBAR_GEOMETRY.row.overlayInset;
  const paddingLeft =
    baseIndent +
    Math.min(options.depth, MAX_INDENT) *
      childIndent(options.slotWidth ?? FULL_SLOT_PX);

  // A one-line row takes its height token; a two-line row sizes itself from
  // its content, so it carries no height class (the `items-start` layout in
  // Row.tsx centers its marks on the title's 20px line).
  const heightClass = options.hasSubtitle
    ? ""
    : `${
        ROW_HEIGHT_CLASS[
          options.depth > 0
            ? SIDEBAR_GEOMETRY.row.childHeight
            : SIDEBAR_GEOMETRY.row.rootHeight
        ]
      } items-center`;

  // Nested and two-line rows give their titles a 20px (`leading-5`) line so the
  // aside stays centered on it; a top-level title sits on a tighter 1.2 line to
  // fit its 21px row.
  const leadingClass =
    options.hasSubtitle || options.depth > 0 ? "leading-5" : "leading-[1.2]";

  const compactActions = options.depth === 0;

  return { paddingLeft, heightClass, leadingClass, compactActions };
}

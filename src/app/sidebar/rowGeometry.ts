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
 * The layout values a sidebar row derives from its depth and placement: its
 * left padding, its height and line-height classes, and whether its hover
 * actions draw at the compact (root) size.
 */
export function rowGeometry(options: {
  depth: number;
  /** The width of the list's status slot; children indent past it. */
  slotWidth?: number;
  inGroup?: boolean;
  categorized?: boolean;
  hasSubtitle?: boolean;
}): {
  paddingLeft: number;
  heightClass: string;
  leadingClass: string;
  compactActions: boolean;
} {
  // Inline groups: a root sits at the workstream header's title inset, and
  // a categorized root indents to the category heading. The category's 20px
  // indent less the sortable tree container's own 12px (`pl-3`) leaves 8px
  // here, so a categorized root sits flush under its heading. Overlay bands
  // give every row a fixed 6px indent.
  const baseIndent = options.inGroup
    ? options.categorized
      ? SIDEBAR_GEOMETRY.category.indent - 12
      : SIDEBAR_GEOMETRY.row.rootInset
    : 6;
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

  // Nested and two-line rows give their titles a 20px (`leading-5`) line so
  // the aside stays centered on it; a root's title sits on a tighter 1.2
  // line to fit its 21px row.
  const leadingClass =
    options.hasSubtitle || options.depth > 0 ? "leading-5" : "leading-[1.2]";

  const compactActions = options.depth === 0;

  return { paddingLeft, heightClass, leadingClass, compactActions };
}

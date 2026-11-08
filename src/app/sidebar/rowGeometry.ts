import { SIDEBAR_GEOMETRY } from "./tokens.ts";

/**
 * One level of nesting: a status slot (14px) and the gap after it (6px), so
 * a child's mark sits where its parent's title starts. Each group's contents
 * in the thread list step in by the same amount.
 */
export const INDENT_PX = SIDEBAR_GEOMETRY.row.childIndent;

/** Children indent at most this many levels; deeper rows stay put. */
export const MAX_INDENT = 3;

/**
 * The layout values a sidebar row derives from its depth and placement: its
 * left padding, its height and line-height classes, and whether its hover
 * actions draw at the compact (root) size.
 */
export function rowGeometry(options: {
  depth: number;
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
    baseIndent + Math.min(options.depth, MAX_INDENT) * INDENT_PX;

  // A root row is 21px and a nested row 28px (`h-7`); a two-line row sizes
  // itself from its content, so it carries no height class (the `items-start`
  // layout in Row.tsx sets the title's 20px line).
  const heightClass = options.hasSubtitle
    ? ""
    : options.depth > 0
      ? "h-7 items-center"
      : "h-[21px] items-center";

  // Nested and two-line rows give their titles a 20px (`leading-5`) line so
  // the aside stays centered on it; a root's title sits on a tighter 1.2
  // line to fit its 21px row.
  const leadingClass =
    options.hasSubtitle || options.depth > 0 ? "leading-5" : "leading-[1.2]";

  const compactActions = options.depth === 0;

  return { paddingLeft, heightClass, leadingClass, compactActions };
}

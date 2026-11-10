import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  dotMark,
  slotMarkFor,
  type SlotMarkKind,
} from "../../domain/presentation.ts";
import type { SpinnerStyle } from "../../domain/spinner.ts";
import type { WorkView } from "../../domain/status.ts";

/** The row's gap (`gap-1.5`) between its status slot and its title. */
export const STATUS_GAP_PX = 6;

/** The slot's width when its widest mark fills a 14px box. */
export const FULL_SLOT_PX = 14;

/**
 * The widest ink each mark draws, in pixels. A list reserves the widest of
 * the marks it shows (see `slotWidthOf`), so a figure below the ink it
 * describes clips or crowds that mark; a Chrome test measures every spinner
 * shape against `SPINNER_WIDTH_PX`.
 */
const DOT_PX = 8;
export const SPINNER_WIDTH_PX = {
  spokes: 14,
  "bold-spokes": 14,
  arc: 9,
  orbit: 10,
  ring: 9,
  braille: 9,
  dots: 11,
} as const satisfies Record<SpinnerStyle["shape"], number>;

/** Something a list row can draw in its slot besides a thread mark. */
type SlotContent = SlotMarkKind | "disclosure";

/** The width a slot needs to hold one kind of content. */
export function slotContentWidth(
  kind: SlotContent,
  shape: SpinnerStyle["shape"],
): number {
  if (kind !== "disclosure" && dotMark(kind)) return DOT_PX;
  switch (kind) {
    case "working":
    case "waiting":
      return SPINNER_WIDTH_PX[shape];
    default:
      // The failure circle, the pencil, and the disclosure chevron sit in a
      // full 14px box.
      return FULL_SLOT_PX;
  }
}

/**
 * The slot width a list of rows reserves: the widest content any of its
 * rows draws, or 0 when none draws any, so the slot folds away. Every row
 * of a list shares this width, so titles keep one left edge, and a child
 * row indents by the same width (see `childIndent`).
 */
export function slotWidthOf(
  rows: readonly {
    readonly thread: PluginSidebarThread;
    readonly hasChildren: boolean;
  }[],
  work: (thread: PluginSidebarThread) => WorkView | undefined,
  shape: SpinnerStyle["shape"],
): number {
  let width = 0;
  for (const row of rows) {
    if (row.hasChildren) width = Math.max(width, FULL_SLOT_PX);
    const mark = slotMarkFor(row.thread, work(row.thread) ?? { kind: "none" });
    if (mark) width = Math.max(width, slotContentWidth(mark.kind, shape));
  }
  return width;
}

/**
 * One level of nesting for a list whose slot is `slotWidth` wide: the slot
 * and the gap after it, so a child's mark sits where its parent's title
 * starts.
 */
export function childIndent(slotWidth: number): number {
  return slotWidth + STATUS_GAP_PX;
}

/**
 * The left edge of a band control's text: the row's 6px inset, the slot and
 * its gap, or the folded slot's 2px remainder (see `.ws-status-slot`).
 */
export function bandTitleInset(slotWidth: number): number {
  return 6 + STATUS_GAP_PX + (slotWidth > 0 ? slotWidth : 2);
}

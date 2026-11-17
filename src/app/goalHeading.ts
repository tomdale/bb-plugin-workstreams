/**
 * Geometry of the sticky goal heading (StickyGoalHeader), kept pure so the
 * sizes it reserves and draws can be tested without a browser.
 *
 * Every size is a multiple of the timeline's body font size, so the heading
 * scales with the text around it. Expanded, the heading is the most prominent
 * text on the page: the workstream line, a large title, and the thread's
 * desired outcome. Scrolled away from the newest message it collapses into a compact
 * workstream-over-goal block, in the title bar when there is room and anchored
 * at the top of the timeline when there is not.
 */

/** The feather styles.css draws below a plate, in rem of the gradient's length. */
const PLATE_FADE_REM = 12;

export const TITLE_SIZE = 1.5;
export const SUBTITLE_SIZE = 0.92;
export const TITLE_LINE = 4 / 3;
export const SUBTITLE_LINE = 1.4;
export const PAD_TOP = 0.85;
const PAD_BOTTOM = 0.65;
/** Workstream line plus the gap before the title, when there is a workstream. */
const EYEBROW_BLOCK = 1.25;
/** In the title bar the title is set at this multiple of body size. */
export const TITLE_BAR_TITLE_SIZE = 0.95;
/** Padding above a heading that stays anchored in the timeline. */
export const ANCHORED_PAD = 0.5;
/**
 * The plate's own feathered bottom edge, in em of body size. A anchored heading
 * is a solid band the timeline scrolls under, so the band dissolves into the
 * messages over this distance instead of ending on a line across the first row
 * it covers. It doubles as the compact block's padding below its title, since
 * the fade needs somewhere to happen that is not over text.
 */
export const ANCHORED_EDGE = 0.9;

/**
 * Distance a anchored band's own edge fades over: the padding below its last
 * line, so the dissolve never runs under a glyph. The compact block keeps that
 * padding for the fade, which is why its padding and this distance are one
 * constant.
 */
export function anchoredEdge(base: number, compact: boolean): number {
  return base * (compact ? ANCHORED_EDGE : PAD_BOTTOM);
}

/**
 * Feather below a anchored plate, as a fraction of the shadow styles.css draws
 * under the expanded plate: 1.875rem, long enough to finish the dissolve the
 * plate's edge starts rather than reading as a band of its own.
 */
export const ANCHORED_FEATHER = 1.875 / PLATE_FADE_REM;

/**
 * BB's own phone condition: a viewport under its `md` breakpoint driven by a
 * coarse pointer. It is the condition under which BB bumps its type tokens
 * (`--text-xs` and up) and sizes its controls for touch, so the heading
 * follows the same rule.
 */
export const PHONE_QUERY = "(max-width: 767px) and (pointer: coarse)";

/**
 * The workstream line above the title. On a desktop-class layout it is small
 * and shrinks further in the title bar, where space is tight. On a phone it
 * is one fixed size in every state, and `--text-xs` is the size BB sets its
 * secondary text in there, so it keeps one reading size and one reserved
 * height whether the heading is expanded or compact.
 */
type Eyebrow = {
  /** Font size in px. */
  readonly size: number;
  /** Scale applied while the heading is compact. */
  readonly compactScale: number;
  /** Room reserved above the title when expanded, in px. */
  readonly expandedBlock: number;
  /** Room reserved above the title when compact, in px. */
  readonly compactBlock: number;
};

const DESKTOP_EYEBROW_SIZE = 0.8;
const DESKTOP_COMPACT_SCALE = 0.82;
/** 14px at the 16px body size phones use: BB's `text-xs` there. */
const PHONE_EYEBROW_SIZE = 0.875;
/** The workstream line's own line box, as a multiple of its font size. */
const EYEBROW_LINE = 1.2;
/** The wave icon's box (`.size-4`), which sets a floor on the line's height. */
const EYEBROW_ICON_PX = 16;
/** Gap between the minimized workstream line and the title beneath it. */
export const COMPACT_GAP = 0.2;

export function eyebrowMetrics(base: number, phone: boolean): Eyebrow {
  const expandedBlock = base * EYEBROW_BLOCK;
  const size = base * (phone ? PHONE_EYEBROW_SIZE : DESKTOP_EYEBROW_SIZE);
  const compactScale = phone ? 1 : DESKTOP_COMPACT_SCALE;
  // The minimized line clears its own line box, icon included, so the title
  // sits under the text rather than under a fixed offset that either crowds
  // the line or leaves a gap: the box is what the line actually draws.
  const line = Math.max(EYEBROW_ICON_PX, size * EYEBROW_LINE) * compactScale;
  return {
    size,
    compactScale,
    expandedBlock,
    compactBlock: line + base * COMPACT_GAP,
  };
}

/** Height of the workstream line's box, which its icon sets a floor on. */
export function eyebrowHeight(eyebrow: Eyebrow): number {
  return Math.max(EYEBROW_ICON_PX, eyebrow.size * EYEBROW_LINE);
}

/** Expanded heading height in px for a body font size. */
export function headingHeight(
  base: number,
  hasEyebrow: boolean,
  titleLines: number,
  goalLines: number,
): number {
  return Math.round(
    base *
      (PAD_TOP +
        (hasEyebrow ? EYEBROW_BLOCK : 0) +
        TITLE_SIZE * TITLE_LINE * titleLines +
        SUBTITLE_SIZE * SUBTITLE_LINE * goalLines +
        PAD_BOTTOM),
  );
}

/** Distance the expanded title travels until its bottom reaches the pane edge. */
export function titleExitDistance(
  base: number,
  eyebrow: Eyebrow | null,
  titleLines: number,
): number {
  return (
    base * PAD_TOP +
    (eyebrow?.expandedBlock ?? 0) +
    base * TITLE_SIZE * TITLE_LINE * titleLines
  );
}

// The fade's small gestures need a handoff of 3.5 times the exit distance to
// remain legible.
const HEADING_SCROLL_RATIO = 1 / 3.5;

export function headingScrollLimit(exitDistance: number): number {
  return exitDistance / HEADING_SCROLL_RATIO;
}

/** The fade's progress through its handoff at a scroll position. */
export function headingScroll(
  fromBottom: number,
  exitDistance: number,
  scrollLimit = headingScrollLimit(exitDistance),
) {
  const t =
    scrollLimit <= 0 ? 1 : Math.min(Math.max(0, fromBottom) / scrollLimit, 1);
  // Start responsively and ease to zero velocity at the shared endpoint.
  return { progress: t * (0.5 + t * (2 - 1.5 * t)) };
}

/**
 * The fixed layout's scroll-linked handoff. Both titles share one eased
 * crossfade while the large title retreats and the compact title rises; only
 * their transforms and opacity change, so the timeline never reflows.
 */
export const FADE_COMPACT_RISE = 4;

export function headingFade(progress: number, motion = true) {
  const eased = progress * progress * (3 - 2 * progress);
  const retreat = -3 * eased;
  return {
    expanded: {
      opacity: 1 - eased,
      y: motion ? retreat || 0 : 0,
      scale: motion ? 1 - 0.01 * eased : 1,
    },
    compact: {
      opacity: eased,
      y: motion ? FADE_COMPACT_RISE * (1 - eased) : 0,
      scale: motion ? 0.99 + 0.01 * eased : 1,
    },
  };
}

/** The anchored title scales directly between its expanded and compact sizes. */
export function anchoredTitleScale(progress: number): number {
  return 1 + (TITLE_BAR_TITLE_SIZE / TITLE_SIZE - 1) * progress;
}

/** Keep timeline text behind the large heading until its fade is nearly done. */
export function headingBackdropOpacity(progress: number): number {
  return 1 - progress ** 12;
}

/**
 * A heading anchored in the timeline steps between its two states instead of
 * following the scroll frame by frame: it compacts in one move once the reader
 * has scrolled back far enough for the title to have left its expanded place.
 * The scroll position picks the state; the change itself is animated in time.
 */
export function anchoredStep(fromBottom: number, exitDistance: number): 0 | 1 {
  return fromBottom >= exitDistance ? 1 : 0;
}

/** Smallest title-bar slot worth drawing the compact heading into. */
export const MIN_TITLE_BAR_WIDTH = 140;
/** Clearance between the compact heading and the bar's controls. */
export const TITLE_BAR_GAP = 16;

/**
 * Where the compact heading sits in the title bar, in px from the bar's left
 * edge. Left alignment takes the span between the title cluster and the
 * actions; centering takes an even span around the bar's middle, bounded by the
 * nearer control. Null when neither span is wide enough, which leaves the
 * compact copy in the timeline instead of the bar.
 */
export function titleBarSlot(
  bar: { left: number; right: number },
  clusterRight: number,
  actionsLeft: number,
  centered: boolean,
): { x: number; width: number } | null {
  if (centered) {
    const center = (bar.left + bar.right) / 2;
    const half = Math.min(
      center - clusterRight - TITLE_BAR_GAP,
      actionsLeft - TITLE_BAR_GAP - center,
    );
    if (half * 2 < MIN_TITLE_BAR_WIDTH) return null;
    return { x: center - half - bar.left, width: half * 2 };
  }
  const x = clusterRight + TITLE_BAR_GAP;
  const width = actionsLeft - TITLE_BAR_GAP - x;
  return width >= MIN_TITLE_BAR_WIDTH ? { x: x - bar.left, width } : null;
}

/** The collapsed text block (workstream over title) in px. */
export function compactBlock(base: number, eyebrow: Eyebrow | null): number {
  return (
    (eyebrow ? eyebrow.compactBlock : 0) +
    base * TITLE_BAR_TITLE_SIZE * TITLE_LINE
  );
}

/** Plate height when the collapsed heading stays anchored in the timeline. */
export function anchoredHeight(
  base: number,
  eyebrow: Eyebrow | null,
  titleLines = 1,
): number {
  return Math.round(
    compactBlock(base, eyebrow) +
      base * TITLE_BAR_TITLE_SIZE * TITLE_LINE * (titleLines - 1) +
      base * (ANCHORED_PAD + ANCHORED_EDGE),
  );
}

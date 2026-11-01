/*
 * Where the queue's heading and card stack sit on the page. The front card's
 * top edge is `CARD_TOP_FRACTION` of the page's height down. The heading sits
 * just above the pile peeking over the card: its top is placed so that a
 * one-line heading (`HEADING_HEIGHT`) ends `HEADING_GAP` px above the pile,
 * and never closer than `MIN_PAGE_TOP` to the top of the page. Only the page's
 * height enters either rule, never the item's, so the heading and the stack
 * stay put as cards tuck under. A heading that wraps to more lines pushes the
 * card down by the difference (which `useQueueMotion` glides); the heading
 * itself does not move.
 *
 * The page is a size container (`cqh` is its height), so both follow a resized
 * window with no script.
 */
import { LEAD } from "./stackEngine.ts";

/** The page height's share above the front card's top edge. */
export const CARD_TOP_FRACTION = 0.24;

/** The least distance from the top of the page to the heading, px. */
export const MIN_PAGE_TOP = 36;

/** A one-line heading's height: the workstream line and a one-line title, px. */
export const HEADING_HEIGHT = 52;

/** The space between a one-line heading and the top of the pile, px. */
export const HEADING_GAP = 16;

const cardTop = `${CARD_TOP_FRACTION * 100}cqh`;

/** The column's top padding, which places the heading. */
export const PAGE_TOP = `max(${MIN_PAGE_TOP}px, calc(${cardTop} - ${LEAD + HEADING_GAP + HEADING_HEIGHT}px))`;

/**
 * The least height of the block holding the receipt and heading, which puts
 * the front card at `CARD_TOP_FRACTION` of the page when the heading is short.
 */
export const HEADING_BLOCK_MIN_HEIGHT = `max(0px, calc(${cardTop} - ${LEAD}px - ${PAGE_TOP}))`;

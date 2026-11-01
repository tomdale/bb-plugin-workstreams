/*
 * Where the queue's heading and card stack sit on the page. The heading is
 * pinned `PAGE_TOP` px from the top; the front card's top edge is
 * max(the heading's bottom plus the room for the pile peeking above the card,
 * `CARD_TOP_FRACTION` of the page's height). Only the page's height enters the
 * rule, never the item's, so the stack stays put as cards tuck under, and a
 * heading long enough to reach the card pushes it down by the difference
 * (which `useQueueMotion` glides).
 */
import { LEAD } from "./stackEngine.ts";

/** The heading's distance from the top of the page, px. */
export const PAGE_TOP = 36;

/**
 * The page height's share above the front card. About where a typical card
 * with its replies and actions reads as centered in a 1280×860 window, while
 * leaving the footer's arrows clear at 640px tall.
 */
export const CARD_TOP_FRACTION = 0.3;

/**
 * The least height of the block holding the receipt and heading that puts the
 * front card at `CARD_TOP_FRACTION` of the page. The page is a size container
 * (`cqh` is its height), so the card follows a resized window with no script.
 */
export const HEADING_BLOCK_MIN_HEIGHT = `max(0px, calc(${CARD_TOP_FRACTION * 100}cqh - ${PAGE_TOP + LEAD}px))`;

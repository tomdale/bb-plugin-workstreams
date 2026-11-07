/**
 * The marks the sidebar draws for a workstream and for its categories: a
 * two-character tile for the workstream itself, and an unlettered silhouette
 * for each category, stepped around the workstream's own hue.
 *
 * A category's silhouette and its hue offset both come from its position in
 * the workstream's current generation, so a regroup that reorders categories
 * moves both. Nothing here is stored, and nothing here depends on the
 * category's name or id.
 */

/**
 * The silhouettes, in the order they are handed to categories. A workstream
 * with more categories than this repeats them.
 */
export const MARK_SHAPES = [
  "circle",
  "rounded-square",
  "diamond",
  "shield",
  "hexagon",
  "tag",
  "pentagon",
] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

/**
 * How far each category's marker turns from its workstream's hue, in degrees.
 * Small enough that a category reads as a variant of the workstream's colour
 * rather than as a colour of its own.
 */
export const MARK_HUE_STEP = 12;

/** A marker index: whole, and never negative, so an odd input still draws. */
const at = (index: number) =>
  Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;

/** The silhouette for the category at `index` in its workstream. */
export function markShape(index: number): MarkShape {
  return MARK_SHAPES[at(index) % MARK_SHAPES.length]!;
}

/** How far the marker at `index` turns from the workstream's own hue. */
export function markHueOffset(index: number): number {
  return (at(index) % MARK_SHAPES.length) * MARK_HUE_STEP;
}

/**
 * The hue a category's marker is drawn in: its workstream's own hue, turned
 * one step per category. Resolved here rather than in CSS so the marker draws
 * with the same identity-color literal every other workstream surface uses.
 */
export function markHue(hue: number, index: number): number {
  const workstream = Number.isFinite(hue) ? hue : 0;
  return (((workstream % 360) + 360 + markHueOffset(index)) % 360) | 0;
}

/**
 * The two characters on a workstream's tile, from the workstream's own name
 * rather than a label that carries a first-tier prefix: the initials of its
 * words when it has two or more, otherwise its first two letters. Words are
 * letters and digits, and anything else separates them. A name with nothing to
 * take from returns an empty string, and the caller draws no tile.
 */
export function workstreamAbbreviation(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "";
  const first = (word: string) => Array.from(word)[0] ?? "";
  const letters =
    words.length > 1
      ? [first(words[0]!), first(words[1]!)]
      : Array.from(words[0]!).slice(0, 2);
  return letters.join("").toUpperCase();
}

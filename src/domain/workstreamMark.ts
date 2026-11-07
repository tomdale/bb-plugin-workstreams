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

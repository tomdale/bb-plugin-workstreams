/**
 * Text from GitHub, `gh`, or a workstream's name is untrusted where it reaches
 * a terminal: a check name is set by the pull request's author. These helpers
 * reduce it to printable single-line text.
 */
const TERMINAL_SEQUENCES =
  // OSC (ends at BEL or ST), then CSI and the two-byte escapes.
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
/** Control, line-separator, zero-width, and bidirectional-formatting characters. */
const UNPRINTABLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/** One line with no terminal control sequences, whitespace collapsed. */
export function plainText(text: string): string {
  return text
    .replace(TERMINAL_SEQUENCES, "")
    .replace(UNPRINTABLE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Markdown that `Copy settings` puts on the clipboard: the page state, then every setting the inspector
 * shows, module by module, beside the value it would have with nothing overridden. The page gathers the rows
 * (only what is on screen, so a setting that changes nothing under the current configuration is left out);
 * this file only formats them, so the text has one shape wherever it is pasted.
 */

/** One shown setting: its module, name, hash key, current value and the value the preset or default gives. */
export type CopyRow = {
  module: string;
  label: string;
  key: string;
  value: string;
  base: string;
};

export type CopyState = {
  model: string;
  /** The preset's name, or null for the product, which has none. */
  preset: string | null;
  speed: string;
  reduced: boolean;
  overlay: boolean;
  /** The URL hash that restores this state. */
  hash: string;
  rows: CopyRow[];
  /** What a row's `base` is, per module: the preset's value for a model's settings, the default for the rest. */
  baseName: (module: string) => string;
};

/** Escapes the characters that would end a table cell. */
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export function settingsMarkdown(s: CopyState): string {
  const changed = s.rows.filter((r) => r.value !== r.base);
  const out = [
    "## Queue motion lab settings",
    "",
    `- Model: ${s.model}`,
    ...(s.preset === null ? [] : [`- Preset: \`${s.preset}\``]),
    `- Speed: ${s.speed}`,
    `- Reduced motion: ${s.reduced ? "on" : "off"}`,
    `- Bezier path: ${s.overlay ? "on" : "off"}`,
    `- Hash: \`${s.hash || "#"}\``,
    `- Changed: ${
      changed.length
        ? changed.map((r) => `\`${r.key}\` ${r.base} → ${r.value}`).join(", ")
        : "nothing"
    }`,
  ];
  const modules = [...new Set(s.rows.map((r) => r.module))];
  for (const m of modules) {
    out.push(
      "",
      `### ${m}`,
      "",
      `| Setting | Key | Value | ${s.baseName(m)} |`,
      "| --- | --- | --- | --- |",
    );
    for (const r of s.rows.filter((x) => x.module === m)) {
      const value = r.value === r.base ? cell(r.value) : `**${cell(r.value)}**`;
      out.push(
        `| ${cell(r.label)} | \`${r.key}\` | ${value} | ${cell(r.base)} |`,
      );
    }
  }
  return out.join("\n") + "\n";
}

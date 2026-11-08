/**
 * What the two copy buttons put on the clipboard. `Copy settings` copies Markdown: the page state, then every
 * setting the inspector shows, module by module, beside the value it would have with nothing overridden. The
 * page gathers the rows (only what is on screen, so a setting that changes nothing under the current
 * configuration is left out); this file only formats them, so the text has one shape wherever it is pasted.
 * `Copy as QUEUE_CFG` copies the drum's configuration as the `QUEUE_CFG` literal in `drum.ts`, written in
 * that file's idiom, ready to paste over it.
 */
import type {
  DrumConfig,
  DrumPatch,
  Tempo,
} from "../../../src/app/page/queue/drum.ts";

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
  /** The Cards deck's name. */
  cards: string;
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
    `- Cards: ${s.cards}`,
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

// ---- Copy as QUEUE_CFG -------------------------------------------------------------------------------

const TAU = 2 * Math.PI;
const num = (v: number) => String(Math.round(v * 1000) / 1000);
/** The tempo fields each kind reads; the others change nothing under it, so the literal leaves them out. */
const TEMPO_FIELDS: Record<Tempo["kind"], (keyof Tempo)[]> = {
  none: [],
  constant: ["ms"],
  lookahead: ["window", "scale", "a", "b"],
};

/** One field's value as `drum.ts` writes it: spring rates as `TAU * Hz`, edge budgets as `px/frame * 60`. */
function fieldSource(key: string, v: unknown): string {
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  const n = v as number;
  if (key === "omega0" || key === "omega1") return `TAU * ${num(n / TAU)}`;
  if (key === "vcap" || key === "vcap1") return `${num(n / 60)} * 60`;
  return num(n);
}

/**
 * `cfg` as the `QUEUE_CFG` literal: every field `keep` names (the shipped literal's own fields, in its order),
 * then every other field that differs from `defaults`. `tempo` keeps its kind and the fields that kind reads
 * when either `keep` names them or they differ from the defaults.
 */
export function queueCfgSource(
  cfg: DrumConfig,
  keep: DrumPatch,
  defaults: DrumConfig,
): string {
  const keys = [
    ...Object.keys(keep),
    ...Object.keys(defaults).filter((k) => !(k in keep)),
  ] as (keyof DrumConfig)[];
  const lines: string[] = [];
  for (const key of keys) {
    if (key === "tempo") {
      const t = cfg.tempo;
      const fields = TEMPO_FIELDS[t.kind].filter(
        (f) => f in (keep.tempo ?? {}) || t[f] !== defaults.tempo[f],
      );
      if (!keep.tempo && t.kind === defaults.tempo.kind && !fields.length)
        continue;
      const parts = [
        `kind: ${fieldSource("kind", t.kind)}`,
        ...fields.map((f) => `${f}: ${fieldSource(f, t[f])}`),
      ];
      lines.push(`tempo: { ${parts.join(", ")} }`);
      continue;
    }
    if (key in keep || cfg[key] !== defaults[key])
      lines.push(`${key}: ${fieldSource(key, cfg[key])}`);
  }
  return `export const QUEUE_CFG: DrumPatch = {\n${lines.map((l) => `  ${l},`).join("\n")}\n};\n`;
}

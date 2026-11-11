/**
 * Workstreams draws with its color tokens (src/app/theme/tokens.css) and BB's
 * theme variables, never with Tailwind's palette or literal colors, so the
 * Colors settings and BB's themes restyle every surface. This scans the app's
 * source, except the token module itself, for raw palette classes and color
 * literals; the allowlist names the few literals that are not theme colors,
 * each with its reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;
const APP = join(ROOT, "src/app");

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "Tailwind palette class",
    pattern: new RegExp(
      `(?<![\\w-])[\\w-]*-(?:${PALETTE})-\\d{2,3}\\b|(?<![\\w-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|shadow|caret|accent|placeholder)-(?:white|black)\\b`,
      "g",
    ),
  },
  {
    name: "palette variable",
    pattern: new RegExp(`--color-(?:${PALETTE})-`, "g"),
  },
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b(?![\w-])/g },
  {
    name: "color function",
    // `_` may precede one: Tailwind writes spaces in arbitrary values as `_`.
    pattern:
      /(?<![A-Za-z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g,
  },
];

/**
 * The token module: each token's Workstreams default is the literal shades
 * the app has always drawn with, and lives only here.
 */
const TOKEN_MODULE = "src/app/theme/tokens.css";

/**
 * Literals that are not theme colors. Each entry must still match, so the
 * list shrinks as code changes.
 */
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: "src/app/styles.css",
    text: "oklch(46% 0.16 var(--ws-hue, 250))",
    reason: "a workstream's identity color, from its hue",
  },
  {
    file: "src/app/styles.css",
    text: "oklch(79% 0.13 var(--ws-hue, 250))",
    reason: "a workstream's identity color, from its hue",
  },
  {
    file: "src/app/home/home.css",
    text: "oklch(46% 0.16 var(--ws-hue, 250))",
    reason: "a workstream's identity color, from its hue",
  },
  {
    file: "src/app/home/home.css",
    text: "oklch(79% 0.13 var(--ws-hue, 250))",
    reason: "a workstream's identity color, from its hue",
  },
  {
    file: "src/app/styles.css",
    text: "oklch(64% 0.15 var(--ws-hue, 250))",
    reason: "a workstream's identity color, from its hue",
  },
  {
    file: "src/app/header/ParentLink.tsx",
    text: "oklch(0.72 0.13 ${threadHue(parent.id)})",
    reason: "a thread's identity color, from its hue",
  },
  {
    file: "src/app/Hint.tsx",
    text: "rgb(0_0_0/0.4)",
    reason: "drop shadows, light and dark, on one line",
  },
  {
    file: "src/app/snooze/SnoozeSettings.tsx",
    text: "rgb(0 0 0 / 0.2)",
    reason: "drop shadow",
  },
  {
    file: "src/app/sidebar/dnd.tsx",
    text: "rgb(0 0 0 / 0.25)",
    reason: "drop shadow",
  },
  {
    file: "src/app/debug/Inspector.tsx",
    text: "bg-black/20",
    reason: "dialog scrim, like BB's shared dialogs",
  },
  {
    file: "src/app/settings/SpinnerSettings.tsx",
    text: '"#7c7cff"',
    reason: "a color input's starting value must be #rrggbb",
  },
  {
    file: "src/app/settings/SpinnerSettings.tsx",
    text: "#f55, #fb5, #5d5, #5bf, #a6f, #f55",
    reason: "the rainbow on the custom-color swatch",
  },
  {
    file: "src/app/recap/RecapSettings.tsx",
    text: '{ digits: "#5b7c99", letters: "#86709c" }',
    reason: "a color input's starting value must be #rrggbb",
  },
  {
    file: "src/app/settings/ColorSettings.tsx",
    text: '"#808080"',
    reason: "a color input's starting value must be #rrggbb",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

/** Blanks comments, keeping line numbers, so prose can name colors. */
function stripComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (match, lead: string) => lead + blank(match.slice(lead.length)),
    );
}

type Finding = { file: string; line: number; rule: string; text: string };

function findings(): { found: Finding[]; unused: typeof ALLOWED } {
  const used = new Set<(typeof ALLOWED)[number]>();
  const found: Finding[] = [];
  for (const path of sourceFiles(APP)) {
    const file = relative(ROOT, path);
    if (file === TOKEN_MODULE) continue;
    const lines = stripComments(readFileSync(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        for (const match of line.matchAll(rule.pattern)) {
          const allowed = ALLOWED.find(
            (entry) =>
              entry.file === file &&
              line.includes(entry.text) &&
              entry.text.includes(match[0]),
          );
          if (allowed) {
            used.add(allowed);
            continue;
          }
          found.push({
            file,
            line: index + 1,
            rule: rule.name,
            text: match[0],
          });
        }
      }
    });
  }
  return { found, unused: ALLOWED.filter((entry) => !used.has(entry)) };
}

describe("app colors", () => {
  const { found, unused } = findings();

  it("uses color tokens instead of palette classes and color literals", () => {
    expect(found.map((f) => `${f.file}:${f.line} ${f.rule} ${f.text}`)).toEqual(
      [],
    );
  });

  it("keeps no stale allowlist entries", () => {
    expect(unused.map((entry) => `${entry.file}: ${entry.text}`)).toEqual([]);
  });

  it("catches each kind of raw color", () => {
    const sample = [
      'className="text-amber-700 dark:bg-sky-500/40 [&>p]:border-rose-200"',
      "color: #e0a84f;",
      "background: oklch(0.7 0.1 150);",
      'className="shadow-[0_0_4px_hsl(0_0%_0%)]"',
      "var(--color-violet-500)",
      'className="text-white"',
    ].join("\n");
    const hits = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)]);
    expect(hits.map((hit) => hit[0])).toEqual(
      expect.arrayContaining([
        "text-amber-700",
        "bg-sky-500",
        "border-rose-200",
        "#e0a84f",
        "oklch(",
        "hsl(",
        "--color-violet-",
        "text-white",
      ]),
    );
  });

  it("allows token utilities, theme variables, and color-mix", () => {
    const sample = [
      'className="text-(--ws-complete-text) border-(--ws-review-border)"',
      "color: color-mix(in oklab, var(--ws-needs-you) 20%, transparent);",
      'className="text-muted-foreground bg-background border-border"',
      'href="#main" data-x="#settings"',
    ].join("\n");
    expect(RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)])).toEqual(
      [],
    );
  });
});

/* Workstreams semantic colors follow BB's active theme. Custom hex choices bypass vivid enhancement. */
import { z } from "zod";
import { colorCss, vividPalette, type Palette } from "./vivid.ts";

export const COLOR_TOKENS = [
  "complete",
  "review",
  "waiting",
  "needsYou",
  "failure",
  "suggestion",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Each token's name in settings. */
export const COLOR_TOKEN_LABEL: Record<ColorToken, string> = {
  complete: "Complete",
  review: "Review",
  waiting: "Waiting",
  needsYou: "Needs you",
  failure: "Failure",
  suggestion: "Suggestions",
};

/** The CSS custom property that carries each token. */
export const COLOR_TOKEN_VAR: Record<ColorToken, string> = {
  complete: "--ws-complete",
  review: "--ws-review",
  waiting: "--ws-waiting",
  needsYou: "--ws-needs-you",
  failure: "--ws-failure",
  suggestion: "--ws-suggestion",
};

/**
 * BB theme colors a token can follow. `text` names BB's own text-safe twin of
 * the color where BB defines one; without it the token's text step is derived.
 */
export const THEME_COLORS = {
  success: {
    label: "Success",
    base: "--success",
    text: "--success-foreground",
  },
  "timeline-accent": {
    label: "Timeline blue",
    base: "--timeline-accent",
    text: "--timeline-accent",
  },
  attention: { label: "Attention", base: "--attention", text: null },
  warning: { label: "Warning", base: "--warning", text: "--warning-text" },
  destructive: {
    label: "Destructive",
    base: "--destructive",
    text: "--destructive-text",
  },
  "pr-merged": {
    label: "Purple",
    base: "--pr-merged",
    text: "--pr-merged",
  },
  foreground: { label: "Text", base: "--foreground", text: "--foreground" },
  "muted-foreground": {
    label: "Muted text",
    base: "--muted-foreground",
    text: "--muted-foreground",
  },
} as const satisfies Record<
  string,
  { label: string; base: string; text: string | null }
>;
export type ThemeColor = keyof typeof THEME_COLORS;
const THEME_COLOR_IDS = Object.keys(THEME_COLORS) as [
  ThemeColor,
  ...ThemeColor[],
];

/** The only custom color syntax accepted, so a value can never carry CSS. */
export const CUSTOM_COLOR = /^#[0-9a-f]{6}$/;

export const colorChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }).strict(),
  z
    .object({ kind: z.literal("theme"), color: z.enum(THEME_COLOR_IDS) })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      color: z
        .string()
        .transform((value) => value.toLowerCase())
        .pipe(z.string().regex(CUSTOM_COLOR, "Use a #rrggbb color.")),
    })
    .strict(),
]);
export type ColorChoice = z.infer<typeof colorChoiceSchema>;

/** Each default follows its matching BB semantic color. */
export const DEFAULT_COLORS = {
  complete: { kind: "default" },
  review: { kind: "default" },
  waiting: { kind: "default" },
  needsYou: { kind: "default" },
  failure: { kind: "default" },
  suggestion: { kind: "default" },
} as const satisfies Record<ColorToken, ColorChoice>;

/** The semantic BB theme color for each default token. */
export const THEME_MATCH: Record<ColorToken, ThemeColor> = {
  complete: "success",
  review: "timeline-accent",
  waiting: "pr-merged",
  needsYou: "attention",
  failure: "destructive",
  suggestion: "pr-merged",
};

export type ColorPrefs = Record<ColorToken, ColorChoice> & {
  vivid: boolean;
};

/** What a token draws with now, after the set's default applies. */
type ResolvedColor =
  | { kind: "theme"; color: ThemeColor; byDefault: boolean }
  | { kind: "custom"; color: string };

export function resolveColor(
  colors: ColorPrefs,
  token: ColorToken,
): ResolvedColor {
  const choice = colors[token];
  if (choice.kind === "custom") return choice;
  if (choice.kind === "theme")
    return { kind: "theme", color: choice.color, byDefault: false };
  return { kind: "theme", color: THEME_MATCH[token], byDefault: true };
}

/** Text without a BB text twin uses the appearance's lightness band. */
export function derivedText(color: string): string {
  return `oklch(from ${color} clamp(var(--ws-text-min-l), l, var(--ws-text-max-l)) c h)`;
}

function stepDeclarations(name: string, color: string, text: string | null) {
  const textColor = derivedText(`var(${name})`);
  const mix = (source: string, percent: number) =>
    `color-mix(in oklab, var(${source}) ${percent}%, transparent)`;
  return [
    `${name}: ${color};`,
    `${name}-text: ${text ? `var(${text})` : textColor};`,
    `${name}-strong: var(${name}-text);`,
    `${name}-on-strong: var(--canvas);`,
    `${name}-soft: var(${name}-text);`,
    `${name}-mark: var(${name}-text);`,
    `${name}-band: var(${name});`,
    `${name}-border: ${mix(name, 75)};`,
    `${name}-surface: ${mix(name, 6)};`,
    `${name}-footer: ${mix(name, 4)};`,
    `${name}-rule: ${mix(`${name}-text`, 16)};`,
  ];
}

/**
 * Workstreams' DOM: every plugin slot root and every portal it scopes with
 * `usePortalScopeProps`. Matches BB's own utility scoping
 * (`pluginScopeRoots`), so tokens reach everything Tailwind classes reach.
 */
export const TOKEN_ROOTS =
  '[data-bb-plugin="workstreams"], [data-bb-plugin-root]:not([data-bb-plugin])';

/**
 * Token declarations use validated choices. Resolved theme paints are optional,
 * so normal theme CSS also works before the browser can resolve vivid inputs.
 */
function colorTokenDeclarations(
  colors: ColorPrefs,
  palettes?: Partial<Record<ThemeColor, Palette>>,
  dark = false,
): string[] {
  const lines: string[] = [];
  for (const token of COLOR_TOKENS) {
    const parsed = colorChoiceSchema.safeParse(colors[token]);
    if (!parsed.success) continue;
    const resolved = resolveColor(
      {
        ...colors,
        [token]: parsed.data,
      },
      token,
    );
    const name = COLOR_TOKEN_VAR[token];
    if (resolved.kind === "custom")
      lines.push(...stepDeclarations(name, resolved.color, null));
    else if (resolved.kind === "theme") {
      const theme = THEME_COLORS[resolved.color];
      lines.push(...stepDeclarations(name, `var(${theme.base})`, theme.text));
      const input = palettes?.[resolved.color];
      if (colors.vivid && input) {
        const paints = vividPalette(input, dark);
        lines.push(`${name}: ${colorCss({ ...paints.border, alpha: 1 })};`);
        for (const role of ["text", "border", "surface"] as const)
          lines.push(`${name}-${role}: ${colorCss(paints[role])};`);
      }
    }
  }
  return lines;
}

/**
 * Scoped CSS for normal or vivid paints. Custom choices bypass the transform.
 */
export function colorTokenCss(
  colors: ColorPrefs,
  palettes?: Partial<Record<ThemeColor, Palette>>,
  dark = false,
  selector = TOKEN_ROOTS,
): string {
  const lines = colorTokenDeclarations(colors, palettes, dark);
  return lines.length ? `${selector} {\n  ${lines.join("\n  ")}\n}\n` : "";
}

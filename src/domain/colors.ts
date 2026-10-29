/**
 * Workstreams' color tokens: the few semantic colors its UI draws with. Each
 * token keeps its Workstreams default (the shades it has always used, per
 * mode), follows one of BB's theme colors, so BB's light and dark modes and
 * custom palettes restyle it, or uses a custom `#rrggbb` the user picks.
 *
 * The app's stylesheet (src/app/theme/tokens.css) declares every token's
 * default steps. {@link colorTokenCss} writes the user's other choices over
 * them, deriving every step from one color.
 */
import { z } from "zod";

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
    label: "Merged purple",
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

/** Every token starts at its Workstreams default. */
export const DEFAULT_COLORS = {
  complete: { kind: "default" },
  review: { kind: "default" },
  waiting: { kind: "default" },
  needsYou: { kind: "default" },
  failure: { kind: "default" },
  suggestion: { kind: "default" },
} as const satisfies Record<ColorToken, ColorChoice>;

export type ColorPrefs = Record<ColorToken, ColorChoice>;

export const sameChoice = (a: ColorChoice, b: ColorChoice): boolean =>
  a.kind === b.kind &&
  (a.kind === "default" || a.color === (b as { color?: string }).color);

/**
 * Every step of a token chosen as one color (see tokens.css for what each
 * step draws). Text uses BB's text-safe twin of a theme color where there is
 * one; otherwise it keeps the color's hue and chroma and clamps its lightness
 * into the current mode's readable band.
 */
function stepDeclarations(name: string, color: string, text: string | null) {
  const derivedText = `oklch(from var(${name}) clamp(var(--ws-text-min-l), l, var(--ws-text-max-l)) c h)`;
  const mix = (source: string, percent: number) =>
    `color-mix(in oklab, var(${source}) ${percent}%, transparent)`;
  return [
    `${name}: ${color};`,
    `${name}-text: ${text ? `var(${text})` : derivedText};`,
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
 * The declarations that override tokens.css's defaults for the user's
 * choices; tokens left at their Workstreams default are omitted. Every value comes from
 * {@link THEME_COLORS} or a re-validated `#rrggbb`, never from raw input.
 */
export function colorTokenDeclarations(colors: ColorPrefs): string[] {
  const lines: string[] = [];
  for (const token of COLOR_TOKENS) {
    const parsed = colorChoiceSchema.safeParse(colors[token]);
    if (!parsed.success || parsed.data.kind === "default") continue;
    const choice = parsed.data;
    const name = COLOR_TOKEN_VAR[token];
    if (choice.kind === "custom")
      lines.push(...stepDeclarations(name, choice.color, null));
    else {
      const theme = THEME_COLORS[choice.color];
      lines.push(...stepDeclarations(name, `var(${theme.base})`, theme.text));
    }
  }
  return lines;
}

/**
 * The stylesheet that applies `colors`, or "" when every token is at its
 * default. The selector carries real specificity so it outranks tokens.css's
 * zero-specificity defaults whichever loads last.
 */
export function colorTokenCss(colors: ColorPrefs): string {
  const lines = colorTokenDeclarations(colors);
  return lines.length ? `${TOKEN_ROOTS} {\n  ${lines.join("\n  ")}\n}\n` : "";
}

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

/** BB draws its theme in one of two appearances. */
export type Appearance = "light" | "dark";

/**
 * BB's theme colors as the browser resolved them under each appearance. Vivid
 * paints are computed from these, so they exist only once the page has them.
 */
export type ThemePalettes = Partial<
  Record<Appearance, Partial<Record<ThemeColor, Palette>>>
>;

/**
 * Where BB defines each appearance's theme variables: its stylesheet and every
 * BB theme declare them on `:root, .light` and on `.dark`.
 */
export const APPEARANCE_SCOPES: Record<Appearance, string> = {
  light: ":root, .light",
  dark: ".dark",
};

/** The lightness band for derived text in each appearance. */
const TEXT_BAND: Record<Appearance, { min: number; max: number }> = {
  light: { min: 0, max: 0.55 },
  dark: { min: 0.78, max: 1 },
};

/** Each token's validated, resolved choice; invalid stored values are skipped. */
function resolvedTokens(colors: ColorPrefs) {
  return COLOR_TOKENS.flatMap((token) => {
    const parsed = colorChoiceSchema.safeParse(colors[token]);
    if (!parsed.success) return [];
    const resolved = resolveColor({ ...colors, [token]: parsed.data }, token);
    return [{ name: COLOR_TOKEN_VAR[token], resolved }];
  });
}

/** Every step of every token, written in terms of BB's theme variables. */
function baseDeclarations(colors: ColorPrefs): string[] {
  return resolvedTokens(colors).flatMap(({ name, resolved }) => {
    if (resolved.kind === "custom")
      return stepDeclarations(name, resolved.color, null);
    const theme = THEME_COLORS[resolved.color];
    return stepDeclarations(name, `var(${theme.base})`, theme.text);
  });
}

/** Vivid overrides for theme-following tokens whose inputs were resolved. */
function vividDeclarations(
  colors: ColorPrefs,
  palettes: Partial<Record<ThemeColor, Palette>> | undefined,
  dark: boolean,
): string[] {
  if (!colors.vivid || !palettes) return [];
  return resolvedTokens(colors).flatMap(({ name, resolved }) => {
    const input = resolved.kind === "theme" ? palettes[resolved.color] : null;
    if (!input) return [];
    const paints = vividPalette(input, dark);
    return [
      `${name}: ${colorCss({ ...paints.border, alpha: 1 })};`,
      ...(["text", "border", "surface"] as const).map(
        (role) => `${name}-${role}: ${colorCss(paints[role])};`,
      ),
    ];
  });
}

/**
 * Workstreams' roots inside an `@scope`, the scope's own root included: a
 * scoped selector without `:scope` matches only the scope's descendants.
 */
const SCOPED_ROOTS = `:where(:scope, :scope *):is(${TOKEN_ROOTS})`;

const rule = (selector: string, lines: readonly string[], indent = "") =>
  `${indent}${selector} {\n${indent}  ${lines.join(`\n${indent}  `)}\n${indent}}\n`;

/**
 * The token sheet: every token's steps on Workstreams' roots, then each
 * appearance's text band and vivid paints in an `@scope` for that appearance.
 * Scope proximity lets the nearest `.light` or `.dark` ancestor win, so a root
 * draws its own appearance's paints wherever it mounts; the rules name no
 * particular root, and the sheet never changes as roots come and go. Custom
 * choices bypass the vivid transform.
 */
export function colorTokenCss(
  colors: ColorPrefs,
  palettes?: ThemePalettes,
): string {
  const base = baseDeclarations(colors);
  let css = base.length ? rule(TOKEN_ROOTS, base) : "";
  for (const appearance of ["light", "dark"] as const) {
    const band = TEXT_BAND[appearance];
    const lines = [
      `--ws-text-min-l: ${band.min};`,
      `--ws-text-max-l: ${band.max};`,
      ...vividDeclarations(
        colors,
        palettes?.[appearance],
        appearance === "dark",
      ),
    ];
    css += `@scope (${APPEARANCE_SCOPES[appearance]}) {\n${rule(SCOPED_ROOTS, lines, "  ")}}\n`;
  }
  return css;
}

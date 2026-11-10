import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_VAR,
  DEFAULT_COLORS,
  colorChoiceSchema,
  colorTokenCss,
  resolveColor,
  type ColorPrefs,
} from "../../src/domain/colors.ts";
import {
  mergePrefs,
  parsePrefs,
  prefsPatchSchema,
} from "../../src/domain/prefs.ts";

const STEPS = [
  "text",
  "strong",
  "on-strong",
  "soft",
  "mark",
  "band",
  "border",
  "surface",
  "footer",
  "rule",
];

describe("color choices", () => {
  it("accepts the Workstreams default, theme colors, and #rrggbb, lowercased", () => {
    expect(colorChoiceSchema.parse({ kind: "default" })).toEqual({
      kind: "default",
    });
    expect(
      colorChoiceSchema.parse({ kind: "custom", color: "#A1B2C3" }),
    ).toEqual({ kind: "custom", color: "#a1b2c3" });
    expect(
      colorChoiceSchema.parse({ kind: "theme", color: "warning" }),
    ).toEqual({ kind: "theme", color: "warning" });
  });

  it.each([
    "red",
    "#fff",
    "#12345g",
    "#1234567",
    "oklch(0.7 0.1 150)",
    "var(--success)",
    "#123456; } body { display: none",
    "#123456\n",
    " #123456",
  ])("refuses the custom color %j", (color) => {
    expect(colorChoiceSchema.safeParse({ kind: "custom", color }).success).toBe(
      false,
    );
  });

  it("refuses unknown theme colors and extra fields", () => {
    for (const value of [
      { kind: "theme", color: "background" },
      { kind: "theme", color: "success", extra: 1 },
      { kind: "custom", color: "#123456", css: "x" },
      { kind: "other", color: "#123456" },
      { kind: "default", color: "#123456" },
    ])
      expect(colorChoiceSchema.safeParse(value).success).toBe(false);
  });

  it("validates color patches at the preferences boundary", () => {
    expect(
      prefsPatchSchema.safeParse({
        colors: { review: { kind: "custom", color: "#336699" } },
      }).success,
    ).toBe(true);
    expect(
      prefsPatchSchema.safeParse({
        colors: { review: { kind: "custom", color: "red;}" } },
      }).success,
    ).toBe(false);
    expect(
      prefsPatchSchema.safeParse({
        colors: { accent: { kind: "theme", color: "success" } },
      }).success,
    ).toBe(false);
  });

  it("falls back to the default for one bad stored token, keeping the rest", () => {
    const prefs = parsePrefs({
      colors: {
        complete: { kind: "custom", color: "url(x)" },
        failure: { kind: "custom", color: "#aa0000" },
      },
    });
    expect(prefs.colors.complete).toEqual(DEFAULT_COLORS.complete);
    expect(prefs.colors.failure).toEqual({ kind: "custom", color: "#aa0000" });
    expect(prefs.colors.review).toEqual(DEFAULT_COLORS.review);
    expect(prefs.colors.vivid).toBe(true);
    expect(parsePrefs({ colors: { vivid: "neon" } }).colors.vivid).toBe(true);
  });

  it("merges one token without touching the others", () => {
    const base = mergePrefs(parsePrefs({}), {
      colors: { waiting: { kind: "theme", color: "muted-foreground" } },
    });
    const next = mergePrefs(base, {
      colors: { review: { kind: "custom", color: "#336699" } },
    });
    expect(next.colors.waiting).toEqual({
      kind: "theme",
      color: "muted-foreground",
    });
    expect(next.colors.review).toEqual({ kind: "custom", color: "#336699" });
  });
});

describe("colorTokenCss", () => {
  const defaults: ColorPrefs = { ...DEFAULT_COLORS, vivid: true };

  it("follows semantic theme colors for all defaults", () => {
    const css = colorTokenCss(defaults);
    for (const token of COLOR_TOKENS)
      for (const step of ["", ...STEPS])
        expect(css).toContain(
          `${COLOR_TOKEN_VAR[token]}${step ? `-${step}` : ""}:`,
        );
  });

  it("writes every step of a custom color, deriving its text", () => {
    const css = colorTokenCss({
      ...defaults,
      complete: { kind: "custom", color: "#228833" },
    });
    expect(css).toContain("--ws-complete: #228833;");
    expect(css).toContain(
      "--ws-complete-text: oklch(from var(--ws-complete) clamp(",
    );
    for (const step of STEPS) expect(css).toContain(`--ws-complete-${step}:`);
    expect(css).toContain("--ws-review: var(--timeline-accent);");
  });

  it("uses BB's text twin for a theme color that has one, else derives", () => {
    const css = colorTokenCss({
      ...defaults,
      review: { kind: "theme", color: "destructive" },
      complete: { kind: "theme", color: "attention" },
    });
    expect(css).toContain("--ws-review: var(--destructive);");
    expect(css).toContain("--ws-review-text: var(--destructive-text);");
    expect(css).toContain("--ws-complete: var(--attention);");
    expect(css).toContain("--ws-complete-text: oklch(from var(--ws-complete)");
  });

  it("draws defaulted tokens in their matching theme colors when the set follows the bb theme", () => {
    const css = colorTokenCss({
      ...defaults,
      vivid: false,
      failure: { kind: "custom", color: "#aa0000" },
    });
    expect(css).toContain("--ws-complete: var(--success);");
    expect(css).toContain("--ws-complete-text: var(--success-foreground);");
    expect(css).toContain("--ws-review: var(--timeline-accent);");
    expect(css).toContain("--ws-needs-you: var(--attention);");
    // A token the user set keeps that choice.
    expect(css).toContain("--ws-failure: #aa0000;");
    expect(css).not.toContain("--ws-failure: var(--destructive);");
  });

  it("resolves what each token draws with for its caption", () => {
    const colors: ColorPrefs = {
      ...defaults,
      review: { kind: "theme", color: "warning" },
    };
    expect(resolveColor(colors, "complete")).toEqual({
      kind: "theme",
      color: "success",
      byDefault: true,
    });
    expect(resolveColor(colors, "review")).toEqual({
      kind: "theme",
      color: "warning",
      byDefault: false,
    });
  });

  it("outranks the zero-specificity defaults with a scoped selector", () => {
    const css = colorTokenCss({
      ...defaults,
      failure: { kind: "custom", color: "#aa0000" },
    });
    expect(css.startsWith('[data-bb-plugin="workstreams"], ')).toBe(true);
  });

  it("drops values that bypassed validation instead of writing them", () => {
    const css = colorTokenCss({
      ...defaults,
      failure: { kind: "custom", color: "red; } * { color: red" },
      review: { kind: "theme", color: "nope" },
    } as unknown as ColorPrefs);
    expect(css).not.toContain("red; }");
    expect(css).not.toContain("nope");
  });
});

describe("theme fallbacks", () => {
  const css = readFileSync(
    new URL("../../src/app/theme/tokens.css", import.meta.url),
    "utf8",
  );
  const declarations = (source: string) =>
    Object.fromEntries(
      [...source.matchAll(/(--ws-[\w-]+):\s*([^;]+);/g)].map((match) => [
        match[1],
        match[2]!.replace(/\s+/g, ""),
      ]),
    );
  it("matches the normal palette before preferences load", () => {
    expect(declarations(css)).toMatchObject(
      declarations(colorTokenCss({ ...DEFAULT_COLORS, vivid: false })),
    );
  });
  it("keeps commit-hash and merged-PR defaults independent of vivid colors", () => {
    expect(declarations(css)).toMatchObject({
      "--ws-hash-digits":
        "color-mix(inoklab,oklch(95.1%0.026236.824)75%,transparent)",
      "--ws-hash-letters":
        "color-mix(inoklab,oklch(89.4%0.057293.283)70%,transparent)",
      "--ws-pr-merged": "#8e4ec6",
    });
    expect(colorTokenCss({ ...DEFAULT_COLORS, vivid: true })).not.toMatch(
      /--ws-(hash|pr-merged)/,
    );
  });
});

describe("vivid preference migration", () => {
  it("maps existing schemes while preserving token overrides", () => {
    for (const [scheme, vivid] of [
      ["workstreams", true],
      ["theme", false],
    ] as const) {
      const colors = parsePrefs({
        colors: {
          scheme,
          review: { kind: "custom", color: "#123456" },
          waiting: { kind: "theme", color: "warning" },
        },
      }).colors;
      expect(colors.vivid).toBe(vivid);
      expect(colors.review).toEqual({ kind: "custom", color: "#123456" });
      expect(colors.waiting).toEqual({ kind: "theme", color: "warning" });
      expect(colors).not.toHaveProperty("scheme");
    }
  });
  it("gives a saved vivid choice precedence and sanitizes bad fields independently", () => {
    expect(
      parsePrefs({ colors: { scheme: "theme", vivid: true } }).colors.vivid,
    ).toBe(true);
    expect(
      parsePrefs({ colors: { scheme: "workstreams", vivid: false } }).colors
        .vivid,
    ).toBe(false);
    expect(
      prefsPatchSchema.safeParse({ colors: { scheme: "theme" } }).success,
    ).toBe(false);
    expect(
      mergePrefs(parsePrefs({}), { colors: { vivid: false } }).colors.vivid,
    ).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_VAR,
  DEFAULT_COLORS,
  colorChoiceSchema,
  colorTokenCss,
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

const tokensCss = readFileSync(
  new URL("../../src/app/theme/tokens.css", import.meta.url),
  "utf8",
);

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
  const defaults: ColorPrefs = { ...DEFAULT_COLORS };

  it("adds nothing while every token is at its default", () => {
    expect(colorTokenCss(defaults)).toBe("");
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
    expect(css).not.toContain("--ws-review");
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
    expect(css).toBe("");
  });
});

describe("tokens.css", () => {
  const block = (dark: boolean) => {
    const at = tokensCss.indexOf(
      dark
        ? '.dark [data-bb-plugin="workstreams"]'
        : ':where(\n  [data-bb-plugin="workstreams"]',
    );
    expect(at, dark ? "dark block" : "light block").toBeGreaterThan(-1);
    return tokensCss.slice(at, tokensCss.indexOf("\n}", at));
  };
  const declared = (css: string, name: string) =>
    css.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1]?.trim();

  it.each(COLOR_TOKENS)(
    "declares every step of %s's default in light and dark",
    (token) => {
      const v = COLOR_TOKEN_VAR[token];
      for (const css of [block(false), block(true)])
        for (const step of ["", ...STEPS]) {
          const name = step ? `${v}-${step}` : v;
          expect(declared(css, name), name).toBeTruthy();
        }
    },
  );

  it("keeps today's recap and question shades per mode", () => {
    expect(declared(block(false), "--ws-review-text")).toBe(
      "oklch(50% 0.134 242.749)",
    );
    expect(declared(block(true), "--ws-review-text")).toBe(
      "oklch(82.8% 0.111 230.318)",
    );
    expect(declared(block(false), "--ws-needs-you-mark")).toBe(
      "var(--warning-text)",
    );
    expect(declared(block(false), "--ws-needs-you-band")).toBe(
      "var(--attention)",
    );
  });

  it("mixes translucent steps in oklab", () => {
    for (const match of tokensCss.matchAll(
      /color-mix\(\s*in (\w+),[^;]*transparent\s*\)/g,
    ))
      expect(match[1]).toBe("oklab");
  });

  it("confines token declarations to Workstreams' roots with zero specificity", () => {
    expect(tokensCss).not.toContain("@scope");
    expect(tokensCss).toMatch(
      /:where\(\s*\[data-bb-plugin="workstreams"\],\s*\[data-bb-plugin-root\]:not\(\[data-bb-plugin\]\)\s*\)\s*\{/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  colorTokenCss,
  DEFAULT_COLORS,
  type ColorPrefs,
} from "../../src/domain/colors.ts";
import {
  enhanceBase,
  fromRgb,
  hueStrength,
  linearRgb,
  vividPalette,
  type Color,
  type Palette,
} from "../../src/domain/vivid.ts";

const palette = (color: Color): Palette => ({
  text: color,
  border: { ...color, alpha: 0.75 },
  surface: { ...color, alpha: 0.06 },
});
const inputs = {
  light: fromRgb([64 / 255, 117 / 255, 170 / 255]),
  dark: fromRgb([121 / 255, 169 / 255, 219 / 255]),
};
const targets = {
  light: {
    text: [0.5, 0.134, 242.749, 1],
    border: [0.746, 0.16, 232.661, 1],
    surface: [0.977, 0.013, 236.62, 0.4],
  },
  dark: {
    text: [0.828, 0.111, 230.318, 1],
    border: [0.685, 0.169, 237.323, 0.8],
    surface: [0.293, 0.066, 243.157, 0.15],
  },
};

describe("vivid colors", () => {
  it.each(["light", "dark"] as const)(
    "matches all approved BB blue channels in %s",
    (mode) => {
      const result = vividPalette(palette(inputs[mode]), mode === "dark");
      for (const role of ["text", "border", "surface"] as const)
        [
          result[role].L,
          result[role].C,
          result[role].h,
          result[role].alpha,
        ].forEach((channel, i) =>
          expect(channel).toBeCloseTo(targets[mode][role][i]!, 10),
        );
    },
  );
  it("uses one bounded shift and multiplier before blue corrections", () => {
    for (let h = 0; h < 360; h += 5)
      for (const L of [0.4, 0.75]) {
        const input = palette(
          fromRgb(
            linearRgb({ L, C: 0.04, h, alpha: 1 }).map((x) =>
              x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055,
            ),
          ),
        );
        const base = enhanceBase(input);
        expect(Math.abs(base.shift)).toBeLessThanOrEqual(0.08);
        expect(base.multiplier).toBeGreaterThanOrEqual(1);
        expect(base.multiplier).toBeLessThanOrEqual(2);
        for (const role of ["text", "border", "surface"] as const) {
          expect(base.steps[role].L - input[role].L).toBeCloseTo(
            base.shift,
            12,
          );
          expect(base.steps[role].C / input[role].C).toBeCloseTo(
            base.multiplier,
            12,
          );
          expect(base.steps[role].h).toBe(input[role].h);
          expect(base.steps[role].alpha).toBe(input[role].alpha);
          expect(
            linearRgb(base.steps[role]).every(
              (x) => x >= -1e-6 && x <= 1.000001,
            ),
          ).toBe(true);
        }
        for (const color of Object.values(vividPalette(input, L > 0.5)))
          expect(Object.values(color).every(Number.isFinite)).toBe(true);
      }
  });
  it("smoothly softens purple periodically and fades for near-neutrals", () => {
    const color = { L: 0.6, C: 0.1, h: 295, alpha: 1 };
    expect(hueStrength(color)).toBe(0.5);
    expect(hueStrength({ ...color, h: 115 })).toBeGreaterThan(0.99999);
    expect(hueStrength({ ...color, C: 0.001 })).toBe(1);
    for (let h = -1; h <= 360; h++) {
      expect(hueStrength({ ...color, h })).toBeCloseTo(
        hueStrength({ ...color, h: h + 360 }),
        12,
      );
      expect(
        Math.abs(
          hueStrength({ ...color, h }) - hueStrength({ ...color, h: h + 0.01 }),
        ),
      ).toBeLessThan(0.001);
    }
  });
  it("leaves neutral inputs unchanged", () => {
    for (const channel of [0, 0.2, 0.5, 0.8, 1])
      for (const dark of [false, true]) {
        const input = palette(fromRgb([channel, channel, channel]));
        expect(vividPalette(input, dark)).toEqual(input);
      }
  });
  it("maps identical families identically across token identities and bypasses exact overrides", () => {
    const colors: ColorPrefs = {
      ...DEFAULT_COLORS,
      vivid: true,
      complete: { kind: "theme", color: "timeline-accent" },
      review: { kind: "theme", color: "success" },
      failure: { kind: "custom", color: "#123456" },
    };
    for (const dark of [false, true]) {
      const paints = {
        success: palette(inputs.light),
        "timeline-accent": palette(inputs.dark),
      };
      const palettes = { [dark ? "dark" : "light"]: paints };
      const css = colorTokenCss(colors, palettes);
      const swapped = colorTokenCss(
        { ...colors, complete: colors.review, review: colors.complete },
        palettes,
      );
      const declarations = (text: string, token: string) =>
        [
          ...text.matchAll(
            new RegExp(`--ws-${token}(-[\\w-]+)?: ([^;]+);`, "g"),
          ),
        ].map(
          (m) =>
            `${m[1] ?? ""}: ${m[2]!.replaceAll(`--ws-${token}`, "--TOKEN")}`,
        );
      expect(declarations(css, "complete")).toEqual(
        declarations(swapped, "review"),
      );
      expect(declarations(css, "review")).toEqual(
        declarations(swapped, "complete"),
      );
      expect(declarations(css, "failure")).toEqual(
        declarations(colorTokenCss({ ...colors, vivid: false }), "failure"),
      );
    }
  });
});

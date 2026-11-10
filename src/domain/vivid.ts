export type Color = { L: number; C: number; h: number; alpha: number };
export type Palette = Record<"text" | "border" | "surface", Color>;
export const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** Converts resolved sRGB channels in [0, 1] to OKLCH. */
export function fromRgb(rgb: readonly number[], alpha = 1): Color {
  const [r = 0, g = 0, b = 0] = rgb.map((x) =>
    x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: C < 1e-5 ? 0 : C,
    h: C < 1e-5 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
    alpha,
  };
}

export function linearRgb({ L, C, h }: Color): number[] {
  const a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const smoothChroma = (C: number) => {
  const x = clamp((C - 0.004) / 0.016, 0, 1);
  return x * x * (3 - 2 * x);
};
const hueWeight = (h: number, center: number, width: number) =>
  Math.exp(
    (Math.cos(((h - center) * Math.PI) / 180) - 1) /
      ((width * Math.PI) / 180) ** 2,
  );
export const hueStrength = (color: Color) =>
  1 - 0.5 * smoothChroma(color.C) * hueWeight(color.h, 295, 22);
const fits = (color: Color) =>
  color.L >= 0 &&
  color.L <= 1 &&
  linearRgb(color).every((x) => x >= -1e-6 && x <= 1.000001);
const roles = ["text", "border", "surface"] as const;
function mapPalette(
  input: Palette,
  fn: (color: Color, role: keyof Palette) => Color,
): Palette {
  return Object.fromEntries(
    roles.map((role) => [role, fn(input[role], role)]),
  ) as Palette;
}

/** One coordinated lightness shift and chroma multiplier for all three paints. */
export function enhanceBase(input: Palette): {
  steps: Palette;
  shift: number;
  multiplier: number;
} {
  const neutral = roles.every((role) => input[role].C === 0);
  const candidate = (shift: number) => {
    if (
      !roles.every((role) => fits({ ...input[role], L: input[role].L + shift }))
    )
      return null;
    const multiplier = Math.min(
      ...roles.map((role) => {
        const color = { ...input[role], L: input[role].L + shift };
        if (color.C === 0 || fits({ ...color, C: color.C * 2 })) return 2;
        let lo = 1,
          hi = 2;
        for (let i = 0; i < 28; i++) {
          const mid = (lo + hi) / 2;
          if (fits({ ...color, C: color.C * mid })) lo = mid;
          else hi = mid;
        }
        return lo;
      }),
    );
    return { shift, multiplier, score: multiplier - 0.8 * Math.abs(shift) };
  };
  let best = candidate(0);
  if (!neutral)
    for (let i = -80; i <= 80; i++) {
      const option = candidate(i / 1000);
      if (option && (!best || option.score > best.score + 1e-8)) best = option;
    }
  const intensity = neutral ? 0 : hueStrength(input.border);
  const shift = (best?.shift ?? 0) * intensity;
  const multiplier = 1 + ((best?.multiplier ?? 1) - 1) * intensity;
  return {
    steps: mapPalette(input, (color) => ({
      ...color,
      L: color.L + shift,
      C: color.C * multiplier,
    })),
    shift,
    multiplier,
  };
}

/**
 * Blue corrections match Workstreams Review text, border, and surface targets
 * at BB's default theme inputs. These offsets use theme colors resolved to 8-bit sRGB.
 */
const BLUE = {
  light: {
    anchorWeight: 0.9999743301278011,
    deltas: {
      text: [
        -0.12426548749792943, -0.039465813438658265, -7.379974019515316, 0,
      ],
      border: [
        0.12173451250207057, -0.01346581343865827, -17.467974019515395, 0.25,
      ],
      surface: [
        0.35273451250207055, -0.16046581343865826, -13.508974019515335, 0.34,
      ],
    },
  },
  dark: {
    anchorWeight: 0.9999655330399829,
    deltas: {
      text: [
        -0.0027146600447551794, 0.023326634116212164, -19.831448946687487, 0,
      ],
      border: [
        0.007874358966418304, -0.004004695595564017, -12.826448946687492, 0.05,
      ],
      surface: [
        -0.38412564103358177, -0.10700469559556403, -6.992448946687546, 0.09,
      ],
    },
  },
} as const;

/** Depends only on resolved input paints and appearance, never on token identity. */
export function vividPalette(input: Palette, dark: boolean): Palette {
  const base = enhanceBase(input).steps;
  const text = { ...base.text };
  if (dark) {
    text.L += Math.min(
      0.16 * hueWeight(text.h, 245, 18) * smoothChroma(text.C),
      Math.max(0, 0.9 - text.L),
    );
    if (!fits(text)) {
      let lo = 0,
        hi = text.C;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (fits({ ...text, C: mid })) lo = mid;
        else hi = mid;
      }
      text.C = lo;
    }
  }
  // Blue calibration adjusts hue and alpha after the shared transform and text
  // lift. The browser maps calibrated paints to the display gamut to match the targets.
  const calibration = BLUE[dark ? "dark" : "light"];
  const weight =
    Math.min(1, hueWeight(input.border.h, 250, 18) / calibration.anchorWeight) *
    smoothChroma(input.border.C);
  return mapPalette({ ...base, text }, (color, role) => {
    const [L, C, h, alpha] = calibration.deltas[role];
    return {
      L: clamp(color.L + L * weight, 0, 1),
      C: Math.max(0, color.C + C * weight),
      h: (color.h + h * weight + 360) % 360,
      alpha: clamp(color.alpha + alpha * weight, 0, 1),
    };
  });
}

export const colorCss = (color: Color) =>
  `oklch(${color.L.toFixed(7)} ${color.C.toFixed(7)} ${color.h.toFixed(5)} / ${color.alpha.toFixed(5)})`;

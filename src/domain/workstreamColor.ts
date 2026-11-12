import { workstreamHue } from "./workstreamHue.ts";

/** A persisted topic color: hue plus one of the prototype's lightness steps. */
export type TopicColor = { hue: number; level: -1 | 0 | 1 };
type Sample = {
  lightness: number;
  chroma: number;
  hue: number;
  lab: number[];
  rgb: number[];
};
const OFFSETS = [0, -8, 8, -16, 16, -24, 24] as const;
const LEVELS = [0, -1, 1] as const;
const normalizeHue = (hue: number) => ((hue % 360) + 360) % 360;

/** Convert OKLCH to linear sRGB so selection compares in-gamut colors. */
function linearRgb(lightness: number, chroma: number, hue: number): number[] {
  const angle = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(angle),
    b = chroma * Math.sin(angle);
  const ll = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mm = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const ss = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = ll ** 3,
    m = mm ** 3,
    s = ss ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function sample(lightness: number, targetChroma: number, hue: number): Sample {
  let lo = 0,
    hi = targetChroma;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (linearRgb(lightness, mid, hue).every((x) => x >= 0 && x <= 1)) lo = mid;
    else hi = mid;
  }
  const chroma = Math.floor(lo * 10000) / 10000;
  const angle = (hue * Math.PI) / 180;
  return {
    lightness,
    chroma,
    hue,
    lab: [lightness, chroma * Math.cos(angle), chroma * Math.sin(angle)],
    rgb: linearRgb(lightness, chroma, hue),
  };
}
const cache = new Map<string, { dark: Sample; light: Sample; dot: Sample }>();
function samples(color: TopicColor) {
  const key = `${color.hue}:${color.level}`;
  let result = cache.get(key);
  if (!result) {
    const offset = color.level * 0.04,
      hue = normalizeHue(color.hue);
    result = {
      dark: sample(0.79 + offset, 0.13, hue),
      light: sample(0.46 + offset, 0.16, hue),
      dot: sample(0.64 + offset, 0.15, hue),
    };
    cache.set(key, result);
  }
  return result;
}
function luminance(rgb: number[]) {
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const darkSurface = ((10 / 255 + 0.055) / 1.055) ** 2.4;
const lightSurface = ((250 / 255 + 0.055) / 1.055) ** 2.4;
function readable(color: TopicColor): boolean {
  const { dark, light } = samples(color);
  return (
    contrast(luminance(dark.rgb), darkSurface) >= 4.5 &&
    contrast(luminance(light.rgb), lightSurface) >= 4.5
  );
}
function distance(a: TopicColor, b: TopicColor): number {
  const aa = samples(a),
    bb = samples(b);
  const one = (left: Sample, right: Sample) =>
    Math.hypot(...left.lab.map((v, i) => v - right.lab[i]!));
  return Math.min(one(aa.dark, bb.dark), one(aa.light, bb.light));
}
function nearest(color: TopicColor, others: readonly TopicColor[]): number {
  return others.length
    ? Math.min(...others.map((other) => distance(color, other)))
    : Infinity;
}

/** Choose the next family's anchor without changing any existing color. */
export function allocateFamilyColor(
  existing: readonly TopicColor[],
): TopicColor {
  if (!existing.length) return { hue: 47, level: 0 };
  let best: TopicColor = { hue: 0, level: 0 },
    score = -1;
  for (let hue = 0; hue < 360; hue += 5) {
    const color: TopicColor = { hue, level: 0 };
    if (!readable(color)) continue;
    const next = nearest(color, existing);
    if (next > score + 1e-9) {
      best = color;
      score = next;
    }
  }
  return best;
}

/** Choose a related child variant. Once the finite set is exhausted, reuse the best candidate. */
export function allocateChildColor(
  parent: TopicColor,
  siblings: readonly TopicColor[],
  existing: readonly TopicColor[],
  reparented = false,
): TopicColor {
  if (!siblings.length && !reparented)
    return { hue: parent.hue, level: parent.level };
  const used = new Set(siblings.map((color) => `${color.hue}:${color.level}`));
  let best: TopicColor | null = null,
    score = -1;
  for (const allowReuse of [false, true]) {
    for (const level of LEVELS)
      for (const offset of OFFSETS) {
        const color: TopicColor = {
          hue: normalizeHue(parent.hue + offset),
          level,
        };
        if (
          (!allowReuse && used.has(`${color.hue}:${color.level}`)) ||
          !readable(color)
        )
          continue;
        const next = nearest(color, existing);
        if (next > score + 1e-9) {
          best = color;
          score = next;
        }
      }
    if (best) return best;
  }
  return { hue: parent.hue, level: parent.level };
}

/** Resolve a section through its topic. Unbound sections keep their own fallback hue. */
export function colorForWorkstream(
  sectionId: string,
  catalog?: {
    groups: Readonly<Record<string, string>>;
    colors?: Readonly<Record<string, TopicColor>>;
  },
  topicId?: string | null,
): TopicColor {
  const topic = topicId ?? catalog?.groups[sectionId];
  return (
    (topic && catalog?.colors?.[topic]) || {
      hue: workstreamHue(sectionId),
      level: 0,
    }
  );
}

/**
 * The color's dark-surface text step (`--ws-color-dark`) as `#rrggbb`, for
 * surfaces outside BB that can't read its CSS, such as Stream Deck keys.
 */
export function workstreamColorHex(color: TopicColor): string {
  const encode = (linear: number) => {
    const c = Math.min(1, Math.max(0, linear));
    const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${samples(color).dark.rgb.map(encode).join("")}`;
}

/** Theme-specific CSS values shared by all workstream surfaces. */
export function workstreamColorStyle(
  color: TopicColor,
): Record<string, string> {
  const { dark, light, dot } = samples(color);
  const css = (s: Sample) =>
    `oklch(${(s.lightness * 100).toFixed(2)}% ${s.chroma.toFixed(4)} ${s.hue})`;
  return {
    "--ws-hue": String(color.hue),
    "--ws-color-light": css(light),
    "--ws-color-dark": css(dark),
    "--ws-color-dot": css(dot),
  };
}

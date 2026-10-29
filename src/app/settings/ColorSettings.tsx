import { useEffect, useRef, useState } from "react";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABEL,
  COLOR_TOKEN_VAR,
  CUSTOM_COLOR,
  THEME_COLORS,
  type ColorChoice,
  type ColorToken,
  type ThemeColor,
} from "../../domain/colors.ts";
import { usePrefs } from "../prefs.ts";
import { SelectField } from "../SelectField.tsx";
import { SectionRows, SettingRow } from "./ui.tsx";

const CUSTOM = "custom";
const DEFAULT = "default";
type PickValue = ThemeColor | typeof CUSTOM | typeof DEFAULT;

/** A color input needs a starting `#rrggbb` when the theme color can't be read. */
const FALLBACK_CUSTOM = "#808080";
const SAVE_DELAY_MS = 250;

/**
 * Settings → Workstreams → Colors: each color token keeps its Workstreams
 * default, follows a BB theme color, or uses a custom color. Each row previews the token's text, border, tint,
 * and solid steps as they render now.
 */
export function ColorSettings() {
  const { prefs, save } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  if (!prefs)
    return <p className="text-xs text-muted-foreground">Loading settings…</p>;
  const change = (token: ColorToken, choice: ColorChoice) => {
    setError(null);
    save({ colors: { [token]: choice } }).catch((cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : "Couldn't save the color.",
      ),
    );
  };
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        A theme color follows BB&apos;s light, dark, and custom themes. A custom
        color is used in both modes, with its text lightened or darkened to stay
        readable.
      </p>
      <SectionRows>
        {COLOR_TOKENS.map((token) => (
          <ColorRow
            key={token}
            token={token}
            choice={prefs.colors[token]}
            onChange={(choice) => change(token, choice)}
          />
        ))}
      </SectionRows>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ColorRow({
  token,
  choice,
  onChange,
}: {
  token: ColorToken;
  choice: ColorChoice;
  onChange: (choice: ColorChoice) => void;
}) {
  const name = COLOR_TOKEN_LABEL[token];
  const preview = useRef<HTMLSpanElement>(null);
  const options = [
    { value: DEFAULT as PickValue, label: "Workstreams default" },
    ...(Object.keys(THEME_COLORS) as ThemeColor[]).map((color) => ({
      value: color as PickValue,
      label: THEME_COLORS[color].label,
    })),
    { value: CUSTOM as PickValue, label: "Custom color" },
  ];
  return (
    <SettingRow
      label={name}
      control={
        <div className="flex items-center gap-2">
          <TokenPreview ref={preview} token={token} />
          {choice.kind === "custom" ? (
            <CustomColorInput
              label={`${name} custom color`}
              value={choice.color}
              onChange={(color) => onChange({ kind: "custom", color })}
            />
          ) : null}
          <SelectField<PickValue>
            label={`${name} color`}
            value={choice.kind === "theme" ? choice.color : choice.kind}
            options={options}
            onChange={(value) =>
              onChange(
                value === CUSTOM
                  ? {
                      kind: "custom",
                      // Start from the color the token shows now.
                      color: currentHex(preview.current, token),
                    }
                  : value === DEFAULT
                    ? { kind: "default" }
                    : { kind: "theme", color: value },
              )
            }
            className="h-8 w-52"
          />
        </div>
      }
    />
  );
}

/** "Aa" in the token's text step on its tint and border, with a solid dot. */
function TokenPreview({
  ref,
  token,
}: {
  ref: React.Ref<HTMLSpanElement>;
  token: ColorToken;
}) {
  const v = COLOR_TOKEN_VAR[token];
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-ws-color-preview={token}
      className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium"
      style={{
        borderColor: `var(${v}-border)`,
        backgroundColor: `var(${v}-surface)`,
        color: `var(${v}-text)`,
      }}
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: `var(${v})` }}
      />
      Aa
    </span>
  );
}

/**
 * The system color picker. Dragging through it updates the input at once and
 * saves after a short pause, so a drag sends one write rather than dozens.
 */
function CustomColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <input
      type="color"
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const next = event.target.value.toLowerCase();
        if (!CUSTOM_COLOR.test(next)) return;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          onChange(next);
        }, SAVE_DELAY_MS);
      }}
      className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
    />
  );
}

/** The token's current solid color as `#rrggbb`, read from the page. */
function currentHex(element: HTMLElement | null, token: ColorToken): string {
  if (!element) return FALLBACK_CUSTOM;
  const value = getComputedStyle(element)
    .getPropertyValue(COLOR_TOKEN_VAR[token])
    .trim();
  return (value && cssColorToHex(value)) || FALLBACK_CUSTOM;
}

/**
 * Any CSS color as `#rrggbb`, by painting one pixel; null where the browser
 * can't paint (tests) or the color is invalid.
 */
export function cssColorToHex(color: string): string | null {
  if (CUSTOM_COLOR.test(color)) return color;
  // An invalid color would leave the canvas's default black in place.
  if (typeof CSS === "undefined" || !CSS.supports?.("color", color))
    return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

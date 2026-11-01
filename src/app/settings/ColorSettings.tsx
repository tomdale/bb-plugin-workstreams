import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover.tsx";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABEL,
  COLOR_TOKEN_VAR,
  CUSTOM_COLOR,
  THEME_COLORS,
  THEME_MATCH,
  resolveColor,
  type ColorChoice,
  type ColorPrefs,
  type ColorScheme,
  type ColorToken,
  type ThemeColor,
} from "../../domain/colors.ts";
import { usePrefs } from "../prefs.ts";
import { SectionRows, SegmentedControl, SettingRow } from "./ui.tsx";

/** A color input needs a starting `#rrggbb` when the theme color can't be read. */
const FALLBACK_CUSTOM = "#808080";
const SAVE_DELAY_MS = 250;
/** The custom swatch's color wheel, drawn from theme colors. */
const WHEEL =
  "conic-gradient(var(--destructive), var(--attention), var(--success), var(--timeline-accent), var(--pr-merged), var(--destructive))";

const SCHEME_OPTIONS = [
  { value: "workstreams", label: "Workstreams" },
  { value: "theme", label: "bb theme" },
] as const satisfies readonly { value: ColorScheme; label: string }[];

/**
 * Settings → Workstreams → Colors. One switch picks the set every token
 * starts from (Workstreams' own shades or the matching bb theme colors); each
 * token's chip opens a swatch picker to keep that default, follow another
 * theme color, or use a custom color.
 */
export function ColorSettings() {
  const { prefs, save } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  if (!prefs)
    return <p className="text-xs text-muted-foreground">Loading settings…</p>;
  const update = (colors: Partial<ColorPrefs>) => {
    setError(null);
    save({ colors }).catch((cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : "Couldn't save the color.",
      ),
    );
  };
  const colors = prefs.colors;
  return (
    <div className="space-y-3">
      <SectionRows>
        <SettingRow
          label="Default colors"
          control={
            <SegmentedControl
              label="Default colors"
              value={colors.scheme}
              options={SCHEME_OPTIONS}
              onChange={(scheme) => update({ scheme })}
            />
          }
        />
        {COLOR_TOKENS.map((token) => (
          <ColorRow
            key={token}
            token={token}
            colors={colors}
            onChange={(choice) => update({ [token]: choice })}
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

/** What a token draws with, in a few plain words. */
function describe(colors: ColorPrefs, token: ColorToken): string {
  const resolved = resolveColor(colors, token);
  if (resolved.kind === "workstreams") return "Default";
  if (resolved.kind === "custom") return `Custom ${resolved.color}`;
  const label = THEME_COLORS[resolved.color].label;
  return resolved.byDefault ? `Default · ${label}` : label;
}

function ColorRow({
  token,
  colors,
  onChange,
}: {
  token: ColorToken;
  colors: ColorPrefs;
  onChange: (choice: ColorChoice) => void;
}) {
  const name = COLOR_TOKEN_LABEL[token];
  const caption = describe(colors, token);
  return (
    <div className="flex min-w-0 items-center justify-between gap-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p
          data-ws-color-caption={token}
          className="mt-0.5 truncate text-xs text-muted-foreground"
        >
          {caption}
        </p>
      </div>
      <ColorPicker
        token={token}
        name={name}
        colors={colors}
        onChange={onChange}
      />
    </div>
  );
}

type Swatch = {
  key: string;
  /** Names the option on its radio and in the picker's name line. */
  label: string;
  fill: string;
  checked: boolean;
  pick: () => void;
};

function ColorPicker({
  token,
  name,
  colors,
  onChange,
}: {
  token: ColorToken;
  name: string;
  colors: ColorPrefs;
  onChange: (choice: ColorChoice) => void;
}) {
  const group = useId();
  const chip = useRef<HTMLButtonElement>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const choice = colors[token];
  const matched = THEME_COLORS[THEME_MATCH[token]];
  const defaults: Swatch = {
    key: "default",
    label: colors.scheme === "theme" ? `Default · ${matched.label}` : "Default",
    fill:
      colors.scheme === "theme"
        ? `var(${matched.base})`
        : `var(${COLOR_TOKEN_VAR[token]}-original)`,
    checked: choice.kind === "default",
    pick: () => onChange({ kind: "default" }),
  };
  const themes: Swatch[] = (Object.keys(THEME_COLORS) as ThemeColor[]).map(
    (color) => ({
      key: color,
      label: THEME_COLORS[color].label,
      fill: `var(${THEME_COLORS[color].base})`,
      checked: choice.kind === "theme" && choice.color === color,
      pick: () => onChange({ kind: "theme", color }),
    }),
  );
  const custom: Swatch = {
    key: "custom",
    label: "Custom color",
    fill: choice.kind === "custom" ? choice.color : WHEEL,
    checked: choice.kind === "custom",
    pick: () =>
      onChange({
        kind: "custom",
        // Start from the color the token shows now.
        color: currentHex(chip.current, token),
      }),
  };
  const all = [defaults, ...themes, custom];
  const named =
    all.find((option) => option.key === pointed) ??
    all.find((option) => option.checked);
  const swatch = (option: Swatch) => (
    <SwatchOption
      key={option.key}
      group={group}
      option={option}
      onPoint={(pointing) =>
        setPointed((was) =>
          pointing ? option.key : was === option.key ? null : was,
        )
      }
    />
  );
  return (
    <Popover onOpenChange={() => setPointed(null)}>
      <PopoverTrigger asChild>
        <button
          ref={chip}
          type="button"
          aria-label={`${name} color`}
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-background pl-1 pr-1.5 text-muted-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <TokenPreview token={token} />
          <Icon name="ChevronDown" aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-2"
        // Focus the current choice, as a radio group does, not the first.
        onOpenAutoFocus={(event) => {
          const checked = (
            event.currentTarget as HTMLElement | null
          )?.querySelector<HTMLInputElement>("input[type=radio]:checked");
          if (!checked) return;
          event.preventDefault();
          checked.focus({ preventScroll: true });
        }}
      >
        <p
          aria-hidden="true"
          className="mb-1 px-1 text-xs text-muted-foreground"
        >
          <span className="font-medium text-foreground">{name}</span>
          {named ? ` · ${named.label}` : null}
        </p>
        <div
          role="radiogroup"
          aria-label={`${name} color`}
          className="flex items-center"
        >
          {swatch(defaults)}
          <Divider />
          {themes.map(swatch)}
          <Divider />
          {swatch(custom)}
        </div>
        {choice.kind === "custom" ? (
          <CustomColorFields
            name={name}
            value={choice.color}
            onChange={(color) => onChange({ kind: "custom", color })}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
}

/**
 * One choice as a round swatch; the picker's name line names it while it is
 * pointed at or focused. The radio is visually hidden inside the `relative`
 * label so focusing it never scrolls an outer BB container.
 */
function SwatchOption({
  group,
  option,
  onPoint,
}: {
  group: string;
  option: Swatch;
  onPoint: (pointing: boolean) => void;
}) {
  return (
    <label
      onPointerEnter={() => onPoint(true)}
      onPointerLeave={() => onPoint(false)}
      className="relative flex size-7 cursor-pointer items-center justify-center rounded-full has-focus-visible:outline-2 has-focus-visible:outline-ring"
    >
      <input
        type="radio"
        name={group}
        checked={option.checked}
        onChange={option.pick}
        onFocus={() => onPoint(true)}
        onBlur={() => onPoint(false)}
        aria-label={option.label}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "block size-5 rounded-full border border-border",
          option.checked &&
            "ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover",
        )}
        style={{ background: option.fill }}
      />
    </label>
  );
}

/** "Aa" in the token's text step on its tint and border, with a solid dot. */
function TokenPreview({ token }: { token: ColorToken }) {
  const v = COLOR_TOKEN_VAR[token];
  return (
    <span
      aria-hidden="true"
      data-ws-color-preview={token}
      className="flex h-6 items-center gap-1.5 rounded border px-1.5 text-xs font-medium"
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
 * The system color picker beside a hex field. The picker saves after a short
 * pause, so a drag sends one write rather than dozens; the field saves a
 * complete `#rrggbb` on Enter or when it loses focus.
 */
function CustomColorFields({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraft(value);
    setText(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const commitText = () => {
    const next = (text.startsWith("#") ? text : `#${text}`).toLowerCase();
    if (CUSTOM_COLOR.test(next)) {
      setDraft(next);
      if (next !== value) onChange(next);
    } else setText(value);
  };
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-border px-1 pt-2">
      <input
        type="color"
        aria-label={`${name} custom color`}
        value={draft}
        onChange={(event) => {
          const next = event.target.value.toLowerCase();
          if (!CUSTOM_COLOR.test(next)) return;
          setDraft(next);
          setText(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            onChange(next);
          }, SAVE_DELAY_MS);
        }}
        className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <input
        type="text"
        aria-label={`${name} hex color`}
        value={text}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => setText(event.target.value.trim())}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitText();
        }}
        className="h-7 w-24 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
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
function cssColorToHex(color: string): string | null {
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

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  const choice = colors[token];
  const defaultFill =
    colors.scheme === "theme"
      ? `var(${THEME_COLORS[THEME_MATCH[token]].base})`
      : `var(${COLOR_TOKEN_VAR[token]}-original)`;
  const defaultLabel =
    colors.scheme === "theme"
      ? THEME_COLORS[THEME_MATCH[token]].label
      : "Workstreams";
  return (
    <Popover>
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
        className="w-96 p-3"
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
        <div role="radiogroup" aria-label={`${name} color`}>
          <PickerSection title="Default">
            <SwatchOption
              group={group}
              label={defaultLabel}
              fill={defaultFill}
              checked={choice.kind === "default"}
              onPick={() => onChange({ kind: "default" })}
            />
          </PickerSection>
          <PickerSection title="Theme colors">
            {(Object.keys(THEME_COLORS) as ThemeColor[]).map((color) => (
              <SwatchOption
                key={color}
                group={group}
                label={THEME_COLORS[color].label}
                fill={`var(${THEME_COLORS[color].base})`}
                checked={choice.kind === "theme" && choice.color === color}
                onPick={() => onChange({ kind: "theme", color })}
              />
            ))}
          </PickerSection>
          <PickerSection title="Custom">
            <SwatchOption
              group={group}
              label="Pick a color"
              fill={choice.kind === "custom" ? choice.color : WHEEL}
              checked={choice.kind === "custom"}
              onPick={() =>
                onChange({
                  kind: "custom",
                  // Start from the color the token shows now.
                  color: currentHex(chip.current, token),
                })
              }
            />
          </PickerSection>
          {choice.kind === "custom" ? (
            <CustomColorFields
              name={name}
              value={choice.color}
              onChange={(color) => onChange({ kind: "custom", color })}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PickerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 last:mb-0">
      <h5 className="mb-1.5 text-xs font-medium text-muted-foreground">
        {title}
      </h5>
      <div className="grid grid-cols-4 gap-1">{children}</div>
    </section>
  );
}

/**
 * One choice as a round swatch over its name. The radio is visually hidden
 * inside the `relative` label so focusing it never scrolls an outer BB
 * container.
 */
function SwatchOption({
  group,
  label,
  fill,
  checked,
  onPick,
}: {
  group: string;
  label: string;
  fill: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <label
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-md px-1 py-1.5 text-xs leading-tight has-focus-visible:outline-2 has-focus-visible:outline-ring",
        checked
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name={group}
        checked={checked}
        onChange={onPick}
        aria-label={label}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 items-center justify-center rounded-full border-2",
          checked ? "border-foreground/70" : "border-transparent",
        )}
      >
        <span
          className="block size-5 rounded-full border border-border"
          style={{ background: fill }}
        />
      </span>
      <span className="w-full truncate text-center">{label}</span>
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
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
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
        className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
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
        className="h-8 w-24 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

import { useState, type CSSProperties } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { WorkstreamIcon } from "../../src/app/WorkstreamIcon";
import { WorkstreamName } from "../../src/app/WorkstreamName";
import { RecapCardPreview } from "../../src/app/composer/RecapCard";
import { QuestionForm } from "../../src/app/question/question-form";
import { QUESTION_CARD_CLASS } from "../../src/app/question/question-presentation";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABEL,
  COLOR_TOKEN_VAR,
  DEFAULT_COLORS,
  DEFAULT_SCHEME,
  THEME_COLORS,
  colorChoiceSchema,
  colorTokenCss,
  type ColorChoice,
  type ColorPrefs,
  type ColorScheme,
  type ColorToken,
  type ThemeColor,
} from "../../src/domain/colors";
import { RECAP_STATES, type Recap } from "../../src/domain/recap";
import {
  allocateChildColor,
  allocateFamilyColor,
  workstreamColorStyle,
  type TopicColor,
} from "../../src/domain/workstreamColor";
import { ExampleChoice } from "../ExampleChoice";
import type { GalleryExample } from "../examples";

const roles = [
  { suffix: "", label: "Solid", use: "Dots and bars" },
  { suffix: "-original", label: "Original", use: "Default settings swatch" },
  { suffix: "-text", label: "Text", use: "Text on a page or card" },
  { suffix: "-strong", label: "Strong", use: "Fills and mid text" },
  { suffix: "-on-strong", label: "On strong", use: "Text on a strong fill" },
  { suffix: "-soft", label: "Soft", use: "Quiet text and pills" },
  { suffix: "-mark", label: "Mark", use: "Sidebar and Home glyphs" },
  { suffix: "-band", label: "Band", use: "Up Next block" },
  { suffix: "-border", label: "Border", use: "Card frame" },
  { suffix: "-surface", label: "Surface", use: "Translucent card tint" },
  { suffix: "-footer", label: "Footer", use: "Translucent footer tint" },
  { suffix: "-rule", label: "Rule", use: "Internal hairline" },
] as const;

const defaults: ColorPrefs = { ...DEFAULT_COLORS, scheme: DEFAULT_SCHEME };
const firstFamily = allocateFamilyColor([]);
const families = [firstFamily, allocateFamilyColor([firstFamily])];
const themeOptions = (Object.keys(THEME_COLORS) as ThemeColor[]).map(
  (value) => ({
    value,
    label: THEME_COLORS[value].label,
  }),
);
const customOptions = [
  { value: "#f5f5f5", label: "Very light · #f5f5f5" },
  { value: "#101010", label: "Very dark · #101010" },
  { value: "#ff00ff", label: "Saturated · #ff00ff" },
] as const;

type Context = "both" | "recap" | "question";
type Surface = "page" | "raised" | "recessed";

export interface ColorsExampleProps {
  initialPrefs?: ColorPrefs;
  initialToken?: ColorToken;
  initialContext?: Context;
  initialRecapState?: Recap["state"];
}

function RoleSample({
  variable,
  suffix,
}: {
  variable: string;
  suffix: (typeof roles)[number]["suffix"];
}) {
  const color = `var(${variable}${suffix})`;
  const onStrong = suffix === "-on-strong" || suffix === "-strong";
  const text = suffix === "-text" || suffix === "-soft";
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm"
      style={
        onStrong
          ? {
              background: `var(${variable}-strong)`,
              color: `var(${variable}-on-strong)`,
            }
          : text
            ? { color }
            : suffix === "-border"
              ? { border: `2px solid ${color}` }
              : suffix === "-rule"
                ? {
                    background: `linear-gradient(${color}, ${color}) center / 100% 1px no-repeat`,
                  }
                : suffix === "-mark"
                  ? { color }
                  : { background: color }
      }
    >
      {onStrong || text ? "Aa" : suffix === "-mark" ? "✓" : null}
    </span>
  );
}

function Identity({ family }: { family: TopicColor }) {
  const firstChild = allocateChildColor(family, [], [family]);
  const secondChild = allocateChildColor(
    family,
    [firstChild],
    [family, firstChild],
  );
  return (
    <div className="space-y-3">
      {[
        { name: "Release tools", color: family, relationship: "Parent topic" },
        {
          name: "Release tools: Publishing",
          color: firstChild,
          relationship: "First child",
        },
        {
          name: "Release tools: Release notes",
          color: secondChild,
          relationship: "Second child",
        },
      ].map((item) => (
        <div
          key={item.name}
          className="min-w-0"
          style={workstreamColorStyle(item.color) as CSSProperties}
        >
          <div className="flex min-w-0 items-center gap-2">
            <WorkstreamIcon />
            <WorkstreamName name={item.name} accent />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.relationship} · hue {item.color.hue} · level{" "}
            {item.color.level}
          </p>
          {item.relationship === "Second child" && (
            <p className="ws-text-category ws-category-label mt-1">
              Drafts · category
            </p>
          )}
        </div>
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">
        The first child inherits the parent color; the second uses the
        production allocator. Category text uses its topic’s muted hue. Changing
        reported state below does not change these topic hues.
      </p>
    </div>
  );
}

export function ColorsExample({
  initialPrefs = defaults,
  initialToken = "needsYou",
  initialContext = "both",
  initialRecapState = "waiting",
}: ColorsExampleProps) {
  const [prefs, setPrefs] = useState<ColorPrefs>(() => ({ ...initialPrefs }));
  const [token, setToken] = useState<ColorToken>(initialToken);
  const [hex, setHex] = useState("#ff00ff");
  const [context, setContext] = useState<Context>(initialContext);
  const [recapState, setRecapState] =
    useState<Recap["state"]>(initialRecapState);
  const [surface, setSurface] = useState<Surface>("page");
  const [family, setFamily] = useState<"first" | "second">("first");
  const [answer, setAnswer] = useState("No local answer submitted");
  const choice = prefs[token];
  const parsedHex = colorChoiceSchema.safeParse({ kind: "custom", color: hex });
  const css = colorTokenCss(prefs);
  const setChoice = (next: ColorChoice) =>
    setPrefs((current) => ({ ...current, [token]: next }));
  const recap: Recap = {
    id: "gallery-colors-recap",
    turnId: "gallery-local",
    at: 0,
    state: recapState,
    goal:
      recapState === "waiting"
        ? "Waiting for the release checks"
        : "Prepared the release notes",
    latest:
      recapState === "waiting"
        ? []
        : ["Synthetic results for the color preview"],
    review: recapState === "review" ? ["Read the draft release notes"] : [],
    links: [],
    next:
      recapState === "waiting"
        ? []
        : [
            {
              title: "Inspect the draft",
              message: "Inspect the release notes",
            },
          ],
  };

  return (
    <div className="space-y-6">
      <style data-gallery-color-tokens="">{css}</style>
      <p className="text-xs leading-relaxed text-muted-foreground">
        One preference set applies to this page and its portaled controls, using
        production root selectors. It is removed when you leave this example.
        Use the gallery theme control for light and dark; no settings are saved.
      </p>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))",
        }}
      >
        <ExampleChoice<ColorScheme>
          label="Default set"
          value={prefs.scheme}
          options={[
            { value: "workstreams", label: "Workstreams defaults" },
            { value: "theme", label: "Match BB theme" },
          ]}
          onChange={(scheme) => setPrefs((current) => ({ ...current, scheme }))}
        />
        <ExampleChoice<ColorToken>
          label="Edit token"
          value={token}
          options={COLOR_TOKENS.map((value) => ({
            value,
            label: COLOR_TOKEN_LABEL[value],
          }))}
          onChange={(next) => {
            setToken(next);
            const nextChoice = prefs[next];
            setHex(nextChoice.kind === "custom" ? nextChoice.color : "#ff00ff");
          }}
        />
        <ExampleChoice<ColorChoice["kind"]>
          label="Color choice"
          value={choice.kind}
          options={[
            { value: "default", label: "Follow default set" },
            { value: "theme", label: "BB theme override" },
            { value: "custom", label: "Custom hex" },
          ]}
          onChange={(kind) => {
            if (kind === "default") setChoice({ kind });
            else if (kind === "theme")
              setChoice({ kind, color: "timeline-accent" });
            else {
              const color =
                parsedHex.success && parsedHex.data.kind === "custom"
                  ? parsedHex.data.color
                  : "#ff00ff";
              setHex(color);
              setChoice({ kind, color });
            }
          }}
        />
        {choice.kind === "theme" && (
          <ExampleChoice<ThemeColor>
            label="BB theme color"
            value={choice.color}
            options={themeOptions}
            onChange={(color) => setChoice({ kind: "theme", color })}
          />
        )}
        {choice.kind === "custom" && (
          <>
            <ExampleChoice<string>
              label="Custom sample"
              value={
                customOptions.some((option) => option.value === choice.color)
                  ? choice.color
                  : "entered"
              }
              options={[
                ...customOptions,
                { value: "entered", label: "Entered hex" },
              ]}
              onChange={(color) => {
                if (color === "entered") return;
                setHex(color);
                setChoice({ kind: "custom", color });
              }}
            />
            <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
              Custom hex
              <Input
                value={hex}
                aria-invalid={!parsedHex.success}
                className="text-foreground"
                onChange={(event) => {
                  const value = event.target.value;
                  setHex(value);
                  const parsed = colorChoiceSchema.safeParse({
                    kind: "custom",
                    color: value,
                  });
                  if (parsed.success) setChoice(parsed.data);
                }}
              />
              {!parsedHex.success && (
                <span>Use #rrggbb; the last valid color remains applied.</span>
              )}
            </label>
          </>
        )}
        <ExampleChoice<Surface>
          label="Neutral surface"
          value={surface}
          options={[
            { value: "page", label: "Page" },
            { value: "raised", label: "Raised" },
            { value: "recessed", label: "Recessed" },
          ]}
          onChange={setSurface}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setPrefs({ ...defaults });
          setHex("#ff00ff");
        }}
      >
        Reset all local colors
      </Button>
      <div
        className="space-y-6 rounded-md border border-border p-3"
        style={{
          background:
            surface === "page"
              ? "var(--background)"
              : `var(--surface-${surface}-solid)`,
        }}
      >
        <div className="grid gap-3 @lg:grid-cols-2">
          {COLOR_TOKENS.map((item) => {
            const variable = COLOR_TOKEN_VAR[item];
            return (
              <section
                key={item}
                className="min-w-0 rounded-md border border-border p-3"
              >
                <h3
                  className="mb-3 text-[13px] font-medium"
                  style={{ color: `var(${variable}-text)` }}
                >
                  {COLOR_TOKEN_LABEL[item]}
                </h3>
                <dl className="space-y-2 text-xs">
                  {roles.map((role) => (
                    <div
                      key={role.suffix}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <RoleSample variable={variable} suffix={role.suffix} />
                      <div className="min-w-0">
                        <dt>
                          {role.label}{" "}
                          <span className="text-muted-foreground">
                            · {role.use}
                          </span>
                        </dt>
                        <dd className="break-all font-mono text-[10px] text-muted-foreground">
                          {variable}
                          {role.suffix}
                        </dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Surface, footer, and rule steps are translucent and read against the
          selected neutral surface. Custom text uses the generator’s lightness
          clamp; this preview does not establish a contrast or accessibility
          guarantee.
        </p>
        <div className="grid gap-3 @sm:grid-cols-2">
          <ExampleChoice<"first" | "second">
            label="Topic family"
            value={family}
            onChange={setFamily}
            options={[
              { value: "first", label: "First allocated family" },
              { value: "second", label: "Second allocated family" },
            ]}
          />
          <ExampleChoice<Context>
            label="Production context"
            value={context}
            onChange={setContext}
            options={[
              { value: "both", label: "Question and recap" },
              { value: "question", label: "Needs-you question" },
              { value: "recap", label: "Reported-state recap" },
            ]}
          />
          <ExampleChoice<Recap["state"]>
            label="Reported state"
            value={recapState}
            onChange={setRecapState}
            options={RECAP_STATES.map((value) => ({
              value,
              label: COLOR_TOKEN_LABEL[value],
            }))}
          />
        </div>
        <Identity family={families[family === "first" ? 0 : 1]!} />
        {context !== "recap" && (
          <div className={QUESTION_CARD_CLASS}>
            <QuestionForm
              questions={[
                {
                  id: "gallery-colors-question",
                  shortLabel: "Release",
                  prompt: "Which release notes should we inspect?",
                  details:
                    "Needs you means a decision is required, not that work is waiting.",
                  multiSelect: false,
                  allowFreeText: false,
                  options: [
                    {
                      value: "draft",
                      label: "Draft notes",
                      description: "Read the current draft.",
                    },
                    {
                      value: "published",
                      label: "Published notes",
                      description: "Compare the published version.",
                    },
                  ],
                },
              ]}
              disabled={false}
              cancelDisabled={false}
              onSubmit={() =>
                setAnswer("Local answer submitted; nothing was saved")
              }
              onCancel={() =>
                setAnswer("Local answer cancelled; nothing was saved")
              }
            />
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {answer}
            </p>
          </div>
        )}
        {context !== "question" && (
          <RecapCardPreview recap={recap} layout="full" />
        )}
        <p className="text-xs text-muted-foreground">
          The recap preview is inert; its actions do not operate on BB.
        </p>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer">
          Current local color preferences and generated CSS
        </summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3">
          <code>
            {JSON.stringify(prefs, null, 2)}
            {"\n\n"}
            {css || "No overrides; tokens.css supplies every default."}
          </code>
        </pre>
      </details>
    </div>
  );
}

export const colorsExample: GalleryExample = {
  id: "colors",
  group: "Foundations",
  title: "Semantic colors",
  description:
    "All six state tokens and their actual roles, with local default, BB theme, and custom choices beside real question, recap, and topic identity components.",
  source: `import { colorTokenCss, DEFAULT_COLORS, type ColorPrefs } from "../../src/domain/colors";
import { RecapCardPreview } from "../../src/app/composer/RecapCard";

const prefs: ColorPrefs = { ...DEFAULT_COLORS, scheme: "workstreams",
  needsYou: { kind: "custom", color: "#ff00ff" } };

// One active preference set; React removes this stylesheet on unmount.
<style>{colorTokenCss(prefs)}</style>
<RecapCardPreview recap={recap} layout="full" />

// The live panel shows current preferences and the exact generated CSS.
// Topic identity separately uses allocateFamilyColor, allocateChildColor,
// and workstreamColorStyle; it never derives from a state token.`,
  render: () => <ColorsExample />,
};

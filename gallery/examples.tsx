import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { RecapCardPreview } from "../src/app/composer/RecapCard";
import { QuestionForm } from "../src/app/question/question-form";
import {
  PROMPT_CLASS,
  QUESTION_CARD_CLASS,
} from "../src/app/question/question-presentation";
import type {
  Question,
  QuestionAnswer,
} from "../src/app/question/question-form-state";
import { PlainBody } from "../src/app/reply/PlainBody";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABEL,
  COLOR_TOKEN_VAR,
} from "../src/domain/colors";
import { RECAP_STATES, type Recap } from "../src/domain/recap";
import {
  RECAP_LAYOUT_OPTIONS,
  type RecapLayout,
} from "../src/domain/recapPrefs";
import type { ReplyComponent } from "../src/domain/replyComponents";
import {
  allocateFamilyColor,
  workstreamColorStyle,
} from "../src/domain/workstreamColor";

export interface GalleryExample {
  id: string;
  title: string;
  group: "Foundations" | "Components";
  description: string;
  source: string;
  render: () => ReactNode;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select
        value={value}
        onValueChange={(next) => {
          const option = options.find((item) => item.value === next);
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger aria-label={label} className="w-full min-w-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="!animate-none">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const tokenRoles = [
  { value: "", label: "Solid mark" },
  { value: "-text", label: "Readable text" },
  { value: "-border", label: "Border" },
  { value: "-surface", label: "Surface" },
  { value: "-footer", label: "Footer" },
  { value: "-rule", label: "Rule" },
] as const;

function ColorsExample() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 @sm:grid-cols-2">
        {COLOR_TOKENS.map((token) => {
          const variable = COLOR_TOKEN_VAR[token];
          return (
            <section
              key={token}
              className="min-w-0 rounded-md border p-3"
              style={{
                borderColor: `var(${variable}-border)`,
                background: `var(${variable}-surface)`,
              }}
            >
              <h3
                className="mb-3 text-[13px] font-medium"
                style={{ color: `var(${variable}-text)` }}
              >
                {COLOR_TOKEN_LABEL[token]}
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {tokenRoles.map((role) => (
                  <div
                    key={role.value}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-sm border border-border"
                      style={{ background: `var(${variable}${role.value})` }}
                    />
                    <dt>{role.label}</dt>
                    <dd className="sr-only">{variable + role.value}</dd>
                  </div>
                ))}
              </dl>
              <code className="mt-3 block break-all text-[11px] text-muted-foreground">
                {variable}
              </code>
            </section>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        These swatches read the current CSS variables, not copied color values.
        Topic identity uses a separate hue; it never stands in for a work state.
      </p>
    </div>
  );
}

const typeRoles = [
  {
    role: "Sidebar section",
    className: "ws-text-section",
    text: "Workstreams",
  },
  {
    role: "Workstream",
    className: "ws-text-workstream",
    text: "Release tools",
  },
  { role: "Category", className: "ws-text-category", text: "Ready to review" },
  {
    role: "Thread",
    className: "ws-text-thread",
    text: "Check the release notes",
  },
  {
    role: "Question prompt",
    className: PROMPT_CLASS,
    text: "Which layout should we use?",
  },
] as const;

function TypographyExample() {
  return (
    <dl className="divide-y divide-border">
      {typeRoles.map((item) => (
        <div
          key={item.role}
          className="grid gap-2 py-4 @sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <dt className="text-xs text-muted-foreground">{item.role}</dt>
          <dd className={`min-w-0 break-words ${item.className}`}>
            {item.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const firstTopicColor = allocateFamilyColor([]);
const topicColors = [firstTopicColor, allocateFamilyColor([firstTopicColor])];
const identityNames = ["Release tools", "Workstreams: Recaps"] as const;

function IdentityExample() {
  const [name, setName] = useState<string>(identityNames[1]);
  const [tone, setTone] = useState<"accent" | "neutral" | "muted">("accent");
  const [family, setFamily] = useState<"first" | "second">("first");
  const style = workstreamColorStyle(topicColors[family === "first" ? 0 : 1]!);
  return (
    <div className="space-y-6">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
        }}
      >
        <Choice
          label="Name"
          value={name}
          onChange={setName}
          options={identityNames.map((item) => ({ value: item, label: item }))}
        />
        <Choice
          label="Treatment"
          value={tone}
          onChange={setTone}
          options={[
            { value: "accent", label: "Topic hue" },
            { value: "neutral", label: "Neutral" },
            { value: "muted", label: "Muted" },
          ]}
        />
        <Choice
          label="Allocated hue"
          value={family}
          onChange={setFamily}
          options={[
            { value: "first", label: "First topic" },
            { value: "second", label: "Second topic" },
          ]}
        />
      </div>
      <div
        className="flex min-w-0 items-center gap-2 py-5"
        style={style as CSSProperties}
      >
        <WorkstreamIcon />
        <WorkstreamName
          name={name}
          accent={tone === "accent"}
          muted={tone === "muted"}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The actual name component subdues the owner prefix and preserves the
        colon for assistive technology. The shared icon stays neutral.
      </p>
    </div>
  );
}

const recapBase = {
  id: "gallery-recap",
  turnId: "gallery-turn",
  at: 0,
  links: [],
  next: [],
  review: [],
  latest: [],
} satisfies Omit<Recap, "state" | "goal">;

const recaps: Record<Recap["state"], Recap> = {
  complete: {
    ...recapBase,
    state: "complete",
    goal: "Added the compact release summary",
    latest: [
      "Long filenames wrap inside the available width",
      {
        text: "Keyboard checks passed locally",
        detail: "Synthetic example, not a test report",
      },
    ],
    next: [
      { title: "Review the copy", message: "Review the release summary copy" },
    ],
  },
  review: {
    ...recapBase,
    state: "review",
    goal: "Prepared the release summary for review",
    latest: ["The summary uses the shared Markdown renderer"],
    review: [
      {
        text: "Read the summary in a narrow pane",
        detail: "Expect paths to wrap without horizontal scrolling",
      },
      "Check keyboard focus on the footer actions",
    ],
    next: [
      { title: "Inspect the summary", message: "Inspect the release summary" },
    ],
  },
  waiting: {
    ...recapBase,
    state: "waiting",
    goal: "Waiting for the release checks",
    waitingAgents: [
      { threadId: "gallery-agent", task: "Check the narrow layout" },
    ],
  },
};

function RecapExample() {
  const [state, setState] = useState<Recap["state"]>("review");
  const [layout, setLayout] = useState<RecapLayout>("full");
  const [archive, setArchive] = useState(false);
  const [width, setWidth] = useState<"wide" | "narrow">("wide");
  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
        }}
      >
        <Choice
          label="Reported state"
          value={state}
          onChange={setState}
          options={RECAP_STATES.map((value) => ({
            value,
            label: COLOR_TOKEN_LABEL[value],
          }))}
        />
        <Choice
          label="Layout"
          value={layout}
          onChange={setLayout}
          options={RECAP_LAYOUT_OPTIONS}
        />
        <Choice
          label="Available width"
          value={width}
          onChange={setWidth}
          options={[
            { value: "wide", label: "Fill the pane" },
            { value: "narrow", label: "Narrow · 320px" },
          ]}
        />
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            aria-pressed={archive}
            onClick={() => setArchive(!archive)}
          >
            {archive ? "Hide Archive" : "Show Archive"}
          </Button>
        </div>
      </div>
      <div
        className="mx-auto min-w-0"
        style={{ maxWidth: width === "narrow" ? 320 : undefined }}
      >
        <RecapCardPreview
          recap={recaps[state]}
          layout={layout}
          showArchive={archive}
          agents={{
            "gallery-agent": {
              title: "Layout checks",
              href: null,
              tone: "running",
              label: "Running",
            },
          }}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The production preview is inert: dismiss, Archive, next actions, and
        links cannot act on BB. Waiting shows a static example without a
        scheduled check.
      </p>
    </div>
  );
}

const questionOptions = [
  {
    value: "compact",
    label: "Compact summary",
    description: "Keep the goal and essential review steps.",
    preview: "Release summary\n  Goal\n  Review steps",
  },
  {
    value: "full",
    label: "Full summary",
    description: "Include results beside the review steps.",
    preview: "Release summary\n  Goal\n  Done\n  Review steps",
  },
] as const;

function QuestionExample() {
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [reset, setReset] = useState(0);
  const [result, setResult] = useState("No local answer submitted");
  const question: Question = {
    id: "gallery-layout",
    shortLabel: "Layout",
    prompt:
      mode === "single"
        ? "Which summary should we preview?"
        : "Which summaries should we preview?",
    details:
      "This is a local example. Nothing is sent to an agent or saved in BB.",
    multiSelect: mode === "multiple",
    allowFreeText: false,
    options: questionOptions,
  };
  const submit = (answers: Record<string, QuestionAnswer>) => {
    const selected = answers[question.id]?.selected ?? [];
    const labels = questionOptions
      .filter((item) => selected.includes(item.value))
      .map((item) => item.label);
    setResult(`Local answer: ${labels.join(", ")}`);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Choice
          label="Selection"
          value={mode}
          onChange={(value) => {
            setMode(value);
            setResult("No local answer submitted");
          }}
          options={[
            { value: "single", label: "Single choice" },
            { value: "multiple", label: "Multiple choices" },
          ]}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setReset(reset + 1);
            setResult("Local form reset");
          }}
        >
          Reset local form
        </Button>
      </div>
      <div className={QUESTION_CARD_CLASS}>
        <QuestionForm
          key={`${mode}-${reset}`}
          questions={[question]}
          disabled={false}
          cancelDisabled={false}
          onSubmit={submit}
          onCancel={() => {
            setReset(reset + 1);
            setResult("Local answer cancelled");
          }}
        />
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {result}
      </p>
    </div>
  );
}

const replyParts = [
  {
    type: "context",
    topic: "Release summary",
    where: "Local fixture",
    background: "The following content is synthetic.",
  },
  {
    type: "text",
    body: "The summary keeps **the result** first, followed by review steps and `paths/that/wrap.ts`.\n\nOrdinary prose stays in the message flow.",
  },
  {
    type: "finding",
    title: "The narrow layout wraps long paths",
    explanation:
      "The fixture uses a long filename to exercise the available width.",
    certainty: "observed",
    consequence: "The reader can keep the pane narrow.",
    evidence: [
      {
        label: "Synthetic layout fixture",
        detail:
          "This is example evidence, not an independently verified result.",
      },
    ],
  },
  {
    type: "sequence",
    title: "Review the summary",
    steps: [
      {
        title: "Switch to the narrow width",
        detail: "The recap example exposes a 320px width.",
      },
      {
        title: "Read the review steps",
        detail: "Keep each qualification next to its claim.",
        attention: true,
      },
    ],
  },
  {
    type: "comparison",
    title: "Choose the summary layout",
    items: [
      {
        name: "Compact",
        summary: "Keep the goal and essential rows.",
        recommended: true,
        qualification: "Useful when the message column is narrow.",
      },
      {
        name: "Full",
        summary: "Keep results and review steps together.",
        qualification: "Uses more vertical space.",
      },
    ],
  },
  {
    type: "change",
    title: "Summary layout",
    before: "The results and review steps use the same emphasis.",
    after: "Review steps follow the goal and results.",
    unchanged: "The source content.",
    limitation: "The current reply renderer remains plain Markdown.",
  },
  {
    type: "checks",
    title: "Example checks",
    scope: "Synthetic report; no checks were run by this sample.",
    testTotals: { passed: 2, failed: 0, skipped: 1 },
    items: [
      { name: "Keyboard selection", status: "passed" },
      { name: "Long path wrapping", status: "passed" },
      {
        name: "Phone layout",
        status: "skipped",
        detail: "Needs a coarse-pointer viewport.",
      },
    ],
  },
  {
    type: "delivery",
    title: "Example delivery",
    scope: "Synthetic stages, not the status of this repository.",
    stages: [
      { name: "Local build", status: "done" },
      {
        name: "Live installation",
        status: "pending",
        detail: "No plugin is installed by this playground.",
      },
    ],
  },
  {
    type: "recommendation",
    choice: "Use the compact layout in a narrow pane.",
    reason: "It keeps the goal and the essential next step visible.",
    qualification: "Use Full when the result details matter during review.",
  },
  {
    type: "details",
    title: "Example details",
    body: "This is the actual `PlainBody` renderer.\n\n- No separate card per component\n- No redesigned status marks\n- No host actions",
  },
  {
    type: "group",
    relationship: "supporting",
    children: [
      {
        type: "text",
        body: "Keep the qualification beside the recommendation.",
      },
      {
        type: "details",
        title: "Why it matters",
        body: "The current renderer draws group children in order; it does not add a relationship-specific layout.",
      },
    ],
  },
] satisfies ReplyComponent[];

function ReplyExample() {
  const [type, setType] = useState<ReplyComponent["type"]>("finding");
  const part = replyParts.find((item) => item.type === type)!;
  return (
    <div className="space-y-5">
      <Choice
        label="Reply component"
        value={type}
        onChange={setType}
        options={replyParts.map((item) => ({
          value: item.type,
          label: item.type[0]!.toUpperCase() + item.type.slice(1),
        }))}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Current renderer, not a proposed redesign: the vocabulary carries typed
        information, but presentation is plain Markdown. Comparison options and
        groups render in order, not as columns or new cards.
      </p>
      <div className="min-w-0 break-words">
        <PlainBody part={part} document={undefined} files={null} />
      </div>
    </div>
  );
}

function ControlsExample() {
  const [name, setName] = useState("Release summary");
  const [density, setDensity] = useState<"compact" | "full">("compact");
  const [status, setStatus] = useState("No local action yet");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 @sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Example name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="text-foreground"
          />
        </label>
        <Choice
          label="Example layout"
          value={density}
          onChange={setDensity}
          options={[
            { value: "compact", label: "Compact" },
            { value: "full", label: "Full" },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            setStatus(`Local preview: ${name || "Untitled"} · ${density}`)
          }
        >
          Preview locally
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setName("Release summary");
            setDensity("compact");
            setStatus("Local controls reset");
          }}
        >
          Reset locally
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStatus("Local draft discarded")}
        >
          Discard locally
        </Button>
        <Button type="button" variant="outline" disabled>
          Unavailable
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}

export const examples: GalleryExample[] = [
  {
    id: "colors",
    title: "Semantic colors",
    group: "Foundations",
    description:
      "The six Workstreams state tokens and their role-specific steps, read directly from the loaded theme.",
    source: `import { COLOR_TOKENS, COLOR_TOKEN_VAR } from "../src/domain/colors";\n\n// Read the loaded variables rather than copying a default hue.\nconst variable = COLOR_TOKEN_VAR.review;\nconst style = {\n  color: \`var(\${variable}-text)\`,\n  background: \`var(\${variable}-surface)\`,\n  borderColor: \`var(\${variable}-border)\`,\n};`,
    render: () => <ColorsExample />,
  },
  {
    id: "typography",
    title: "Existing type roles",
    group: "Foundations",
    description:
      "Existing sidebar classes and the exported question-prompt role; not a new global type scale.",
    source: `import { PROMPT_CLASS } from "../src/app/question/question-presentation";\n\n<span className="ws-text-section">Workstreams</span>\n<span className="ws-text-workstream">Release tools</span>\n<span className="ws-text-category">Ready to review</span>\n<span className="ws-text-thread">Check the release notes</span>\n<div className={PROMPT_CLASS}>Which layout should we use?</div>`,
    render: () => <TypographyExample />,
  },
  {
    id: "work-identity",
    title: "Work identity",
    group: "Components",
    description:
      "The shared icon and name, including owner-prefix treatment and catalog-allocated topic hues.",
    source: `import { WorkstreamIcon } from "../src/app/WorkstreamIcon";\nimport { WorkstreamName } from "../src/app/WorkstreamName";\nimport { allocateFamilyColor, workstreamColorStyle } from "../src/domain/workstreamColor";\n\n<div style={workstreamColorStyle(allocateFamilyColor([]))}>\n  <WorkstreamIcon />\n  <WorkstreamName name="Workstreams: Recaps" accent />\n</div>`,
    render: () => <IdentityExample />,
  },
  {
    id: "recap-card",
    title: "Recap card",
    group: "Components",
    description:
      "The actual inert preview, with reported state, Full or Compact layout, Archive visibility, and available-width controls.",
    source: `import { RecapCardPreview } from "../src/app/composer/RecapCard";\nimport type { Recap } from "../src/domain/recap";\n\nconst recap: Recap = ${JSON.stringify(recaps.review, null, 2)};\n\n// The gallery controls change state, layout, width, and showArchive locally.\n<RecapCardPreview recap={recap} layout="full" showArchive={false} />`,
    render: () => <RecapExample />,
  },
  {
    id: "question-form",
    title: "Question form",
    group: "Components",
    description:
      "Real option selection, keyboard behavior, notes, and previews. Submit and Cancel only update local example state; attachments are not offered.",
    source: `import { QuestionForm } from "../src/app/question/question-form";\nimport { QUESTION_CARD_CLASS } from "../src/app/question/question-presentation";\n\nconst question = {\n  id: "gallery-layout", shortLabel: "Layout",\n  prompt: "Which summary should we preview?",\n  multiSelect: false, allowFreeText: false,\n  options: ${JSON.stringify(questionOptions, null, 2)},\n};\n\n<div className={QUESTION_CARD_CLASS}>\n  <QuestionForm questions={[question]} disabled={false} cancelDisabled={false}\n    onSubmit={(answers) => setLocalAnswers(answers)}\n    onCancel={() => resetLocalForm()} />\n</div>`,
    render: () => <QuestionExample />,
  },
  {
    id: "reply-vocabulary",
    title: "Reply vocabulary",
    group: "Components",
    description:
      "All eleven information components through the current PlainBody renderer, with explicitly synthetic claims and checks.",
    source: `import { PlainBody } from "../src/app/reply/PlainBody";\nimport type { ReplyComponent } from "../src/domain/replyComponents";\n\n// The selector changes this part; PlainBody renders the selected vocabulary.\nconst part: ReplyComponent = ${JSON.stringify(replyParts[2], null, 2)};\n\n<PlainBody part={part} document={undefined} files={null} />`,
    render: () => <ReplyExample />,
  },
  {
    id: "bb-controls",
    title: "BB controls",
    group: "Components",
    description:
      "Vendored registry buttons, input, and select. All actions are local and can be exercised without a BB thread.",
    source: `import { Button } from "../components/ui/button";\nimport { Input } from "../components/ui/input";\nimport { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";\n\n<Input value={name} onChange={(event) => setName(event.target.value)} />\n<Select value={layout} onValueChange={setLayout}>\n  <SelectTrigger aria-label="Example layout"><SelectValue /></SelectTrigger>\n  <SelectContent>\n    <SelectItem value="compact">Compact</SelectItem>\n    <SelectItem value="full">Full</SelectItem>\n  </SelectContent>\n</Select>\n<Button onClick={previewLocally}>Preview locally</Button>\n<Button variant="outline" onClick={resetLocally}>Reset locally</Button>\n<Button variant="ghost" onClick={discardLocally}>Discard locally</Button>\n<Button variant="outline" disabled>Unavailable</Button>`,
    render: () => <ControlsExample />,
  },
];

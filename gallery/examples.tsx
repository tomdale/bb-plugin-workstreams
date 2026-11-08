import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ExampleChoice } from "./ExampleChoice";
import { GalleryControls, GalleryNotes, LiveExample } from "./ExampleFrame";
import { colorsExample } from "./examples/colors";
import { questionExample } from "./examples/questions";
import { recapExample } from "./examples/recaps";
import { settingsExample } from "./examples/settings";
import { overlaysExample } from "./examples/overlays";
import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { PROMPT_CLASS } from "../src/app/question/question-presentation";
import { PlainBody } from "../src/app/reply/PlainBody";
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
    <div className="space-y-5">
      {typeRoles.map((item) => (
        <LiveExample
          key={item.role}
          name={item.role}
          sources={[
            item.role === "Question prompt"
              ? "src/app/question/question-presentation.tsx"
              : "src/app/styles.css",
          ]}
        >
          <div className={`min-w-0 break-words ${item.className}`}>
            {item.text}
          </div>
        </LiveExample>
      ))}
    </div>
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
      <GalleryControls>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
          }}
        >
          <ExampleChoice
            label="Name"
            value={name}
            onChange={setName}
            options={identityNames.map((item) => ({
              value: item,
              label: item,
            }))}
          />
          <ExampleChoice
            label="Treatment"
            value={tone}
            onChange={setTone}
            options={[
              { value: "accent", label: "Topic hue" },
              { value: "neutral", label: "Neutral" },
              { value: "muted", label: "Muted" },
            ]}
          />
          <ExampleChoice
            label="Allocated hue"
            value={family}
            onChange={setFamily}
            options={[
              { value: "first", label: "First topic" },
              { value: "second", label: "Second topic" },
            ]}
          />
        </div>
      </GalleryControls>
      <LiveExample
        name="WorkstreamIcon · WorkstreamName"
        sources={["src/app/WorkstreamIcon.tsx", "src/app/WorkstreamName.tsx"]}
      >
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
      </LiveExample>
      <GalleryNotes>
        The actual name component subdues the owner prefix and preserves the
        colon for assistive technology. The shared icon stays neutral.
      </GalleryNotes>
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
    type: "sequence",
    title: "Review the summary",
    steps: [
      {
        title: "Switch to the narrow width",
        detail: "Use a pane about 320px wide.",
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
    limitation:
      "This sample compares reported content; it does not describe an application behavior change.",
  },
  {
    type: "checks",
    title: "Example checks",
    scope:
      "Synthetic report for the Gallery; it is not a test report for this repository.",
    testTotals: { passed: 2, failed: 1, skipped: 1 },
    items: [
      { name: "Keyboard selection", status: "passed" },
      { name: "Long path wrapping", status: "passed" },
      {
        name: "Theme fallback",
        status: "failed",
        detail: "Synthetic failure to show the failed status treatment.",
      },
      {
        name: "Phone layout",
        status: "skipped",
        detail: "Needs a coarse-pointer viewport.",
      },
      {
        name: "BB interaction",
        status: "blocked",
        detail: "The standalone Gallery does not connect to a BB server.",
      },
      {
        name: "Physical-device behavior",
        status: "untested",
        detail: "No physical device was used for this sample.",
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
    body: "The release summary groups the result with its review steps.\n\n- Keep artifact paths beside their descriptions\n- State which checks ran\n- Leave pending deployment explicit",
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
        body: "A reviewer needs the qualification before choosing the next release step.",
      },
    ],
  },
] satisfies ReplyComponent[];

function ReplyExample() {
  const [type, setType] = useState<ReplyComponent["type"]>("change");
  const part = replyParts.find((item) => item.type === type)!;
  return (
    <div className="space-y-5">
      <GalleryControls>
        <ExampleChoice
          label="Reply component"
          value={type}
          onChange={setType}
          options={replyParts.map((item) => ({
            value: item.type,
            label: item.type[0]!.toUpperCase() + item.type.slice(1),
          }))}
        />
      </GalleryControls>
      <GalleryNotes>
        Change and Checks use the recap card's label gutter and leading status
        marks. Comparison options and groups keep their current rendering.
      </GalleryNotes>
      <LiveExample name="PlainBody" sources={["src/app/reply/PlainBody.tsx"]}>
        <div className="min-w-0 break-words">
          <PlainBody part={part} document={undefined} files={null} />
        </div>
      </LiveExample>
    </div>
  );
}

function ControlsExample() {
  const [name, setName] = useState("Release summary");
  const [density, setDensity] = useState<"compact" | "full">("compact");
  const [status, setStatus] = useState("No local action yet");
  return (
    <div className="space-y-5">
      <LiveExample
        name="Button · Input · Select"
        sources={[
          "components/ui/button.tsx",
          "components/ui/input.tsx",
          "components/ui/select.tsx",
        ]}
      >
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
            <ExampleChoice
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
        </div>
      </LiveExample>
      <GalleryNotes>
        <p role="status">{status}</p>
      </GalleryNotes>
    </div>
  );
}

export const examples: GalleryExample[] = [
  colorsExample,
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
  settingsExample,
  overlaysExample,
  recapExample,
  questionExample,
  {
    id: "reply-vocabulary",
    title: "Reply vocabulary",
    group: "Components",
    description:
      "All ten information components through PlainBody; Change and Checks follow the recap card, with synthetic totals and statuses.",
    source: `import { PlainBody } from "../src/app/reply/PlainBody";\nimport type { ReplyComponent } from "../src/domain/replyComponents";\n\n// The selector changes this part; PlainBody renders the selected vocabulary.\nconst part: ReplyComponent = ${JSON.stringify(
      replyParts.find((item) => item.type === "change"),
      null,
      2,
    )};\n\n<PlainBody part={part} document={undefined} files={null} />`,
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

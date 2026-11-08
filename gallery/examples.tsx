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
import { GalleryNotes, LiveExample, Variant, Variants } from "./ExampleFrame";
import { colorsExample } from "./examples/colors";
import { questionExample } from "./examples/questions";
import { recapExample } from "./examples/recaps";
import { settingsExample } from "./examples/settings";
import { overlaysExample } from "./examples/overlays";
import { primitiveExamples } from "./examples/primitives";
import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { PROMPT_CLASS } from "../src/app/question/question-presentation";
import { PlainBody, ReplyPanel } from "../src/app/reply/PlainBody";
import { SPECIMENS } from "../src/app/page/gallery";
import { parse } from "../src/domain/reply";
import type { ReplyComponent } from "../src/domain/replyComponents";
import { COMPONENT_EXAMPLES } from "../src/domain/replyExamples";
import { onlyReplyBlock } from "../src/domain/replyText";
import {
  allocateFamilyColor,
  workstreamColorStyle,
} from "../src/domain/workstreamColor";

export interface GalleryExample {
  id: string;
  title: string;
  group: "Foundations" | "Components" | "Primitives";
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
    <LiveExample
      name="Type roles"
      sources={[
        "src/app/styles.css",
        "src/app/question/question-presentation.tsx",
      ]}
    >
      <table className="w-full min-w-0 border-collapse text-left">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 pr-4 font-medium">
              Role
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              Sample
            </th>
            <th scope="col" className="pb-2 font-medium">
              Class
            </th>
          </tr>
        </thead>
        <tbody>
          {typeRoles.map((item) => (
            <tr
              key={item.role}
              className="border-t border-border align-baseline"
            >
              <th scope="row" className="py-3 pr-4 text-xs font-medium">
                {item.role}
              </th>
              <td className="min-w-0 break-words py-3 pr-4">
                <span className={item.className}>{item.text}</span>
              </td>
              <td className="py-3 font-mono text-[11px] text-muted-foreground">
                {item.className.startsWith("ws-")
                  ? item.className
                  : "PROMPT_CLASS"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </LiveExample>
  );
}

const firstTopicColor = allocateFamilyColor([]);
const topicColors = [firstTopicColor, allocateFamilyColor([firstTopicColor])];
const identityNames = ["Release tools", "Workstreams: Recaps"] as const;

const identitySamples = [
  { label: "Topic hue, first topic", tone: "accent", hue: 0 },
  { label: "Topic hue, second topic", tone: "accent", hue: 1 },
  { label: "Neutral", tone: "neutral", hue: 0 },
] as const;

function IdentityExample() {
  return (
    <LiveExample
      name="Icon and name"
      sources={["src/app/WorkstreamIcon.tsx", "src/app/WorkstreamName.tsx"]}
    >
      <Variants>
        {identitySamples.map(({ label, tone, hue }) => (
          <Variant key={label} label={label}>
            <div
              className="min-w-0 space-y-3 py-2"
              style={workstreamColorStyle(topicColors[hue]!) as CSSProperties}
            >
              {identityNames.map((name) => (
                <div key={name} className="flex min-w-0 items-center gap-2">
                  <WorkstreamIcon />
                  <WorkstreamName name={name} accent={tone === "accent"} />
                </div>
              ))}
            </div>
          </Variant>
        ))}
      </Variants>
    </LiveExample>
  );
}

const failingChecks: ReplyComponent = {
  type: "checks",
  title: "Display checks",
  scope: "Run on a 120 Hz display; CI has no display",
  testTotals: { passed: 41, failed: 1, skipped: 0 },
  items: [
    { name: "Held key moves one card at a time", status: "passed" },
    { name: "Burst longer than two cards is dropped", status: "passed" },
    {
      name: "Card settles within one frame of release",
      status: "failed",
      detail: "Settles after two frames.",
    },
    { name: "Reduced motion", status: "skipped" },
    {
      name: "Payment preview",
      status: "blocked",
      detail: "Needs the sandbox credential.",
    },
    { name: "60 Hz display", status: "untested" },
  ],
};
const replyParts: readonly [string, ReplyComponent][] = [
  ...Object.entries(COMPONENT_EXAMPLES).map(
    ([name, part]) =>
      [name[0]!.toUpperCase() + name.slice(1), part] as [
        string,
        ReplyComponent,
      ],
  ),
  ["Checks with a failure", failingChecks],
];

const replyAccents = (() => {
  const colors = [allocateFamilyColor([])];
  while (colors.length < 4) colors.push(allocateFamilyColor(colors));
  return colors;
})();

/** A specimen block read the way a thread reads it, drawn without bb's services. */
function Specimen({ block }: { block: string }) {
  const read = onlyReplyBlock(block);
  const parsed = read ? parse(read, { status: read.status }) : null;
  if (!parsed?.ok) return null;
  return (
    <div className="ws-reply-accent min-w-0 space-y-4 text-sm break-words [&_pre]:overflow-x-auto">
      <ReplyPanel
        headline={parsed.data.headline ?? parsed.data.card?.headline}
        body={parsed.data.body}
        document={undefined}
        files={null}
      />
    </div>
  );
}

function ReplyExample() {
  const change = COMPONENT_EXAMPLES.change;
  return (
    <div className="space-y-5">
      <LiveExample name="ReplyPanel" sources={["src/app/reply/PlainBody.tsx"]}>
        <Variants minWidth="34rem">
          {SPECIMENS.flatMap((specimen) =>
            specimen.messages.flatMap((message) =>
              message.from === "agent" ? (
                <Variant key={specimen.title} label={specimen.title} wide>
                  <Specimen block={message.block} />
                </Variant>
              ) : (
                []
              ),
            ),
          )}
        </Variants>
      </LiveExample>
      <LiveExample name="PlainBody" sources={["src/app/reply/PlainBody.tsx"]}>
        <Variants minWidth="26rem">
          {replyParts.map(([label, part]) => (
            <Variant key={label} label={label}>
              <div
                className="ws-reply-accent min-w-0 break-words"
                style={workstreamColorStyle(replyAccents[0]!)}
              >
                <PlainBody part={part} document={undefined} files={null} />
              </div>
            </Variant>
          ))}
        </Variants>
      </LiveExample>
      <LiveExample
        name="Workstream colors"
        sources={["src/app/reply/PlainBody.tsx"]}
      >
        <Variants minWidth="26rem">
          {[...replyAccents, null].map((accent, index) => (
            <Variant
              key={index}
              label={accent ? `Topic color ${index + 1}` : "Unfiled"}
            >
              <div
                className="ws-reply-accent min-w-0 break-words"
                style={accent ? workstreamColorStyle(accent) : undefined}
              >
                <PlainBody part={change} document={undefined} files={null} />
              </div>
            </Variant>
          ))}
        </Variants>
      </LiveExample>
    </div>
  );
}

function ControlsExample() {
  const [name, setName] = useState("Release summary");
  const [density, setDensity] = useState<"compact" | "full">("compact");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <LiveExample
        name="Buttons and fields"
        sources={[
          "components/ui/button.tsx",
          "components/ui/input.tsx",
          "components/ui/select.tsx",
        ]}
      >
        <Variants minWidth="14rem">
          <Variant label="Button, default">
            <div>
              <Button
                type="button"
                onClick={() =>
                  setStatus(
                    `Previewing ${name || "Untitled"} in ${density} layout`,
                  )
                }
              >
                Preview
              </Button>
            </div>
          </Variant>
          <Variant label="Button, outline">
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setName("Release summary");
                  setDensity("compact");
                  setStatus("Controls reset");
                }}
              >
                Reset
              </Button>
            </div>
          </Variant>
          <Variant label="Button, ghost">
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStatus("Draft discarded")}
              >
                Discard
              </Button>
            </div>
          </Variant>
          <Variant label="Button, disabled">
            <div>
              <Button type="button" variant="outline" disabled>
                Unavailable
              </Button>
            </div>
          </Variant>
          <Variant label="Input" note="Edit the name used by Preview.">
            <Input
              aria-label="Example name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Variant>
          <Variant
            label="Input, invalid"
            note="Marked aria-invalid; the red border is added by the caller."
          >
            <Input
              aria-label="Invalid example"
              aria-invalid
              className="border-destructive"
              value=""
              readOnly
            />
          </Variant>
          <Variant label="Input, disabled">
            <Input
              aria-label="Disabled example"
              value="Release summary"
              disabled
            />
          </Variant>
          <Variant label="Select" note="Choose the layout used by Preview.">
            <Select
              value={density}
              onValueChange={(next) => setDensity(next as typeof density)}
            >
              <SelectTrigger
                aria-label="Example layout"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </Variant>
          <Variant label="Select, disabled">
            <Select value="compact" disabled>
              <SelectTrigger
                aria-label="Disabled layout"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact</SelectItem>
              </SelectContent>
            </Select>
          </Variant>
        </Variants>
      </LiveExample>
      {status && (
        <GalleryNotes>
          <p role="status">{status}</p>
        </GalleryNotes>
      )}
    </div>
  );
}

export const examples: GalleryExample[] = [
  colorsExample,
  {
    id: "typography",
    title: "Type roles",
    group: "Foundations",
    description: "Sidebar and question text styles.",
    source: `import { PROMPT_CLASS } from "../src/app/question/question-presentation";\n\n<span className="ws-text-section">Workstreams</span>\n<span className="ws-text-workstream">Release tools</span>\n<span className="ws-text-category">Ready to review</span>\n<span className="ws-text-thread">Check the release notes</span>\n<div className={PROMPT_CLASS}>Which layout should we use?</div>`,
    render: () => <TypographyExample />,
  },
  {
    id: "work-identity",
    title: "Work identity",
    group: "Components",
    description: "The shared icon and name, with topic hues.",
    source: `import { WorkstreamIcon } from "../src/app/WorkstreamIcon";\nimport { WorkstreamName } from "../src/app/WorkstreamName";\nimport { allocateFamilyColor, workstreamColorStyle } from "../src/domain/workstreamColor";\n\n<div style={workstreamColorStyle(allocateFamilyColor([]))}>\n  <WorkstreamIcon />\n  <WorkstreamName name="Workstreams: Recaps" accent />\n</div>`,
    render: () => <IdentityExample />,
  },
  ...primitiveExamples,
  settingsExample,
  overlaysExample,
  recapExample,
  questionExample,
  {
    id: "reply-vocabulary",
    title: "Reply vocabulary",
    group: "Components",
    description:
      "Whole replies drawn as panels, then the eight reply components.",
    source: `import { PlainBody } from "../src/app/reply/PlainBody";\nimport type { ReplyComponent } from "../src/domain/replyComponents";\n\nconst part: ReplyComponent = ${JSON.stringify(
      COMPONENT_EXAMPLES.actions,
      null,
      2,
    )};\n\n<PlainBody part={part} document={undefined} files={null} />`,
    render: () => <ReplyExample />,
  },
  {
    id: "bb-controls",
    title: "BB controls",
    group: "Components",
    description: "Buttons, input, and select.",
    source: `import { Button } from "../components/ui/button";\nimport { Input } from "../components/ui/input";\nimport { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";\n\n<Input value={name} onChange={(event) => setName(event.target.value)} />\n<Select value={layout} onValueChange={setLayout}>\n  <SelectTrigger aria-label="Example layout"><SelectValue /></SelectTrigger>\n  <SelectContent>\n    <SelectItem value="compact">Compact</SelectItem>\n    <SelectItem value="full">Full</SelectItem>\n  </SelectContent>\n</Select>\n<Button onClick={preview}>Preview</Button>\n<Button variant="outline" onClick={reset}>Reset</Button>\n<Button variant="ghost" onClick={discard}>Discard</Button>\n<Button variant="outline" disabled>Unavailable</Button>`,
    render: () => <ControlsExample />,
  },
];

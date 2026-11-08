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
              "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
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
        name="Work identity composition"
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
    </div>
  );
}

const replyParts = [
  {
    type: "context",
    topic: "Release summary for the **checkout** service",
    where:
      "`~/Code/shop/_tasks/main/release-summary` on `tomdale/release-summary`",
    background:
      "The release adds the discount path and the receipt redesign. Both changes ship together because the receipt reads the new discount total.",
  },
  {
    type: "text",
    body: "The release adds **percentage discounts** and a revised receipt. The checkout service calculates the discount before tax.\n\nReview `services/checkout/discount.ts` alongside the receipt changes before approving the release.",
  },
  {
    type: "sequence",
    title: "Review the summary",
    steps: [
      {
        title: "Review the release scope",
        detail: "Confirm that the receipt and discount changes ship together.",
      },
      {
        title: "Approve the migration instructions",
        detail: "Each renamed option needs its replacement and an example.",
        attention: true,
      },
      { title: "Read the **checkout** package changes" },
      {
        title:
          "Compare the discount calculation and receipt totals across every package included in the release",
        detail:
          "Review `packages/checkout/src/discounts/percentage-discount.ts` alongside the shared receipt components. Both packages must use the same rounding rule.",
        attention: true,
      },
      {
        title: "Publish the release notes",
        detail: "Wait for approval of the payment integration.",
      },
    ],
  },
  {
    type: "comparison",
    title: "Choose the release scope",
    items: [
      {
        name: "Receipt and discounts",
        summary: "Ship the calculation and receipt changes together.",
        recommended: true,
        qualification: "Requires approval of the payment integration.",
        detail: "Both packages use the same rounding rule.",
      },
      {
        name: "Receipt only",
        summary: "Publish the receipt redesign first.",
        qualification: "The discount line needs the new checkout response.",
      },
      {
        name: "Discounts only",
        summary: "Publish the checkout calculation first.",
        detail: "The existing receipt will omit the discount breakdown.",
      },
    ],
  },
  {
    type: "change",
    title: "Summary layout",
    before: "The results and review steps use the same emphasis.",
    after: "Review steps follow the goal and results.",
    unchanged: "The source content.",
    limitation: "Payment integration awaits review.",
  },
  {
    type: "checks",
    title: "Release checks",
    scope: "Checkout summary and receipt layout",
    testTotals: { passed: 2, failed: 1, skipped: 1 },
    items: [
      { name: "Keyboard selection", status: "passed" },
      { name: "Long path wrapping", status: "passed" },
      {
        name: "Theme fallback",
        status: "failed",
        detail: "The receipt loses its selected theme after reload.",
      },
      {
        name: "Phone layout",
        status: "skipped",
        detail: "Needs a coarse-pointer viewport.",
      },
      {
        name: "BB interaction",
        status: "blocked",
        detail: "Awaiting access to the staging server.",
      },
      {
        name: "Physical-device behavior",
        status: "untested",
        detail: "Device testing is scheduled after staging review.",
      },
    ],
  },
  {
    type: "delivery",
    title: "Release delivery",
    scope: "Checkout summary and receipt layout",
    stages: [
      {
        name: "Build",
        status: "done",
        detail: "Plugin and Gallery bundles built.",
        evidence: [{ label: "Build scripts", location: "package.json" }],
      },
      {
        name: "Live installation",
        status: "pending",
        detail: "Awaiting deployment approval.",
      },
      {
        name: "Pushed",
        status: "blocked",
        detail: "Waits for the installation to finish.",
      },
      { name: "Release notes", status: "unknown" },
    ],
  },
  {
    type: "recommendation",
    choice: "Use the compact layout in a narrow pane.",
    reason:
      "It keeps the goal and the essential next step visible without scrolling, even when the card reports several results.",
    qualification: "Use Full when the result details matter during review.",
  },
  {
    type: "details",
    title: "Release details",
    body: "The checkout service applies the percentage discount before calculating tax. The receipt reads the resulting discount total from the checkout response.\n\n- `src/checkout/discount.ts` owns the rounding rule\n- Receipt tests cover zero, partial, and full discounts\n- Deployment awaits payment integration approval\n\n```sh\nnpm run test -- checkout\n```",
  },
  {
    type: "group",
    relationship: "peers",
    children: [
      {
        type: "details",
        title: "Discount path",
        body: "Applies a percentage discount before tax and rounds each line to the cent.",
      },
      {
        type: "details",
        title: "Receipt redesign",
        body: "Shows the discount as its own line under the subtotal, with the code that produced it.",
      },
      [
        {
          type: "context",
          topic: "Checkout API",
          where: "`services/checkout`",
        },
        {
          type: "text",
          body: "Returns the discount total beside the subtotal so the receipt can show each amount separately.",
        },
      ],
    ],
  },
  {
    type: "group",
    relationship: "supporting",
    children: [
      {
        type: "text",
        body: "Ship the discount path and the receipt redesign in the same release.",
      },
      {
        type: "details",
        title: "Why they ship together",
        body: "The receipt reads the new discount total. Shipping it alone would show an empty discount line on every order.",
      },
      [
        {
          type: "text",
          body: "The release has two remaining constraints:",
        },
        {
          type: "text",
          body: "- Payment integration remains unverified\n- Rollback restores both changes together",
        },
      ],
    ],
  },
] satisfies ReplyComponent[];

const replyAccents = (() => {
  const colors = [allocateFamilyColor([])];
  while (colors.length < 4) colors.push(allocateFamilyColor(colors));
  return colors;
})();

/** A sample's picker label; the two group samples differ by relationship. */
function replyLabel(part: ReplyComponent) {
  const name = part.type[0]!.toUpperCase() + part.type.slice(1);
  return part.type === "group" ? `${name} (${part.relationship})` : name;
}

function ReplyExample() {
  const [type, setType] = useState("Change");
  const [accent, setAccent] = useState("0");
  const part = replyParts.find((item) => replyLabel(item) === type)!;
  return (
    <div className="space-y-5">
      <GalleryControls>
        <ExampleChoice
          label="Reply component"
          value={type}
          onChange={setType}
          options={replyParts.map((item) => ({
            value: replyLabel(item),
            label: replyLabel(item),
          }))}
        />
        <ExampleChoice
          label="Workstream"
          value={accent}
          onChange={setAccent}
          options={[
            ...replyAccents.map((_, i) => ({
              value: String(i),
              label: `Topic color ${i + 1}`,
            })),
            { value: "none", label: "Unfiled" },
          ]}
        />
      </GalleryControls>
      <LiveExample name="PlainBody" sources={["src/app/reply/PlainBody.tsx"]}>
        <div
          className="ws-reply-accent min-w-0 break-words"
          style={
            accent === "none"
              ? undefined
              : workstreamColorStyle(replyAccents[Number(accent)]!)
          }
        >
          <PlainBody part={part} document={undefined} files={null} />
        </div>
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
        name="BB controls composition"
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
                setStatus(
                  `Previewing ${name || "Untitled"} in ${density} layout`,
                )
              }
            >
              Preview
            </Button>
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStatus("Draft discarded")}
            >
              Discard
            </Button>
            <Button type="button" variant="outline" disabled>
              {" "}
              {/* slop-ok: 1 Legible text: preserve the demonstrated BB control’s disabled styling */}
              Unavailable
            </Button>
          </div>
        </div>
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
    title: "Existing type roles",
    group: "Foundations",
    description: "Sidebar type roles and the question prompt.",
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
    description: "Ten information components in the recap card style.",
    source: `import { PlainBody } from "../src/app/reply/PlainBody";\nimport type { ReplyComponent } from "../src/domain/replyComponents";\n\nconst part: ReplyComponent = ${JSON.stringify(
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
    description: "Registry buttons, input, and select.",
    source: `import { Button } from "../components/ui/button";\nimport { Input } from "../components/ui/input";\nimport { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";\n\n<Input value={name} onChange={(event) => setName(event.target.value)} />\n<Select value={layout} onValueChange={setLayout}>\n  <SelectTrigger aria-label="Example layout"><SelectValue /></SelectTrigger>\n  <SelectContent>\n    <SelectItem value="compact">Compact</SelectItem>\n    <SelectItem value="full">Full</SelectItem>\n  </SelectContent>\n</Select>\n<Button onClick={preview}>Preview</Button>\n<Button variant="outline" onClick={reset}>Reset</Button>\n<Button variant="ghost" onClick={discard}>Discard</Button>\n<Button variant="outline" disabled>Unavailable</Button>`,
    render: () => <ControlsExample />,
  },
];

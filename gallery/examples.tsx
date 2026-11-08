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
import { PlainBody } from "../src/app/reply/PlainBody";
import type { ReplyComponent } from "../src/domain/replyComponents";
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

/** A sample's label; the two group samples differ by relationship. */
function replyLabel(part: ReplyComponent) {
  const name = part.type[0]!.toUpperCase() + part.type.slice(1);
  return part.type === "group" ? `${name} (${part.relationship})` : name;
}

function ReplyExample() {
  const context = replyParts.find((item) => item.type === "context")!;
  return (
    <div className="space-y-5">
      <LiveExample name="PlainBody" sources={["src/app/reply/PlainBody.tsx"]}>
        <Variants minWidth="26rem">
          {replyParts.map((part) => (
            <Variant key={replyLabel(part)} label={replyLabel(part)}>
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
                <PlainBody part={context} document={undefined} files={null} />
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
    description: "The ten reply components.",
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
    description: "Buttons, input, and select.",
    source: `import { Button } from "../components/ui/button";\nimport { Input } from "../components/ui/input";\nimport { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";\n\n<Input value={name} onChange={(event) => setName(event.target.value)} />\n<Select value={layout} onValueChange={setLayout}>\n  <SelectTrigger aria-label="Example layout"><SelectValue /></SelectTrigger>\n  <SelectContent>\n    <SelectItem value="compact">Compact</SelectItem>\n    <SelectItem value="full">Full</SelectItem>\n  </SelectContent>\n</Select>\n<Button onClick={preview}>Preview</Button>\n<Button variant="outline" onClick={reset}>Reset</Button>\n<Button variant="ghost" onClick={discard}>Discard</Button>\n<Button variant="outline" disabled>Unavailable</Button>`,
    render: () => <ControlsExample />,
  },
];

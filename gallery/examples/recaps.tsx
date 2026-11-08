import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  RecapCardPreview,
  type AgentView,
} from "../../src/app/composer/RecapCard";
import type { Recap } from "../../src/domain/recap";
import {
  RECAP_LAYOUT_OPTIONS,
  type RecapLayout,
} from "../../src/domain/recapPrefs";
import { ExampleChoice } from "../ExampleChoice";
import {
  GalleryControls,
  LiveExample,
  Variant,
  Variants,
} from "../ExampleFrame";
import type { GalleryExample } from "../examples";

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
        text: "Release notes include keyboard review steps",
        detail: "Review covers the footer actions",
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
    latest: ["The summary covers the receipt and discount changes"],
    review: [
      {
        text: "Review the package list and migration instructions",
        detail: "Confirm that each renamed option includes its replacement",
      },
      "Approve the release scope before publishing",
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

type Preset =
  "summary" | "goal-only" | "long" | "artifacts" | "hashes" | "next" | "agents";
type AgentState = "all" | AgentView["tone"];

const agentStates = [
  { value: "running", label: "Running", title: "Layout checks" },
  { value: "done", label: "Finished", title: "Keyboard review" },
  { value: "input", label: "Needs input", title: "Release scope" },
  { value: "error", label: "Errored", title: "Build checks" },
  { value: "unknown", label: "Unavailable", title: "Report review" },
] as const;

function agentFixtures(state: AgentState) {
  const selected = agentStates.filter(
    (agent) => state === "all" || agent.value === state,
  );
  const agents: Record<string, AgentView> = {};
  const waitingAgents = selected.map((agent) => {
    const threadId = `gallery-agent-${agent.value}`;
    agents[threadId] = {
      title: agent.value === "unknown" ? null : agent.title,
      href: null,
      tone: agent.value,
      label: agent.label,
    };
    return { threadId, task: `Check ${agent.title.toLowerCase()}` };
  });
  return { agents, waitingAgents };
}

function recapFor(
  preset: Preset,
  state: Recap["state"],
  waitingAgents: NonNullable<Recap["waitingAgents"]>,
): Recap {
  const recap = recaps[state];
  switch (preset) {
    case "goal-only":
      return {
        ...recapBase,
        state,
        goal:
          state === "waiting"
            ? "Waiting for the release report"
            : "The release summary fits in a narrow pane",
      };
    case "long":
      return {
        ...recap,
        goal:
          state === "waiting"
            ? "Waiting for the release summary and narrow-pane review"
            : "Prepared the release summary and its supporting review instructions",
        latest: [
          {
            text: "Release instructions include the publishing checklist",
            detail:
              "The checklist covers version numbers, package publishing, and release notes",
          },
          {
            text: "Long package paths remain part of the report",
            detail:
              "`packages/release-tools/src/reports/quarterly-release-summary.tsx` contains the summary",
          },
          {
            text: "Release notes separate package changes from migration instructions",
            detail:
              "Migration instructions cover renamed options and removed configuration fields",
          },
        ],
        review: [
          {
            text: "Review the release scope and supporting details",
            detail:
              "Confirm that the receipt and discount changes ship together",
          },
          {
            text: "Compare the package changes with the migration instructions",
            detail:
              "Each renamed option should include its replacement and a configuration example",
          },
          {
            text: "Compare the release notes with the package versions",
            detail:
              "The package list should include both checkout and shared components",
          },
        ],
      };
    case "artifacts":
      return {
        ...recap,
        links: [
          {
            title: "Design system",
            location:
              "https://github.com/tomdale/bb-plugin-workstreams/blob/main/docs/design-system.md",
          },
          {
            title: "Narrow layout screenshot",
            location: "/reports/screenshots/release-summary-narrow.png",
          },
          {
            title: "Package report with a long filename",
            location:
              "/reports/packages/release-tools/quarterly-release-summary-review.md",
          },
        ],
      };
    case "hashes":
      return {
        ...recap,
        goal:
          state === "waiting"
            ? "Waiting for commit review"
            : "Prepared commits for the release summary",
        latest: [
          "Context and details: c90f6a4be27432c637dffac40e4ea496b5023827",
          {
            text: "Comparison and recommendation: 4564b3bb01eea2023ed9301d76a52b24e4569d9c",
            detail:
              "Notes cover the release checklist and migration instructions",
          },
        ],
        review: [
          "Read the layout at c90f6a4be27432c637dffac40e4ea496b5023827",
          "Compare the supporting notes and their qualifications",
        ],
      };
    case "next":
      return {
        ...recap,
        next: [
          {
            title: "Review the summary",
            message: "Review the release summary copy and its qualifications",
            description:
              "Read the result before choosing the next release step",
          },
          {
            title: "Inspect narrow layout",
            message: "Inspect the summary in a narrow pane",
            description:
              "Check paths, artifact labels, and review instructions",
          },
          "Prepare a release checklist",
        ],
      };
    case "agents":
      return { ...recap, waitingAgents };
    default:
      return recap;
  }
}

const variants: readonly {
  label: string;
  preset: Preset;
  state: Recap["state"];
  hashColor?: "theme" | "semantic";
  note?: string;
}[] = [
  { label: "Release summary, review", preset: "summary", state: "review" },
  { label: "Release summary, complete", preset: "summary", state: "complete" },
  { label: "Release summary, waiting", preset: "summary", state: "waiting" },
  { label: "Goal only", preset: "goal-only", state: "complete" },
  { label: "Long results and review", preset: "long", state: "review" },
  {
    label: "Artifacts and file locations",
    preset: "artifacts",
    state: "review",
  },
  {
    label: "Commit hashes, theme defaults",
    preset: "hashes",
    state: "review",
    hashColor: "theme",
    note: "Hashes use the card's own color.",
  },
  {
    label: "Commit hashes, custom theme colors",
    preset: "hashes",
    state: "review",
    hashColor: "semantic",
    note: "Digits take one theme color and letters another.",
  },
  { label: "Multiple next actions", preset: "next", state: "review" },
  { label: "Awaited agent states", preset: "agents", state: "waiting" },
];

function RecapExample() {
  const [layout, setLayout] = useState<RecapLayout>("full");
  const [archive, setArchive] = useState(false);
  const [width, setWidth] = useState<"wide" | "narrow">("wide");
  const fixtures = agentFixtures("all");
  return (
    <div className="space-y-5">
      <GalleryControls label="Recap card options">
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
          }}
        >
          <ExampleChoice
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={RECAP_LAYOUT_OPTIONS}
          />
          <ExampleChoice
            label="Available width"
            value={width}
            onChange={setWidth}
            options={[
              { value: "wide", label: "Fill the pane" },
              { value: "narrow", label: "Narrow (320px)" },
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
      </GalleryControls>
      <LiveExample // slop-ok: 1 Keep the requested Live example frame and component identity
        name="RecapCardPreview"
        sources={["src/app/composer/RecapCard.tsx"]}
      >
        <Variants>
          {variants.map((variant) => (
            <Variant
              key={variant.label}
              label={variant.label}
              note={variant.note}
            >
              <div
                className="min-w-0 overflow-clip"
                style={{ maxWidth: width === "narrow" ? 320 : undefined }}
              >
                <RecapCardPreview
                  recap={recapFor(
                    variant.preset,
                    variant.state,
                    fixtures.waitingAgents,
                  )}
                  layout={layout}
                  showArchive={archive}
                  hashColors={
                    variant.hashColor === "semantic"
                      ? {
                          digits: "var(--ws-needs-you-text)",
                          letters: "var(--ws-complete-text)",
                        }
                      : undefined
                  }
                  agents={{
                    ...fixtures.agents,
                    "gallery-agent": {
                      title: "Layout checks",
                      href: null,
                      tone: "running",
                      label: "Running",
                    },
                  }}
                />
              </div>
            </Variant>
          ))}
        </Variants>
      </LiveExample>
    </div>
  );
}

export const recapExample: GalleryExample = {
  id: "recap-card",
  title: "Recap card",
  group: "Components",
  description:
    "Results, review steps, artifacts, next actions, and awaited agents.",
  source: `import { RecapCardPreview } from "../../src/app/composer/RecapCard";
import type { Recap } from "../../src/domain/recap";

const recap: Recap = ${JSON.stringify(recapFor("hashes", "review", []), null, 2)};

<RecapCardPreview recap={recap} layout="full" showArchive={false}
  hashColors={{ digits: "var(--ws-needs-you-text)", letters: "var(--ws-complete-text)" }} />

<RecapCardPreview layout="full"
  recap={{ ...recap, state: "waiting", waitingAgents: [
    { threadId: "gallery-agent", task: "Check the narrow layout" },
  ] }}
  agents={{ "gallery-agent": {
    title: "Layout checks", href: null, tone: "running", label: "Running",
  } }} />`,
  render: () => <RecapExample />,
};

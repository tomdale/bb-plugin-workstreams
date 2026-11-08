import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  RecapCardPreview,
  type AgentView,
} from "../../src/app/composer/RecapCard";
import { COLOR_TOKEN_LABEL } from "../../src/domain/colors";
import { RECAP_STATES, type Recap } from "../../src/domain/recap";
import {
  RECAP_LAYOUT_OPTIONS,
  type RecapLayout,
} from "../../src/domain/recapPrefs";
import { ExampleChoice } from "../ExampleChoice";
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

const presets = [
  { value: "summary", label: "Release summary" },
  { value: "goal-only", label: "Goal only" },
  { value: "long", label: "Long results and review" },
  { value: "artifacts", label: "Artifacts and file locations" },
  { value: "hashes", label: "Commit hashes" },
  { value: "next", label: "Multiple next actions" },
  { value: "agents", label: "Awaited agent states" },
] as const;
type Preset = (typeof presets)[number]["value"];
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
            text: "Release instructions keep each result beside the qualification that limits it",
            detail:
              "Synthetic example: the fixture describes checks, but no build, deployment, or live inspection ran",
          },
          {
            text: "Long package paths remain part of the report",
            detail:
              "`packages/release-tools/src/reports/quarterly-release-summary.tsx` identifies the example module",
          },
          {
            text: "Review notes distinguish local preparation from live deployment",
            detail:
              "The gallery renders this text with the production card; it does not independently verify the claims",
          },
        ],
        review: [
          {
            text: "Read the summary and its supporting details at a narrow width",
            detail:
              "Expect the card to keep the goal above the results, with qualifications on secondary lines",
          },
          {
            text: "Compare Full and Compact before choosing the amount of context",
            detail:
              "Compact keeps review steps for review cards; Full also includes the completed results",
          },
          {
            text: "Check the same content in both light and dark themes",
            detail:
              "The text, state label, border, and footer use the loaded theme; this fixture makes no contrast claim",
          },
        ],
      };
    case "artifacts":
      return {
        ...recap,
        links: [
          {
            title: "Release summary",
            location: "https://example.com/gallery/release-summary",
          },
          {
            title: "Narrow layout screenshot",
            location:
              "/gallery-fixtures/screenshots/release-summary-narrow.png",
          },
          {
            title: "Package report with a long filename",
            location:
              "/gallery-fixtures/reports/packages/release-tools/quarterly-release-summary-review.md",
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
          "Summary layout: a1b2c3d4e5f678901234567890abcdef1234567890",
          {
            text: "Review notes: 9f8e7d6c5b4a32100123456789abcdef01234567",
            detail:
              "Synthetic commit identifiers, not changes in this repository",
          },
        ],
        review: [
          "Read the layout at a1b2c3d4e5f678901234567890abcdef1234567890",
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

function RecapExample() {
  const [preset, setPreset] = useState<Preset>("summary");
  const [state, setState] = useState<Recap["state"]>("review");
  const [layout, setLayout] = useState<RecapLayout>("full");
  const [archive, setArchive] = useState(false);
  const [width, setWidth] = useState<"wide" | "narrow">("wide");
  const [hashColor, setHashColor] = useState<"theme" | "semantic">("theme");
  const [agentState, setAgentState] = useState<AgentState>("all");
  const fixtures = agentFixtures(agentState);
  const recap = recapFor(preset, state, fixtures.waitingAgents);
  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
        }}
      >
        <ExampleChoice
          label="Recap preset"
          value={preset}
          options={presets}
          onChange={(value) => {
            setPreset(value);
            setState(
              value === "agents"
                ? "waiting"
                : value === "goal-only"
                  ? "complete"
                  : "review",
            );
          }}
        />
        <ExampleChoice
          label="Reported state"
          value={state}
          onChange={setState}
          options={RECAP_STATES.map((value) => ({
            value,
            label: COLOR_TOKEN_LABEL[value],
          }))}
        />
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
            { value: "narrow", label: "Narrow · 320px" },
          ]}
        />
        {preset === "hashes" ? (
          <ExampleChoice
            label="Hash colors"
            value={hashColor}
            onChange={setHashColor}
            options={[
              { value: "theme", label: "Theme defaults" },
              { value: "semantic", label: "Custom · loaded theme colors" },
            ]}
          />
        ) : null}
        {preset === "agents" ? (
          <ExampleChoice
            label="Awaited agent state"
            value={agentState}
            onChange={setAgentState}
            options={[
              { value: "all", label: "All states" },
              ...agentStates.map((agent) => ({
                value: agent.value,
                label: agent.label,
              })),
            ]}
          />
        ) : null}
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
        className="mx-auto min-w-0 overflow-clip"
        style={{ maxWidth: width === "narrow" ? 320 : undefined }}
      >
        <RecapCardPreview
          recap={recap}
          layout={layout}
          showArchive={archive}
          hashColors={
            preset === "hashes" && hashColor === "semantic"
              ? {
                  digits: "var(--ws-review-text)",
                  letters: "var(--ws-needs-you-text)",
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        The production preview is inert: dismiss, Archive, next actions, links,
        and hash copying cannot act on BB. Waiting uses fixture agents without a
        scheduled check; “Checking now” is display text. Artifacts are synthetic
        HTTPS and file locations, not available documents. Artifact chips appear
        in Review; Compact omits completed results on review cards. Next actions
        can collapse to a disabled menu at narrow widths, not an interactive
        action-menu demo.
      </p>
    </div>
  );
}

export const recapExample: GalleryExample = {
  id: "recap-card",
  title: "Recap card",
  group: "Components",
  description:
    "The actual inert preview with reported state, layout, width, goal-only and long content, artifacts, commit colors, next actions, and awaited agent states.",
  source: `import { RecapCardPreview } from "../../src/app/composer/RecapCard";
import type { Recap } from "../../src/domain/recap";

const recap: Recap = ${JSON.stringify(recapFor("hashes", "review", []), null, 2)};

<RecapCardPreview recap={recap} layout="full" showArchive={false}
  hashColors={{ digits: "var(--ws-review-text)", letters: "var(--ws-needs-you-text)" }} />

// Stand-in agent views prevent live thread reads; all previews stay inert.
<RecapCardPreview layout="full"
  recap={{ ...recap, state: "waiting", waitingAgents: [
    { threadId: "gallery-agent", task: "Check the narrow layout" },
  ] }}
  agents={{ "gallery-agent": {
    title: "Layout checks", href: null, tone: "running", label: "Running",
  } }} />`,
  render: () => <RecapExample />,
};

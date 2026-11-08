import type { TidyEdit, TidyInput } from "../src/domain/tidy.ts";

/**
 * An edit a case expects or forbids, matched on its operation and the topics
 * or thread it names; a rename on a move doesn't change the match.
 */
export type EditPattern =
  | { op: "merge"; from: string; into: string }
  | { op: "reparent"; topic: string; parent: string | null }
  | { op: "move"; thread: string; topic: string }
  | { op: "rename"; topic: string };

export type TidyCase = {
  id: string;
  /** What the case checks, for the report. */
  about: string;
  input: TidyInput;
  /** Each must appear; one of a list's alternatives is enough. */
  expect: (EditPattern | EditPattern[])[];
  /** None may appear. */
  forbid: EditPattern[];
  /** When a move expects a rename, the name it should end with. */
  names?: Record<string, string>;
};

type Row = [id: string, name: string, parent: string | null, about: string];

const topics = (rows: Row[]) =>
  rows.map(([id, name, parentId, description]) => ({
    id,
    name,
    parentId,
    description,
    aliases: [],
  }));

/** Threads as `topicId: title` lines; each gets the ID `<topic>-<n>`. */
const threads = (lines: string[]) =>
  lines.map((entry, i) => {
    const at = entry.indexOf(":");
    const topicId = entry.slice(0, at).trim();
    return {
      id: `${topicId}-${i + 1}`,
      title: entry.slice(at + 1).trim(),
      checkout: null,
      topicId: topicId === "unfiled" ? null : topicId,
    };
  });

const input = (rows: Row[], lines: string[]): TidyInput => {
  const list = threads(lines);
  const held: Record<string, number> = {};
  for (const t of list)
    if (t.topicId) held[t.topicId] = (held[t.topicId] ?? 0) + 1;
  return {
    topics: topics(rows),
    held,
    threads: list,
    coordination: [],
    decisions: [],
    declined: [],
  };
};

/** The rest of a workspace, so each case's tree reads like a real one. */
const BACKDROP: Row[] = [
  ["kit", "Toolkit", null, "Personal scripts and shell setup"],
  ["kit-shell", "Shell Setup", "kit", "Shell startup and prompt"],
  ["kit-sync", "Dotfile Sync", "kit", "Syncing configuration across machines"],
  [
    "garden",
    "Garden Planner",
    null,
    "Personal app for planning a vegetable garden",
  ],
];
const BACKDROP_THREADS = [
  "kit-shell: Speed up shell startup",
  "kit-shell: Fix prompt colors in tmux",
  "kit-sync: Sync editor settings to the laptop",
  "kit-sync: Resolve dotfile merge conflict",
  "garden: Add frost date lookup",
  "garden: Plan raised bed layout",
];

export const cases: TidyCase[] = [
  {
    id: "prefix-sibling",
    about:
      "A top-level topic named for a part of another product moves under it",
    input: input(
      [
        ...BACKDROP,
        ["beacon", "Beacon", null, "Investigation assistant product at work"],
        [
          "auto",
          "Automations",
          "beacon",
          "Scheduled and triggered assistant runs",
        ],
        [
          "auto-alerts",
          "Alert Investigations",
          "auto",
          "Automations that investigate alerts",
        ],
        ["auto-design", "Design", "auto", "Designing the automations product"],
        [
          "review",
          "Beacon Code Review",
          null,
          "Beacon's pull request review feature",
        ],
        [
          "review-approvals",
          "PR Approvals",
          "review",
          "Approving pull requests automatically",
        ],
        [
          "review-ship",
          "Feature Shipping",
          "review",
          "Shipping review features",
        ],
      ],
      [
        ...BACKDROP_THREADS,
        "auto-alerts: Rebase alert investigation PR",
        "auto-alerts: Verify alert investigation in staging",
        "auto-design: Design automations MVP",
        "auto-design: Plan automations CLI commands",
        "review-approvals: Gate auto-approval behind a flag",
        "review-approvals: Align approval billing",
        "review-ship: Ship inline review summaries",
        "review-ship: Roll out review comments to all repos",
      ],
    ),
    expect: [{ op: "reparent", topic: "review", parent: "beacon" }],
    forbid: [
      { op: "merge", from: "review", into: "beacon" },
      { op: "merge", from: "review", into: "auto" },
    ],
    names: { review: "Code Review" },
  },
  {
    id: "nested-redundant-prefix",
    about:
      "An already nested topic repeats its parent's name and should be renamed locally",
    input: input(
      [
        ...BACKDROP,
        ["tom", "tomdaleOS", null, "Personal application and workflows"],
        [
          "preview",
          "TomdaleOS Preview Environment",
          "tom",
          "Preview deployment environments and session validation",
        ],
        ["prompting", "Prompting", "tom", "Improving prompts"],
      ],
      [
        ...BACKDROP_THREADS,
        "preview: Validate preview cookies",
        "preview: Test a preview session",
        "prompting: Improve first-turn prompts",
      ],
    ),
    expect: [{ op: "rename", topic: "preview" }],
    forbid: [
      { op: "reparent", topic: "preview", parent: null },
      { op: "merge", from: "preview", into: "tom" },
    ],
    names: { preview: "Preview Environment" },
  },
  {
    id: "nested-redundant-suffix",
    about: "A child repeats its parent's name at the end rather than the start",
    input: input(
      [
        ...BACKDROP,
        ["lantern", "Lantern", null, "Lantern application"],
        [
          "billing",
          "Billing for Lantern",
          "lantern",
          "Billing for the application",
        ],
        ["search", "Search", "lantern", "Search feature"],
      ],
      [
        ...BACKDROP_THREADS,
        "billing: Fix payment retry",
        "search: Improve search",
      ],
    ),
    expect: [{ op: "rename", topic: "billing" }],
    forbid: [{ op: "reparent", topic: "billing", parent: null }],
    names: { billing: "Billing" },
  },
  {
    id: "distinct-established-name",
    about:
      "A child whose complete name denotes a distinct product stays intact",
    input: input(
      [
        ...BACKDROP,
        ["lumen", "Lumen", null, "Lumen family of developer products"],
        [
          "lumen-sdk",
          "Lumen SDK",
          "lumen",
          "The independently named Lumen SDK product",
        ],
        ["mobile", "Mobile", "lumen", "Mobile application"],
      ],
      [
        ...BACKDROP_THREADS,
        "lumen-sdk: Document the Lumen SDK",
        "mobile: Fix navigation",
      ],
    ),
    expect: [],
    forbid: [{ op: "rename", topic: "lumen-sdk" }],
  },
  {
    id: "described-part",
    about:
      "A top-level topic whose description says it's part of another product moves under it",
    input: input(
      [
        ...BACKDROP,
        ["beacon", "Beacon", null, "Investigation assistant product at work"],
        [
          "auto",
          "Automations",
          "beacon",
          "Scheduled and triggered assistant runs",
        ],
        ["evals", "Evals", "beacon", "Evaluating Beacon's answers"],
        ["search", "Web Search", null, "Beacon's web search tool"],
      ],
      [
        ...BACKDROP_THREADS,
        "auto: Design automations MVP",
        "auto: Fix flaky trigger test",
        "evals: Deflake answer quality eval",
        "search: Add source citations to Beacon web search",
        "search: Cap web search latency",
      ],
    ),
    expect: [{ op: "reparent", topic: "search", parent: "beacon" }],
    forbid: [{ op: "merge", from: "search", into: "evals" }],
  },
  {
    id: "near-duplicate",
    about: "Two top-level topics for one product merge",
    input: input(
      [
        ...BACKDROP,
        [
          "streams",
          "Streams Plugin",
          null,
          "Sidebar plugin that groups agent threads",
        ],
        ["streams-ui", "Sidebar", "streams", "The plugin's sidebar"],
        [
          "streams-org",
          "Organize",
          "streams",
          "Organizing threads into groups",
        ],
        ["streams2", "Streams", null, "The Streams sidebar plugin"],
      ],
      [
        ...BACKDROP_THREADS,
        "streams-ui: Fix collapsed group counts",
        "streams-ui: Dim prefixes in group headers",
        "streams-org: Nest groups by topic",
        "streams-org: Suggest splits for busy groups",
        "streams2: Snooze presets for Streams threads",
      ],
    ),
    expect: [
      [
        { op: "merge", from: "streams2", into: "streams" },
        { op: "reparent", topic: "streams2", parent: "streams" },
      ],
    ],
    forbid: [{ op: "merge", from: "streams", into: "streams2" }],
  },
  {
    id: "false-friend",
    about:
      "A personal tool named like a work product's capability stays where it is",
    input: input(
      [
        ...BACKDROP,
        ["beacon", "Beacon", null, "Investigation assistant product at work"],
        [
          "auto",
          "Automations",
          "beacon",
          "Scheduled and triggered assistant runs",
        ],
        [
          "auto-alerts",
          "Alert Investigations",
          "auto",
          "Automations that investigate alerts",
        ],
        ["auto-design", "Design", "auto", "Designing the automations product"],
        [
          "cron",
          "Cron Automation",
          null,
          "A personal plugin that runs agent prompts on a schedule",
        ],
      ],
      [
        ...BACKDROP_THREADS,
        "auto-alerts: Rebase alert investigation PR",
        "auto-alerts: Verify alert investigation in staging",
        "auto-design: Design automations MVP",
        "auto-design: Plan automations CLI commands",
        "cron: Add a cron schedule picker to my plugin",
        "cron: Retry failed scheduled prompts",
      ],
    ),
    expect: [],
    forbid: [
      { op: "reparent", topic: "cron", parent: "auto" },
      { op: "reparent", topic: "cron", parent: "beacon" },
      { op: "merge", from: "cron", into: "auto" },
    ],
  },
  {
    id: "clean",
    about: "A clean tree gets no structural edits",
    input: input(
      [
        ...BACKDROP,
        ["beacon", "Beacon", null, "Investigation assistant product at work"],
        [
          "auto",
          "Automations",
          "beacon",
          "Scheduled and triggered assistant runs",
        ],
        [
          "review",
          "Code Review",
          "beacon",
          "Beacon's pull request review feature",
        ],
      ],
      [
        ...BACKDROP_THREADS,
        "auto: Design automations MVP",
        "auto: Fix flaky trigger test",
        "review: Gate auto-approval behind a flag",
        "review: Ship inline review summaries",
      ],
    ),
    expect: [],
    forbid: [
      { op: "merge", from: "auto", into: "review" },
      { op: "merge", from: "review", into: "auto" },
      { op: "reparent", topic: "garden", parent: "kit" },
      { op: "reparent", topic: "kit", parent: null },
    ],
  },
];

/** Whether `edit` matches `pattern`, ignoring a rename on a move. */
export function matches(edit: TidyEdit, pattern: EditPattern): boolean {
  if (edit.op !== pattern.op) return false;
  switch (pattern.op) {
    case "merge":
      return (
        edit.op === "merge" &&
        edit.from === pattern.from &&
        edit.into === pattern.into
      );
    case "reparent":
      return (
        edit.op === "reparent" &&
        edit.topic === pattern.topic &&
        edit.parent === pattern.parent
      );
    case "move":
      return (
        edit.op === "move" &&
        edit.thread === pattern.thread &&
        edit.topic === pattern.topic
      );
    case "rename":
      return edit.op === "rename" && edit.topic === pattern.topic;
  }
}

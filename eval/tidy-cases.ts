import type { TidyEdit, TidyInput } from "../src/domain/tidy.ts";

/**
 * An edit a case expects or forbids, matched on its operation and the
 * workstreams or thread it names; a rename on a move doesn't change the match.
 */
export type EditPattern =
  | { op: "merge"; from: string; into: string }
  | { op: "move-workstream"; workstream: string; parent: string | null }
  | { op: "move-thread"; thread: string; workstream: string }
  | { op: "rename"; workstream: string };

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

const workstreams = (rows: Row[]) =>
  rows.map(([id, name, parentId, description]) => ({
    id,
    name,
    parentId,
    description,
    aliases: [],
  }));

/**
 * Threads as `workstreamId: title` lines; each gets the ID
 * `<workstream>-<n>`.
 */
const threads = (lines: string[]) =>
  lines.map((entry, i) => {
    const at = entry.indexOf(":");
    const workstreamId = entry.slice(0, at).trim();
    return {
      id: `${workstreamId}-${i + 1}`,
      title: entry.slice(at + 1).trim(),
      checkout: null,
      workstreamId: workstreamId === "other" ? null : workstreamId,
    };
  });

const input = (rows: Row[], lines: string[]): TidyInput => {
  const list = threads(lines);
  const held: Record<string, number> = {};
  for (const t of list)
    if (t.workstreamId) held[t.workstreamId] = (held[t.workstreamId] ?? 0) + 1;
  return {
    workstreams: workstreams(rows),
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
      "A top-level workstream named for part of a product moves into that product's group",
    input: input(
      [
        ...BACKDROP,
        ["beacon", "Beacon", null, "Investigation assistant product at work"],
        [
          "auto-alerts",
          "Alert Investigations",
          "beacon",
          "Automations that investigate alerts",
        ],
        [
          "auto-design",
          "Automations Design",
          "beacon",
          "Designing the automations product",
        ],
        [
          "review",
          "Beacon Code Review",
          null,
          "Beacon's pull request review feature",
        ],
      ],
      [
        ...BACKDROP_THREADS,
        "auto-alerts: Rebase alert investigation PR",
        "auto-alerts: Verify alert investigation in staging",
        "auto-design: Design automations MVP",
        "auto-design: Plan automations CLI commands",
        "review: Gate auto-approval behind a flag",
        "review: Align approval billing",
        "review: Ship inline review summaries",
        "review: Roll out review comments to all repos",
      ],
    ),
    expect: [{ op: "move-workstream", workstream: "review", parent: "beacon" }],
    forbid: [
      { op: "merge", from: "review", into: "beacon" },
      { op: "merge", from: "review", into: "auto-alerts" },
    ],
    names: { review: "Code Review" },
  },
  {
    id: "nested-redundant-prefix",
    about:
      "An already nested workstream repeats its parent's name and should be renamed locally",
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
    expect: [{ op: "rename", workstream: "preview" }],
    forbid: [
      { op: "move-workstream", workstream: "preview", parent: null },
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
    expect: [{ op: "rename", workstream: "billing" }],
    forbid: [{ op: "move-workstream", workstream: "billing", parent: null }],
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
    forbid: [{ op: "rename", workstream: "lumen-sdk" }],
  },
  {
    id: "described-part",
    about:
      "A top-level workstream whose description says it's part of another product moves under it",
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
    expect: [{ op: "move-workstream", workstream: "search", parent: "beacon" }],
    forbid: [{ op: "merge", from: "search", into: "evals" }],
  },
  {
    id: "near-duplicate",
    about: "A top-level workstream joins a group for the same product",
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
      { op: "move-workstream", workstream: "streams2", parent: "streams" },
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
          "auto-alerts",
          "Alert Investigations",
          "beacon",
          "Automations that investigate alerts",
        ],
        [
          "auto-design",
          "Automations Design",
          "beacon",
          "Designing the automations product",
        ],
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
      { op: "move-workstream", workstream: "cron", parent: "beacon" },
      { op: "merge", from: "cron", into: "auto-alerts" },
      { op: "merge", from: "cron", into: "auto-design" },
    ],
  },
  {
    id: "capability-in-category",
    about:
      "A product's capability joins the product's category group, not a third level under the product",
    input: input(
      [
        ...BACKDROP,
        ["acme", "Acme", null, "Work at Acme"],
        ["beacon", "Beacon", "acme", "Acme's investigation assistant product"],
        ["ledger", "Ledger", "acme", "Acme's billing product"],
        ["search", "Beacon Web Search", null, "Beacon's web search tool"],
      ],
      [
        ...BACKDROP_THREADS,
        "beacon: Fix investigation timeline ordering",
        "beacon: Add Slack summaries to investigations",
        "ledger: Retry failed invoice exports",
        "search: Add source citations to Beacon web search",
        "search: Cap web search latency",
      ],
    ),
    expect: [
      [
        { op: "move-workstream", workstream: "search", parent: "acme" },
        { op: "merge", from: "search", into: "beacon" },
      ],
    ],
    forbid: [{ op: "move-workstream", workstream: "search", parent: "ledger" }],
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
      { op: "move-workstream", workstream: "garden", parent: "kit" },
      { op: "move-workstream", workstream: "kit", parent: null },
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
    case "move-workstream":
      return (
        edit.op === "move-workstream" &&
        edit.workstream === pattern.workstream &&
        edit.parent === pattern.parent
      );
    case "move-thread":
      return (
        edit.op === "move-thread" &&
        edit.thread === pattern.thread &&
        edit.workstream === pattern.workstream
      );
    case "rename":
      return edit.op === "rename" && edit.workstream === pattern.workstream;
  }
}

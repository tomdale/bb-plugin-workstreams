/**
 * Synthetic opening requests and where each thread is listed, for the title
 * evaluation. Each mirrors a pattern that reads badly in the sidebar: a child
 * thread repeating its parent, a title repeating its workstream, a pull
 * request named only by number, or a plan named for the plan.
 */
export type TitleCase = {
  id: string;
  request: string;
  /** The workstream the thread is listed under, as a topic path. */
  group?: string;
  /** The parent thread's title, for a child thread. */
  parent?: string;
  /** Each list needs one of its words in the title (case-insensitive). */
  must: string[][];
  /** None of these may appear: context the sidebar shows already. */
  avoid: string[];
  /** The request doesn't say what the work is, so no title. */
  untitled?: boolean;
};

export const titleCases: TitleCase[] = [
  {
    id: "child-phase",
    group: "Harbor: Sandbox Plugin",
    parent: "Build Harbor Access sandbox tunnel",
    request:
      "Implement Phase 0 of the Harbor Access plan in docs/access-plan.md: the machine registry and the tunnel handshake stub. Stop after Phase 0 and report.",
    must: [["phase 0"]],
    avoid: ["harbor", "access"],
  },
  {
    id: "child-review",
    group: "Harbor: Sandbox Plugin",
    parent: "Build Harbor Access sandbox tunnel",
    request:
      "Review the Phase 1 transport implementation on branch tunnel-phase-1 for security problems and boundary violations. Read-only: report findings, don't edit.",
    must: [["phase 1"], ["security", "boundar"]],
    avoid: ["harbor", "access", "tunnel"],
  },
  {
    id: "child-checkpoint",
    group: "Harbor: Sandbox Plugin",
    parent: "Build Harbor Access sandbox tunnel",
    request:
      "Checkpoint review of Phase 2: check the lifecycle of relay connections (open, idle timeout, teardown) against the plan before we continue.",
    must: [["phase 2", "lifecycle"]],
    avoid: ["harbor", "access"],
  },
  {
    id: "pr-number",
    group: "Beacon: Code Review",
    request:
      "Review beacon/agents PR 4842. It adds a live status comment that the review bot updates while a review runs, instead of posting a new comment each time.",
    must: [["status", "comment"]],
    avoid: ["beacon", "4842", "code review"],
  },
  {
    id: "pr-checks",
    group: "Ledger: Billing",
    request:
      "The checks on ledger/api PR 89240 are failing: lint errors and a type error in the invoice webhook handler. Fix them and push.",
    must: [["webhook", "invoice", "checks", "lint"]],
    avoid: ["ledger", "89240"],
  },
  {
    id: "plan-doc",
    group: "Streams Plugin",
    request:
      "Turn the design in docs/Ideal Hierarchies.md into a plan, then implement it. It covers the partition rule, the depth cap and promotion, placement with a model, and tidy passes.",
    must: [["hierarch", "partition", "topic", "placement"]],
    avoid: ["streams", "design plan"],
  },
  {
    id: "group-name",
    group: "Inside Harbor",
    request:
      "Rewrite the Inside Harbor book series in the new house voice: shorter sentences, fewer asides, and a summary box per chapter.",
    must: [["voice", "rewrite", "series", "book"]],
    avoid: ["inside harbor"],
  },
  {
    id: "group-feature",
    group: "Beacon: Code Review",
    request:
      "Explain how Beacon's security review works end to end: which service starts it, where findings are stored, and how they reach the PR.",
    must: [["security"]],
    avoid: ["beacon", "code review"],
  },
  {
    id: "long-object",
    group: "Streams Plugin: Recap Cards",
    request:
      "Recap cards lost the completed tasks list and the next action after the refactor. Bring both back, matching the old layout.",
    must: [["task", "next action"]],
    avoid: ["streams", "recap card"],
  },
  {
    id: "unfiled",
    request:
      "Investigate why the dev server's memory grows after every hot reload until it crashes after an hour or so.",
    must: [
      ["memory", "leak"],
      ["dev server", "hot reload", "reload"],
    ],
    avoid: [],
  },
  {
    id: "bare",
    request: "continue",
    must: [],
    avoid: [],
    untitled: true,
  },
];

/** -ing verbs that don't say what kind of work a thread is. */
export const VAGUE_VERBS = ["working", "handling", "doing", "continuing"];

/**
 * The specimens the Gallery shows: a short transcript whose replies together
 * use every part a reply block accepts, plus the two states that cannot be
 * authored on purpose. Blocks are built from `componentFence`, so each
 * component is a typed object rather than hand-written JSON.
 */
import { componentFence } from "../../domain/replyExamples.ts";
import type { ReplyComponent } from "../../domain/replyComponents.ts";

type AgentReply = {
  from: "agent";
  /** The `:::reply` block source, exactly as an agent writes it. */
  block: string;
  /** What this reply demonstrates, shown as a caption. */
  features: readonly string[];
};
type UserMessage = { from: "user"; text: string };
export type GalleryMessage = UserMessage | AgentReply;

export type Specimen = {
  title: string;
  intro: string;
  messages: readonly GalleryMessage[];
};

const block = (kind: string, parts: readonly string[]): string =>
  [`:::reply{v="1" kind="${kind}"}`, ...parts, ":::"].join("\n\n");

/** A bare directive, rendered by bb's installed directive plugins. */
const DIRECTIVE =
  '::inline-vis{source="thread-storage" file="queue-replay.html"}';

const investigation = block("investigation", [
  "# The held key reads the card's position from the render that started the burst",
  "Key auto-repeat fires about thirty times a second, and every repeat runs the same handler, captured when the card was where the burst began. The card moves once, and each later repeat asks for the same move again — so the queue appears to skip ahead by however many repeats arrived before the next render.",
  componentFence({
    type: "context",
    topic: "Queue card keyboard handling",
    where: "src/app/page/queue/Queue.tsx",
    background:
      "The queue listens on the window, and the handler's position comes from the render that registered it.",
  } satisfies ReplyComponent),
  componentFence({
    type: "finding",
    title: "Auto-repeat reads a stale position",
    explanation:
      "The handler is registered once per render with the focused item's index. A repeat event re-runs that handler with the index it closed over, so it applies the same offset again instead of the next one.",
    certainty: "observed",
    consequence:
      "Fast repeated presses move the card farther than the number of presses.",
    evidence: [
      {
        label: "Key handler",
        detail: "The effect depends on the index, so it re-registers.",
        location: "src/app/page/queue/Queue.tsx",
        line: 308,
        endLine: 322,
      },
      {
        label: "Replay fixture",
        location:
          "https://github.com/tomdale/bb-plugin-workstreams/blob/main/tests/app/motion.test.ts",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "text",
    body: "A held key is one gesture, so it should move the card one place per step and no more than two ahead. The bug is in when the handler learns where the card is, not in how many moves it asks for.",
  } satisfies ReplyComponent),
  componentFence({
    type: "sequence",
    title: "Reproduce it",
    steps: [
      {
        title: "Hold ↓ for two seconds",
        detail: "About sixty keydown events arrive at the window.",
        attention: true,
      },
      {
        title: "Count the cards the queue passed",
        detail: "More than sixty with the stale handler; sixty with a ref.",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "comparison",
    title: "Two ways to read the position",
    items: [
      {
        name: "Read the latest index from a ref",
        summary:
          "The handler stays registered and asks the ref where the card is.",
        qualification:
          "Keeps one listener for the whole burst and needs no re-subscription.",
        recommended: true,
      },
      {
        name: "Re-subscribe on every render",
        summary:
          "Tear the handler down and rebuild it whenever the index changes.",
        detail:
          "Correct, but it adds a listener removal and addition for every card the user steps through.",
        qualification: "Noisier under a release build that batches updates.",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "group",
    relationship: "peers",
    children: [
      [
        {
          type: "text",
          body: "The queue's arrow keys and the card's own buttons move by the same offset, so both paths need the same fix.",
        },
        {
          type: "text",
          body: "Nothing else reads the closed-over index; the sidebar and the composer take their position from props.",
        },
      ],
      {
        type: "recommendation",
        choice: "Read the index from a ref",
        reason:
          "It removes the stale read without changing when the handler is registered, so the burst stays one listener.",
        qualification: "Revert if a future card can move without a keystroke.",
      },
    ],
  } satisfies ReplyComponent),
  "### Details",
  "The handler is registered in an effect whose dependency list includes the focused index, so it is rebuilt after each render. A keydown that arrives before React commits the new index runs the previous closure. Wrapping the index in a ref keeps the closure stable and lets every event read the value the last commit wrote.",
]);

const delivered = block("change", [
  "# The held key moves the card one place per press",
  "The handler now reads the card's position from a ref, so a burst of repeats all see the position the last commit wrote. Held keys are capped at two cards ahead, and a burst longer than that is dropped rather than queued.",
  DIRECTIVE,
  componentFence({
    type: "change",
    title: "Queue card keys",
    before: "A held key re-read a stale index and skipped several cards",
    after: "Each press moves one card, and a release settles the card at once",
    unchanged: "Clicking a card, and the keyboard shortcuts for send and edit",
    limitation:
      "A burst that starts while the thread list reloads still waits for that render.",
  } satisfies ReplyComponent),
  componentFence({
    type: "checks",
    title: "Local suite",
    scope: "vitest, run in the task worktree",
    testTotals: { passed: 8, failed: 0, skipped: 1 },
    items: [
      {
        name: "Held key moves one card at a time",
        status: "passed",
        evidence: [
          {
            label: "Replay fixture",
            location: "tests/app/motion.test.ts",
          },
        ],
      },
      {
        name: "Burst longer than two cards is dropped",
        status: "passed",
      },
      {
        name: "Card settles within one frame of release",
        status: "skipped",
        detail: "Needs a real display; jsdom reports no frame timing.",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "delivery",
    title: "Where the fix stands",
    scope: "branch fix/queue-held-key",
    stages: [
      {
        name: "Committed",
        status: "done",
        detail: "abc1234 on the task branch",
      },
      { name: "Pushed", status: "pending", detail: "Waiting on your review" },
      {
        name: "Deployed",
        status: "blocked",
        detail: "The plugin reloads after merge",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "group",
    relationship: "supporting",
    children: [
      {
        type: "change",
        title: "The ref replaces the effect dependency",
        before: "useEffect re-registered the handler for each index",
        after: "One handler reads a ref the commit writes",
      },
      {
        type: "finding",
        title: "One listener serves the whole burst",
        explanation:
          "The handler no longer depends on the index, so a burst of repeats runs the same function with the latest position.",
        certainty: "observed",
      },
    ],
  } satisfies ReplyComponent),
  componentFence({
    type: "recommendation",
    choice: "Merge after one pass on a real queue",
    reason:
      "The replay fixture covers the ordering, but only a real display shows whether the card settles before the next frame.",
    qualification:
      "Keep the cap at two cards; it reads as deliberate rather than laggy.",
  } satisfies ReplyComponent),
  componentFence({
    type: "details",
    title: "Why a ref and not state",
    body: "State would re-render for every key event, which is the work the cap exists to avoid. The ref holds the same value the last commit rendered, so the visible order and the handler's idea of it cannot drift apart.",
  } satisfies ReplyComponent),
]);

const fallbacks = block("change", [
  "# Two parts that cannot be displayed as written",
  "A fence that is still arriving shows a placeholder until its closing line lands. A fence that closes with something the component schema rejects keeps its source readable, with the reason above it.",
  componentFence({
    type: "text",
    body: "This paragraph is a component like any other; it needs nothing but text.",
  } satisfies ReplyComponent),
  ["```workstreams", '{"type":"checks","title":"Replay results"}', "```"].join(
    "\n",
  ),
]);

const older = [
  ':::reply{state="review" kind="change"}',
  "# The queue cap holds at two cards",
  "- [x] Held keys move one card per press",
  "- [x] A burst longer than two cards is dropped",
  "- [ ] Check the settle timing on a display",
  "",
  "### Review",
  "- Hold ↓ on a queue of four and confirm the card stops two ahead",
  "",
  "### Links",
  "- [Motion fixture](https://github.com/tomdale/bb-plugin-workstreams/blob/main/tests/app/motion.test.ts)",
  "",
  "### Next",
  "- Try it on your display: Hold ↓ and confirm the card settles as you release",
  ":::",
].join("\n");

export const SPECIMENS: readonly Specimen[] = [
  {
    title: "An investigation",
    intro:
      "One reply carrying the reading half of the vocabulary: prose, a folded Details section, and six components, including evidence with a file range and a peer group.",
    messages: [
      { from: "user", text: "Holding ↓ on the queue skips ahead. Why?" },
      {
        from: "agent",
        block: investigation,
        features: [
          "headline",
          "prose",
          "context",
          "finding",
          "evidence",
          "text",
          "sequence",
          "comparison",
          "group (peers)",
          "Details fold",
        ],
      },
    ],
  },
  {
    title: "A change delivered",
    intro:
      "The follow-up reply: what changed, what was run, where it stands, and what to do next — plus a bare directive and a folded Details component.",
    messages: [
      { from: "user", text: "Fix it, and show me what you ran." },
      {
        from: "agent",
        block: delivered,
        features: [
          "change",
          "checks",
          "delivery",
          "group (supporting)",
          "recommendation",
          "details component",
          "directive",
        ],
      },
    ],
  },
  {
    title: "When a part cannot be displayed",
    intro:
      "A component the schema rejects stays readable instead of disappearing, and a fence that is still arriving holds a placeholder until its closing line.",
    messages: [
      { from: "user", text: "What happened to the rest of the results?" },
      {
        from: "agent",
        block: fallbacks,
        features: ["unparsed component", "pending fence"],
      },
    ],
  },
  {
    title: "Blocks written before the recap tool",
    intro:
      "Older messages carried the card's own fields. They still render inline — state, result checkboxes, and the Review, Links, and Next sections — though new replies leave the card to the recap tool.",
    messages: [
      {
        from: "agent",
        block: older,
        features: [
          "card state",
          "result checkboxes",
          "Review",
          "Links",
          "Next",
        ],
      },
    ],
  },
];

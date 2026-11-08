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

const block = (parts: readonly string[]): string =>
  [`:::reply{v="1"}`, ...parts, ":::"].join("\n\n");

/** A bare directive, rendered by bb's installed directive plugins. */
const DIRECTIVE =
  '::inline-vis{source="thread-storage" file="queue-replay.html"}';

const fence = (component: ReplyComponent) => componentFence(component);

const shortAnswer = block([
  "# Yes: the queue skips cards only while a key is held",
  "A single press always moves one card.",
]);

const explanation = block([
  "# The held key reads the card's position from the render that started the burst",
  "Every key repeat runs the handler captured when the burst began, so each one asks to move from the same card.",
  fence({
    type: "table",
    title: "Where the position is read",
    columns: ["Reader", "Source"],
    rows: [
      {
        cells: ["Arrow keys", "`Queue.tsx` effect closure"],
        state: "Stale",
        tone: "bad",
      },
      {
        cells: ["Card buttons", "`Queue.tsx` effect closure"],
        state: "Stale",
        tone: "bad",
      },
      { cells: ["Sidebar", "props"], state: "Current", tone: "good" },
      { cells: ["Composer", "props"], state: "Current", tone: "good" },
    ],
  }),
  fence({
    type: "details",
    title: "Reproduce it",
    body: "1. Hold ↓ for two seconds; about sixty keydown events arrive at the window.\n2. Count the cards the queue passed: more than sixty with the stale handler, sixty with a ref.",
  }),
  fence({
    type: "details",
    title: "Why the closure goes stale",
    body: 'The handler is registered in an effect whose dependency list includes the focused index, so it is rebuilt after each render. A keydown that arrives before React commits the new index runs the previous closure.\n\n```ts\nuseEffect(() => {\n  window.addEventListener("keydown", onKey);\n  return () => window.removeEventListener("keydown", onKey);\n}, [index]);\n```',
  }),
]);

const advice = block([
  "# Read the index from a ref",
  "It removes the stale read without changing when the handler is registered.",
  fence({
    type: "table",
    title: "Two ways to read the position",
    columns: ["Option", "Cost"],
    rows: [
      {
        cells: ["Read the latest index from a ref", "One listener per burst"],
        state: "Recommended",
        tone: "good",
      },
      {
        cells: [
          "Re-subscribe on every render",
          "A listener removal and addition per card",
        ],
      },
    ],
  }),
  fence({
    type: "details",
    title: "Trade-offs",
    body: "Re-subscribing is correct, but noisier under a release build that batches updates. Revert the ref if a future card can move without a keystroke.",
  }),
]);

const delivered = block([
  "# The held key moves one card per press, ready for your merge",
  "The handler reads the position from a ref, so every repeat sees the latest card.",
  fence({
    type: "change",
    title: "Queue card keys",
    before: "A held key re-read a stale index and skipped several cards",
    after: "Each press moves one card, and a release settles the card at once",
    unchanged: "Clicking a card, and the shortcuts for send and edit",
    limitation:
      "A burst that starts while the thread list reloads still waits for that render.",
  }),
  fence({
    type: "checks",
    title: "Local suite",
    scope: "vitest in the task worktree; CI has not run",
    testTotals: { passed: 1077, failed: 0, skipped: 1 },
    items: [
      {
        name: "Held key moves one card at a time",
        status: "passed",
        evidence: [
          { label: "Replay fixture", location: "tests/app/motion.test.ts" },
        ],
      },
      { name: "Burst longer than two cards is dropped", status: "passed" },
      { name: "Typecheck", status: "passed" },
    ],
  }),
  fence({
    type: "actions",
    items: [
      {
        action: "Merge `fix/queue-held-key` into `main`",
        copy: "git merge --ff-only fix/queue-held-key",
      },
      {
        action: "Reload the plugin from the canonical checkout",
        caution: "The live app loads it at once; the reload cannot be staged.",
      },
    ],
  }),
  fence({
    type: "facts",
    items: [
      {
        label: "Branch",
        value: "fix/queue-held-key",
        note: "based on `main`",
      },
      { label: "Commit", value: "abc1234" },
      { label: "Fixture", value: "tests/app/motion.test.ts" },
    ],
  }),
  fence({
    type: "delivery",
    title: "Delivery",
    scope: "As of the end of this turn",
    stages: [
      { name: "Committed", status: "done", detail: "abc1234 on the branch" },
      { name: "Pushed", status: "done" },
      { name: "Merged", status: "pending", detail: "Waiting for your merge" },
      { name: "Deployed", status: "pending" },
    ],
  }),
  DIRECTIVE,
  fence({
    type: "details",
    title: "Why a ref and not state",
    body: "State would re-render for every key event, which is the work the cap exists to avoid. The ref holds the value the last commit rendered, so the visible order and the handler's idea of it cannot drift apart.",
  }),
]);

const failure = block([
  "# The settle test fails on a real display",
  "Held keys move one card at a time, but a release overshoots by one card at 120 Hz.",
  fence({
    type: "actions",
    items: [
      {
        action: "Choose whether to ship with the overshoot",
        decide: true,
        detail:
          "Shipping fixes the skipping for most people; holding it waits for a frame-timing fix.",
      },
    ],
  }),
  fence({
    type: "checks",
    title: "Display checks",
    scope: "Run on a 120 Hz display; CI has no display",
    items: [
      { name: "Held key moves one card at a time", status: "passed" },
      {
        name: "Card settles within one frame of release",
        status: "failed",
        detail: "Settles after two frames and one card past the release.",
      },
      {
        name: "60 Hz display",
        status: "untested",
        detail: "No 60 Hz display was available.",
      },
    ],
  }),
  fence({
    type: "details",
    title: "Frame log",
    body: "```text\nrelease  t=0.0ms  card=14\nframe 1  t=8.3ms  card=15\nframe 2  t=16.6ms card=15\n```",
  }),
]);

const design = block([
  "# Extend the queue, not a second list",
  "The queue already ranks, snoozes, and archives; a second list would copy all three.",
  fence({
    type: "actions",
    title: "Before anyone builds",
    items: [
      {
        action: "Should snoozed threads keep their place when they wake?",
        decide: true,
        detail: "Keeping it is a schema change to the snooze record.",
      },
      {
        action: "Send the design doc as Markdown",
        detail: "The linked page could not be read, so this follows the code.",
      },
    ],
  }),
  fence({
    type: "table",
    title: "Calls made for you to confirm",
    columns: ["Chosen", "Instead of", "Because"],
    rows: [
      {
        cells: [
          "Extend `Queue.tsx`",
          "A new list",
          "Ranking stays in one place",
        ],
        state: "Decided",
        tone: "good",
      },
      {
        cells: [
          "Rank on the server",
          "Rank in the app",
          "Phone Home shares the order",
        ],
        state: "Decided",
        tone: "good",
      },
    ],
  }),
  fence({
    type: "table",
    title: "What exists",
    columns: ["Part", "Where"],
    rows: [
      {
        cells: ["Ranking", "`src/domain/upNext.ts`"],
        state: "Reuse",
        tone: "good",
      },
      {
        cells: ["Snooze", "`src/server/snooze.ts`"],
        state: "Reuse",
        tone: "good",
      },
      { cells: ["Wake order", "nothing yet"], state: "Add" },
    ],
  }),
  fence({
    type: "details",
    title: "Build order",
    body: "1. Add the wake position to the snooze record.\n2. Rank woken threads by it.\n3. Show the position in the queue row.",
  }),
  fence({
    type: "details",
    title: "Where the code is",
    body: "- [upNext.ts](src/domain/upNext.ts)\n- [snooze.ts](src/server/snooze.ts)\n- [Queue.tsx](src/app/page/queue/Queue.tsx)",
  }),
]);

const fallbacks = block([
  "# Two parts that cannot be displayed as written",
  "A fence still arriving shows a placeholder; a fence the schema rejects keeps its source readable.",
  ["```workstreams", '{"type":"checks","title":"Replay results"}', "```"].join(
    "\n",
  ),
  [
    "```workstreams",
    'recommendation(choice: "Read the index from a ref", reason: "It keeps one listener per burst.")',
    "```",
  ].join("\n"),
]);

const older = [
  ':::reply{state="review"}',
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
    title: "A short answer",
    intro: "A headline and one sentence, with no other parts.",
    messages: [
      { from: "user", text: "Does a single press ever skip a card?" },
      { from: "agent", block: shortAnswer, features: ["headline", "lead"] },
    ],
  },
  {
    title: "An explanation",
    intro:
      "Critical state as a table with a state column; the reasoning and the reproduction fold beneath, each closed line counting what it holds.",
    messages: [
      { from: "user", text: "Holding ↓ on the queue skips ahead. Why?" },
      {
        from: "agent",
        block: explanation,
        features: ["table", "details"],
      },
    ],
  },
  {
    title: "Advice",
    intro:
      "The headline is the recommendation; the options sit in a table and the trade-offs fold.",
    messages: [
      { from: "user", text: "How should the handler read the position?" },
      { from: "agent", block: advice, features: ["table", "details"] },
    ],
  },
  {
    title: "A change ready to merge",
    intro:
      "Written in any order, drawn as a panel: the steps that need you come first, checks become counted tiles with the passing list folded, values are copyable, and details sink to the end. The bare directive renders through bb's installed directive plugins; without one, its source stays readable, as here.",
    messages: [
      { from: "user", text: "Fix it, and show me what you ran." },
      {
        from: "agent",
        block: delivered,
        features: [
          "actions",
          "change",
          "checks",
          "facts",
          "delivery",
          "directive",
          "details",
        ],
      },
    ],
  },
  {
    title: "A failure report",
    intro:
      "A failed check turns its tile red and keeps the list open; the decision it leaves is the first thing in the reply.",
    messages: [
      { from: "user", text: "Check it on the 120 Hz display too." },
      {
        from: "agent",
        block: failure,
        features: ["actions (decide)", "checks (failed)", "details"],
      },
    ],
  },
  {
    title: "A design with decisions",
    intro:
      "Questions the reader owns are decisions in the actions panel; calls the agent made are table rows to confirm or push back on.",
    messages: [
      { from: "user", text: "Design the wake order for snoozed threads." },
      {
        from: "agent",
        block: design,
        features: ["actions (decide)", "table", "details rail"],
      },
    ],
  },
  {
    title: "When a part cannot be displayed",
    intro:
      "A component the schema rejects stays readable with its reason; one the format does not teach, such as one in an earlier reply, shows its text as Markdown.",
    messages: [
      { from: "user", text: "What happened to the rest of the results?" },
      {
        from: "agent",
        block: fallbacks,
        features: ["unparsed component", "component outside the set"],
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

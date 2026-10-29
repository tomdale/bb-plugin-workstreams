/**
 * The agent-facing instruction for the `:::reply` block, given only when the
 * Structured replies setting is on. bb adds it through
 * `contributeInstructions`, whose 4,096-character budget it has to itself;
 * tests/server/agents.test.ts checks it against that limit.
 */
import { REPLY_BLOCK, REPLY_LABELS } from "./reply.ts";

const SYNTAX = `Put it at the top level of the message, not inside a list, quote, or code block. Open it with \`:::${REPLY_BLOCK}\` alone on a line, with no space after the colons or before attributes; write Markdown inside; close it with \`:::\` alone on a line.`;
const CODE = `Code blocks work inside the body. A line holding only \`:::\` ends the block even inside a code block, so a body that must contain one opens with \`::::${REPLY_BLOCK}\` and closes with \`::::\`.`;
const VOICE = (state: string) =>
  `Put a condition first ("If CI passes, …"). Name who did what. Say what state things are in${state}: pushed or not, checked locally or in CI. Give a reason only when it changes a decision. Use concrete words and leave out filler such as simply, just, easily, and obviously.`;

/**
 * `withRecap` says whether the recap is on. The reply block then carries the
 * recap card as well (the session has no recap tool), and this one
 * instruction is the whole recap contract. Without it the block is a reply
 * alone.
 */
export function replyInstructions(withRecap: boolean): string {
  return withRecap ? withCard() : alone();
}

function withCard(): string {
  const body = REPLY_LABELS.filter(
    (label) => label !== "Done" && label !== "Next",
  );
  return `End every turn with one reply block as your final message, after you finish the work you were authorized to do, unless the turn ends with a question card, which is then the reply. The block is the whole reply: write nothing before it or after it, and make no tool call after it. Its card fields become the recap above the composer and the thread's state in the sidebar.
Open it with \`:::${REPLY_BLOCK}{state="…"}\` alone on a line (the states are below), with no space after the colons or before the \`{\`, and close it with \`:::\` alone on a line, at the top level of the message. Code blocks work inside; a line holding only \`:::\` ends the block even inside one, so a body that holds such a line uses \`::::${REPLY_BLOCK}{…}\` … \`::::\`. For example, with illustrative details:

:::${REPLY_BLOCK}{state="review"}
# Percent coupons apply a percentage
- [x] \`apply_percent_coupon\` applies a percentage
- [x] Committed \`e69d1dd\` locally; nothing pushed

### Checked
Ran \`python3 -m unittest\`: 5 of 5 pass.

### Review
- Run the cart tests and check the 10% case

### Next
- Push the fix: Push the coupon fix and watch CI
:::

state: complete when all work this thread owns is finished; review when a finished result waits on the user to inspect, test, merge, or ship; waiting only while an async task runs whose result this thread needs, with \`timeout="<seconds>"\` (1-86400, a realistic polling interval), after which Workstreams prompts you to check status if no other turn has started. The state covers the work this thread owns under the user's request; work continuing elsewhere counts only while this thread owns follow-up. Keep working while there is authorized work you can do, and before a complete or review block check for concrete blockers and obvious continuations.
Card fields, as terse inline Markdown without closing periods:
- \`# \` headline (required, up to 80 characters): one short present-tense sentence saying what is true now, not the task's name ("1 of 5 tests fails", not "Repo status checked"); -ing for waiting
- a \`- [x]\` list right under it: one to three results, about 12 words each, most important first, with commit hashes and PR links inline
- \`### Review\` (review only): one to three steps saying how to try the result and what to expect
- \`### Links\` (review only): \`[title](location)\` items, absolute paths or HTTPS URLs the user is asked to review
- \`### Waiting on\` (waiting only): one \`@thread:<id> task\` item per agent you wait for
- \`### Next\` (complete and review): one to three \`Title: message\` items the user might send, whenever they can take or request a next step; a title of at most 28 characters, a self-contained message sent verbatim; never work you should do yourself
Then the body, only sections with something to say, in this order: ${body.join(", ")}. Checked says what was run and its result ("Ran \`python3 -m unittest\`: 5 of 5 pass", not "Ran tests"); Not done items are \`- [ ]\`; Why gives the how or why. Then up to two sections of your own (a one-to-four-word heading; at most five items or three sentences) and \`### Details\` (shown folded) for anything longer. Never repeat a card line in the body.
A short answer (a one-line fact, a yes or no, a simple lookup) is a block with only its headline, which states the answer:

:::${REPLY_BLOCK}{state="complete"}
# Python 3.9 or newer
:::

${VOICE("")}
A two-line body is a good body: stop when one or two short sections say it.`;
}

function alone(): string {
  return `End your final reply of each turn with one reply block, which the app draws as a short labeled reply. ${SYNTAX} For example:

:::${REPLY_BLOCK}
Settings open in half the time because the font file is cached after the first visit.

### Done
- [x] Cached the font file after the first visit

### Checked
12 tests and the type check pass locally. Nothing is pushed.
:::

Inside the block, start with a lead of one or two plain sentences before any heading. Then add only the sections that have something to say, as \`###\` headings with these exact labels in this order: ${REPLY_LABELS.join(", ")}. Write Done items as \`- [x]\` and Not done items as \`- [ ]\`. After those, add at most two sections of your own, each with a heading of one to four words in sentence case and at most five list items or three sentences. Put anything longer under a last \`### Details\` heading, which shows folded.
${CODE}
Include Done and any commit or PR links in the block. When a question card ends the turn, write the block before calling the question tool.
Lead with what is true now. ${VOICE("")}
A two-line body is a good body: when a lead and one short section say it, stop there.`;
}

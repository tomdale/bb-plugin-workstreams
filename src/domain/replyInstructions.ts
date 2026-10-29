/**
 * The agent-facing instruction for the `:::reply` block, given only when the
 * Structured replies setting is on. bb adds it through
 * `contributeInstructions`, whose 4,096-character budget it has to itself;
 * tests/server/agents.test.ts checks it against that limit.
 */
import { RECAP_TOOL } from "./recap.ts";
import { REPLY_BLOCK, REPLY_LABELS } from "./reply.ts";

const SYNTAX = `Put it at the top level of the message, not inside a list, quote, or code block. Open it with \`:::${REPLY_BLOCK}\` alone on a line, with no space after the colons or before attributes; write Markdown inside; close it with \`:::\` alone on a line.`;
const CODE = `Code blocks work inside the body. A line holding only \`:::\` ends the block even inside a code block, so a body that must contain one opens with \`::::${REPLY_BLOCK}\` and closes with \`::::\`.`;
const VOICE = (state: string) =>
  `Put a condition first ("If CI passes, …"). Name who did what. Say what state things are in${state}: pushed or not, checked locally or in CI. Give a reason only when it changes a decision. Use concrete words and leave out filler such as simply, just, easily, and obviously.`;

/**
 * `withRecap` says whether the session also has the recap tool. Its card
 * then leads: it carries the headline, the results and the links, and the
 * block holds only what the card cannot. Without the card, and before a
 * question card, the block carries everything.
 */
export function replyInstructions(withRecap: boolean): string {
  return withRecap ? beside() : alone();
}

function beside(): string {
  const labels = REPLY_LABELS.filter((label) => label !== "Done").join(", ");
  return `Write your final reply of each turn as one reply block; only a short answer (below) has none. Put it at the top level, not inside a list, quote, or code block. Open it with \`:::${REPLY_BLOCK}\` alone on a line (no space after the colons or before attributes) and close it with \`:::\` alone on a line.
When the turn ends with a ${RECAP_TOOL} card, the card carries the headline, results (\`latest\`) and links; the block holds only what the card cannot. The block is the whole reply: write nothing before it, start it at its first \`###\` section, then call the tool and write nothing after. Use only sections with something to say, with these labels in order: ${labels}. Checked names what was run and where ("Ran \`python3 -m unittest\` locally"); Why gives the how or why; Not done items are \`- [ ]\`. Then up to two sections of your own (a one-to-four-word heading; at most five items or three sentences), then \`### Details\` (shown folded) for anything longer. For example:

:::${REPLY_BLOCK}
### Checked
Ran the 12 settings tests and the type check locally.

### Why
The cache lives in the service worker, so a hard refresh still downloads the font once.
:::

Before writing, compare each line with your card items and drop any line that says the same thing: with the card item "Cached the font file", the line "The font is now cached" goes.
For a short answer (a one-line fact, a yes or no, a simple lookup), write no block: reply with one plain sentence, then call the tool with a goal that states the answer and one \`latest\` item.
When a question card ends the turn instead, write the block before calling the question tool; that block opens with a one- or two-sentence lead, then \`### Done\` (\`- [x]\` items) before the other labels, and includes any commit or PR links.
Code blocks work inside; a line holding only \`:::\` ends the block even inside one, so a body that holds such a line uses \`::::${REPLY_BLOCK}\` … \`::::\`.
Say what is true now. ${VOICE(" that the card does not show")}
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

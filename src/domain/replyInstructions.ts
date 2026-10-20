/**
 * The agent-facing instruction for the `:::reply` block, given only when the
 * Structured replies setting is on. bb adds it through
 * `contributeInstructions`, whose 4,096-character budget it has to itself;
 * tests/server/agents.test.ts checks it against that limit.
 */
import { RECAP_TOOL } from "./recap.ts";
import { REPLY_BLOCK, REPLY_LABELS } from "./reply.ts";

/**
 * `withRecap` says whether the session also has the recap tool, whose card
 * then carries what got done and the commit and PR links.
 */
export function replyInstructions(withRecap: boolean): string {
  const done = withRecap
    ? ""
    : "### Done\n- [x] Cached the font file after the first visit\n\n";
  const example = `:::${REPLY_BLOCK}
Settings open in half the time because the font file is cached after the first visit.

${done}### Checked
12 tests and the type check pass locally. Nothing is pushed.
:::`;
  const mode = withRecap
    ? `When a turn ends with a ${RECAP_TOOL} card, write the block in your reply before calling the tool. The card's \`latest\` items carry what got done, with commit hashes and PR links inline, so leave Done and those links out of the block and use the lead for the how or why rather than repeating the card's goal. When a question card ends the turn instead, the block is the only reply: include Done and any commit or PR links in it.`
    : "Include Done and any commit or PR links in the block.";
  return `End your final reply of each turn with one reply block, which the app draws as a short labeled reply. Put it at the top level of the message, not inside a list, quote, or code block. Open it with \`:::${REPLY_BLOCK}\` alone on a line, with no space after the colons or before attributes; write Markdown inside; close it with \`:::\` alone on a line. For example:

${example}

Inside the block, start with a lead of one or two plain sentences before any heading. Then add only the sections that have something to say, as \`###\` headings with these exact labels in this order: ${REPLY_LABELS.join(", ")}. Write Done items as \`- [x]\` and Not done items as \`- [ ]\`. After those, add at most two sections of your own, each with a heading of one to four words in sentence case and at most five list items or three sentences. Put anything longer under a last \`### Details\` heading, which shows folded.
Code blocks work inside the body. A line holding only \`:::\` ends the block even inside a code block, so a body that must contain one opens with \`::::${REPLY_BLOCK}\` and closes with \`::::\`.
${mode}
Lead with what is true now. Put a condition first ("If CI passes, …"). Name who did what. Say what state things are in: pushed or not, checked locally or in CI. Give a reason only when it changes a decision. Use concrete words and leave out filler such as simply, just, easily, and obviously.
A two-line body is a good body: when a lead and one short section say it, stop there.`;
}

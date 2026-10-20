/**
 * The agent-facing instruction for the reply block, given only when the
 * Structured replies setting is on. It lives apart from the recap and
 * question instructions in recap.ts so each can change on its own.
 */
import { RECAP_TOOL } from "./recap.ts";
import { REPLY_LANGUAGE, REPLY_LABELS } from "./reply.ts";

const FENCE = "```";

/**
 * `withRecap` says whether the session also has the recap tool, whose card
 * then carries what got done and the commit and PR links.
 */
export function replyInstructions(withRecap: boolean): string {
  const done = withRecap
    ? ""
    : "### Done\n- [x] Cached the font file after the first visit\n\n";
  const example = `${FENCE}${REPLY_LANGUAGE}
Settings open in half the time because the font file is cached after the first visit.

${done}### Checked
12 tests and the type check pass locally. Nothing is pushed.
${FENCE}`;
  const mode = withRecap
    ? `When a turn ends with a ${RECAP_TOOL} card, write the block as well as calling the tool. The card's \`latest\` items carry what got done, with commit hashes and PR links inline, so leave Done and those links out of the block and use the lead for the how or why rather than repeating the card's goal. When a question card ends the turn instead, the block is the only reply: include Done and any commit or PR links in it.`
    : "Include Done and any commit or PR links in the block.";
  return `End your final reply of each turn with one reply block, which the app draws as a short labeled reply. Write it as a fenced code block with the language \`${REPLY_LANGUAGE}\`, at the top level of the message rather than inside a list or quote. For example:

${example}

If the body contains a code block, give the reply's fence more backticks than any fence inside it, at least four (open with ${FENCE}\`${REPLY_LANGUAGE}, close with ${FENCE}\`), so the inner fence cannot end it early.
Inside the block, start with a lead of one or two plain sentences before any heading. Then add only the sections that have something to say, as \`###\` headings with these exact labels in this order: ${REPLY_LABELS.join(", ")}. Write Done items as \`- [x]\` and Not done items as \`- [ ]\`. After those, add at most two sections of your own, each with a heading of one to four words in sentence case and at most five list items or three sentences. Put anything longer under a last \`### Details\` heading, which shows folded.
${mode}
Lead with what is true now. Put a condition first ("If CI passes, …"). Name who did what. Say what state things are in: pushed or not, checked locally or in CI. Give a reason only when it changes a decision. Use concrete words and leave out filler such as simply, just, easily, and obviously.
A two-line body is a good body: when a lead and one short section say it, stop there.`;
}

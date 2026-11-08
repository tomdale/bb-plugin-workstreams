/*
 * The reply contract for sessions whose replies a person reads. It travels in
 * `configure`'s instructions, which bb appends after every tool section and
 * closest to the conversation, where models follow it; the component syntax
 * and signatures ride on their own optional tool so neither text passes bb's
 * per-text budget.
 */
import { signatureLines } from "./replyCatalog.ts";
import { RECAP_TOOL } from "./recap.ts";
import { REPLY_BLOCK } from "./reply.ts";
export const REPLY_EXAMPLES_TOOL = "WorkstreamsReplyExamples";
const MARKERS = `Put \`:::${REPLY_BLOCK}\` and its attributes on their own line, with no space after the colons or before \`{\`. Use a top-level block, closed with \`:::\` alone on a line. Fenced code works inside; a line that must be only \`:::\` goes inside \`::::reply\` and \`::::\`.`;
const TURN_POSITION = `Write it as the turn's last text, with no closing sentence or second summary after it. Write plain text while work is still in progress; a block is the turn's reply, not a progress note.`;
/** A request for exact output shapes the body, not whether there is a block. */
const EXACT_OUTPUT = `A request that fixes the output — one word, exact text, no formatting — still goes in the block, and changes only what the block holds: the asked-for text and nothing else.`;
/** A question-card turn ends at the card, so the block precedes that call. */
const ASK_EXCEPTION = `put the explanation in the block and then call the available question-card tool, whose card ends the turn.`;

/**
 * The reply contract for a session that draws reply blocks. `recapTool` says
 * the session also has the recap tool, whose call comes first because it alone
 * sets the card: the block then carries the body and nothing the tool fills.
 */
export function replyInstructions(recapTool: boolean): string {
  return recapTool ? withRecapTool() : alone();
}

function alone(): string {
  return `Every turn's reply is one \`:::${REPLY_BLOCK}\` block, which the app draws as the reply itself: the whole answer, even a one-sentence answer, then the explanation, completion details, and any relevant commit or PR links. ${EXACT_OUTPUT} ${TURN_POSITION} When required input is missing, ${ASK_EXCEPTION} ${MARKERS}`;
}

/**
 * With the recap tool in the session, the card comes from the call the turn
 * starts its reply with, so the block that follows carries the body alone.
 */
function withRecapTool(): string {
  return `Every turn's reply is one \`:::${REPLY_BLOCK}\` block, which the app draws as the reply itself: the whole answer, even a one-sentence answer, then the explanation, completion details, and any relevant commit or PR links. When the work is done, call ${RECAP_TOOL} — the card comes from that call — and then write the block, which carries the substance the card only summarizes. ${EXACT_OUTPUT} ${TURN_POSITION} When required input is missing, skip the recap: ${ASK_EXCEPTION} A turn that only reports a missing recap ends at that call, with nothing after it. ${MARKERS}
Example, with two components in one fence:
:::reply
# Arrow keys follow the card order
Holding a key flips one card at a time.

\`\`\`workstreams
context(topic: "Queue card keys", background: "Report the key handling change.")
change(title: "Arrow keys", before: "Holding a key did nothing", after: "Holding a key flips one card at a time")
\`\`\`
:::`;
}

export const REPLY_COMPONENT_INSTRUCTIONS = `Write the answer and causal reasoning in complete Markdown paragraphs; name actors and observable behavior, use concrete words, put conditions first, and keep qualifications beside their claims. Supporting detail stays with its explanation. Actions name their effect. Distinguish local from CI checks, passed from untested, and committed, built, pushed, installed, and deployed.
For substantive replies, orient the reader with context; use change for before/after and recommendation for choice/reason/boundary when they fit. These are defaults, not requirements for unrelated components. Short replies need no components; a clean test run may need only a sentence.
Compose components as statements in workstreams fences inside the reply block, at the body's top level and outside lists and quotes; a workstreams fence elsewhere in the message is ordinary Markdown, so the reader sees the source. A fence holds one or more components, each written as \`name(field: value, …)\`. Every argument is named and every value is static: "double-quoted text", numbers, true, false, [lists], {key: value} objects, and bare enum words. Text values are complete readable Markdown, preserved in the text body; \`"""\` opens and closes multi-line text, and text that contains a \`\`\` fence needs a four-backtick workstreams fence. Call ${REPLY_EXAMPLES_TOOL} for needed types before authoring them; its examples are illustrative, not thread evidence. Ordinary code uses its own language tag. Use every required field and only named fields; \`?\` marks optional ones and (n–m) bounds a list's length:
${signatureLines().join("\n")}
comparison: essential reasons belong in summary or qualification; consequential trade-offs in qualification; supporting explanation in detail. Numerical scores need a stated measurement or scoring method.
checks: testTotals uses actual nonnegative counts.
delivery: reported status is not independent proof.
details: required actions and important qualifications stay with what they qualify.
group: relationship is peers for comparable pieces or supporting for explanation plus support; children are components or lists of components kept together, at most 8 components in total, with no nested group.
Evidence entries link reported checks and delivery stages to real reports, source, or artifacts. location is HTTPS or a literal file path; line and endLine (1-based) need a file path. Distinguish a mock's presentation check from verifying its claims. Workspace files use relative paths; external files use absolute paths.
Choose components for the reply's purpose, omit unhelpful ones, and share context, sources, and actions without repeating them per piece. Components display information; required input and approval use question cards, not components.`;

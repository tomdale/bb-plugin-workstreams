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
/** Text written before the reply is a progress note; a turn that waits still ends in the block. */
const TURN_POSITION = `Write it as the turn's last text, with no closing sentence or second summary after it. Plain text is for a progress note written while work is still in progress; the turn's reply is the block, including a reply that reports a wait on another thread.`;
/** A request for exact output is answered with that text alone, without a block. */
const EXACT_OUTPUT = `A request that fixes the output — one word, exact text, or no formatting — is answered with that text alone, without a block.`;
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
  return `Write the reply as one \`:::${REPLY_BLOCK}\` block, which the app draws as the reply itself: the whole answer, even a one-sentence answer, then the explanation, completion details, and any relevant commit or PR links. ${EXACT_OUTPUT} ${TURN_POSITION} When required input is missing, ${ASK_EXCEPTION} ${MARKERS}`;
}

/**
 * With the recap tool in the session, the card comes from the call the turn
 * starts its reply with, so the block that follows carries the body alone.
 */
function withRecapTool(): string {
  return `Write the reply as one \`:::${REPLY_BLOCK}\` block, which the app draws as the reply itself: the whole answer, even a one-sentence answer, then the explanation, completion details, and any relevant commit or PR links. When the turn reports finished work or a wait on another thread, call ${RECAP_TOOL} — the card comes from that call — and write the reply after it, which carries the substance the card only summarizes. ${EXACT_OUTPUT} ${TURN_POSITION} When required input is missing, skip the recap: ${ASK_EXCEPTION} A turn that only reports a missing recap ends at that call, with nothing after it. ${MARKERS}
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

export const REPLY_COMPONENT_INSTRUCTIONS = `Write the answer and causal reasoning in complete Markdown paragraphs. Use concrete words, name actors and observable behavior, put conditions first, and keep qualifications and supporting detail with the explanation. Actions name their effect. Distinguish local/CI checks, passed/untested, and committed/built/pushed/installed/deployed.
For substantive replies, orient with context; use change for before/after, recommendation for choice/reason/boundary when suitable. These are defaults. Short replies and clean test runs may need only a sentence.
Inside the reply body, place workstreams fences at top level, outside lists/quotes; elsewhere they render as ordinary Markdown source. Each fence holds one or more \`name(field: value, …)\` statements. Arguments are named; values are static: "double-quoted text", numbers, true, false, [lists], {key: value} objects, bare enum words. Text holds readable Markdown; \`"""\` delimits multiline text. Text containing a \`\`\` fence needs a four-backtick outer fence. Call ${REPLY_EXAMPLES_TOOL} for needed types first; examples illustrate syntax, not thread evidence. Ordinary code uses its language tag. Use every required field and no extra fields; \`?\` means optional, (n–m) bounds list length:
${signatureLines().join("\n")}
comparison: essential reasons in summary/qualification, trade-offs in qualification, support in detail. State the measurement/scoring method for numerical scores.
checks: testTotals uses actual nonnegative counts.
delivery: reported, not independently verified; not-started=not reached, blocked=cannot proceed.
details: required actions and important qualifications stay with what they qualify.
table: rows match columns; scope states units and conditions.
review: instructions and expected results, not recorded passes.
actions: message enables copying or adding to the matching thread's composer; never sends. State owner, condition, and permission when relevant.
group: peers compare; supporting qualifies the first child. Keep component lists together; 2–8 components total, no nested groups.
Evidence links reported checks/stages to real source/reports/artifacts. location: HTTPS or literal file path; line/endLine: 1-based, file-only. Workspace paths relative, external paths absolute. threadId links a thread instead of location. A mock's presentation check does not verify its claims.
Use useful components; share context/sources/actions once. Components inform; required input/approval uses question cards.`;

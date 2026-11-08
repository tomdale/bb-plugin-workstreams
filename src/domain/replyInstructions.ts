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
# Percentage coupons ship after your merge
The coupon applies a percentage; saved orders keep their totals.

\`\`\`workstreams
actions(items: [{action: "Merge \`feature/percent\` into \`main\`", copy: "git merge --ff-only feature/percent"}])
checks(title: "Local checks", scope: "Run on \`feature/percent\`; CI has not run.", items: [{name: "Unit tests", status: passed}])
\`\`\`
:::`;
}

export const REPLY_COMPONENT_INSTRUCTIONS = `The reply is a small panel the reader acts from. Use only components that help the reader act or understand, ranked: what the reader must do or decide, then critical state (what passed, failed, shipped, or is blocked), then values the reader will copy, then the rest, in details. Lead with a \`#\` headline that states the answer or outcome, then at most two sentences of prose, and keep every visible paragraph to two sentences. Short replies need no components: the headline and at most a sentence. A failure report names what failed in its headline. Prose names actors and observable behavior and keeps qualifications beside their claims. Say each fact once: context, sources, actions, and the counts the panel computes appear in one place. Distinguish local from CI checks, passed from untested, and committed, pushed, merged, built, installed, and deployed.
Write components in workstreams fences at the reply block's top level, outside lists and quotes; anywhere else a fence shows as raw source. A fence holds one or more components, each written as \`name(field: value, …)\`. Every argument is named and every value is static: "double-quoted text", numbers, true, false, [lists], {key: value} objects, and bare enum words. Text values are readable Markdown; \`"""\` opens and closes multi-line text, and text that contains a \`\`\` fence needs a four-backtick workstreams fence. Call ${REPLY_EXAMPLES_TOOL} for needed types before authoring them; its examples are illustrative, not thread evidence. Ordinary code uses its own language tag. Use every required field and only named fields; \`?\` marks optional ones and (n–m) bounds a list's length:
${signatureLines().join("\n")}
actions: the panel draws these first. List only steps the work leaves to the reader: a step they kept for themselves, one the work left undone, or a decision it surfaced. Never add a step to fill the list, and never list finished work. Name each action by its effect. decide marks a choice the reader owns that does not block this turn; a blocking choice uses the question card. caution names an irreversible or risky consequence; copy holds an exact command.
checks, delivery: testTotals uses actual counts; reported status is not independent proof.
facts: literal values the reader will copy, never sentences.
table: items that differ in state, with a short state word per row; a call you made for the reader to ratify is a row too. tone is good for verified or settled, attention for something the reader owes or a risk, bad for broken; omit it otherwise. One cell per column; a numeric score needs its stated measurement.
change: observable behavior before and after a fix.
details: reasoning, evidence, background, alternatives, and code, folded until opened, so anything the reader must act on stays outside. Demote supporting findings to details; never drop them.
Evidence links checks and delivery stages to real reports, source, or artifacts. location is HTTPS or a literal file path; line and endLine (1-based) need a file path. Workspace files use relative paths; external files use absolute paths. Distinguish a mock's presentation check from verifying its claims.
Required input and approval use question cards.`;

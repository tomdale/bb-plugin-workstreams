/*
 * The reply contract travels separately from question instructions. Component
 * examples ride on their own optional tool, so each delivered instruction
 * remains within BB's per-text budget.
 */
import { signatureLines } from "./replyCatalog.ts";
import { RECAP_TOOL } from "./recap.ts";
import { REPLY_BLOCK } from "./reply.ts";
export const REPLY_EXAMPLES_TOOL = "WorkstreamsReplyExamples";
const MARKERS = `Put \`:::${REPLY_BLOCK}\` and its attributes on their own line, with no space after the colons or before \`{\`. Use a top-level block, closed with \`:::\` alone on a line. Fenced code works inside; a line that must be only \`:::\` goes inside \`::::reply\` and \`::::\`.`;

/**
 * The reply contract for a session that draws reply blocks. `recapTool` says
 * the session also has the recap tool, which alone sets the card: the block
 * then carries the body and nothing the tool fills.
 */
export function replyInstructions(recapTool: boolean): string {
  return recapTool ? withRecapTool() : alone();
}

function alone(): string {
  return `When required input is missing, put the explanation in a reply block before calling the available question-card tool; the card ends the turn. Otherwise put the entire final answer, explanation, completion details, and relevant commit or PR links in one reply block. ${MARKERS}`;
}

/**
 * With the recap tool in the session, the card is the tool call that ends the
 * turn: the block carries the body, so no state, headline, results, or Next.
 */
function withRecapTool(): string {
  return `When required input is missing, put the explanation in a reply block before calling the available question-card tool; the card ends the turn. Otherwise the whole reply is one reply block — the answer, however short, then the explanation, completion details, and relevant commit or PR links — and you end the turn with the ${RECAP_TOOL} tool call. The recap card comes from that call, so the block sets no state and carries no headline, results, or Next. ${MARKERS}
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
For substantive replies, orient the reader with context; investigations use finding for conclusion/certainty/evidence, changes use change for before/after, and advice uses recommendation for choice/reason/boundary. These are defaults, not requirements for unrelated components. Short replies need no components; a clean test run may need only a sentence.
Compose components as statements in workstreams fences inside the reply block, at the body's top level and outside lists and quotes; a workstreams fence elsewhere in the message is ordinary Markdown, so the reader sees the source. A fence holds one or more components, each written as \`name(field: value, …)\`. Every argument is named and every value is static: "double-quoted text", numbers, true, false, [lists], {key: value} objects, and bare enum words. Text values are complete readable Markdown, preserved in the text body; \`"""\` opens and closes multi-line text, and text that contains a \`\`\` fence needs a four-backtick workstreams fence. Call ${REPLY_EXAMPLES_TOOL} for needed types before authoring them; its examples are illustrative, not thread evidence. Ordinary code uses its own language tag. Use every required field and only named fields; \`?\` marks optional ones and (n–m) bounds a list's length:
${signatureLines().join("\n")}
comparison: essential reasons belong in summary or qualification; consequential trade-offs in qualification; supporting explanation in detail. Numerical scores need a stated measurement or scoring method.
checks: testTotals uses actual nonnegative counts.
delivery: reported status is not independent proof.
details: required actions and important qualifications stay with what they qualify.
group: relationship is peers for comparable pieces or supporting for explanation plus support; children are components or lists of components kept together, at most 8 components in total, with no nested group.
Evidence: link factual claims to real reports, source, or artifacts and preserve uncertainty. location is HTTPS or a literal file path; line and endLine (1-based) need a file path. Distinguish a mock's presentation check from verifying its claims. Workspace files use relative paths; external files use absolute paths.
Choose components for the reply's purpose, omit unhelpful ones, and share context, sources, and actions without repeating them per piece. Components display information; required input and approval use question cards, not components.`;

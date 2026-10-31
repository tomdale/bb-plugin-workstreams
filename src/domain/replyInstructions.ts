/*
 * The reply contract travels separately from question instructions. Component
 * examples ride on their own optional tool, so each delivered instruction
 * remains within BB's per-text budget.
 */
import { REPLY_BLOCK } from "./reply.ts";
export const REPLY_EXAMPLES_TOOL = "WorkstreamsReplyExamples";
const BODY = `Body: write the answer and reasoning as Markdown paragraphs. Keep causal connections. Choose headings and order for this reply. Keep uncertainty and qualifications beside their claims. Keep supporting detail with the explanation it supports.
Orient a returning reader with a context component: broad task, relevant place, brief background. Name actors and describe observable behavior. Distinguish passed from untested and pushed from deployed. Use complete sentences. Explain reasons when they help the reader understand a conclusion or decision. Actions name their effect. A short reply needs no components.`;
const MARKERS = `Open with \`:::${REPLY_BLOCK}\` alone on a line; put any attributes on that same line, with no space after the colons or before \`{\`, and close with \`:::\` on its own line. Use a top-level block. Fenced code works inside; if a line must contain only \`:::\`, use \`::::reply\` and \`::::\` around the reply.`;

export function replyInstructions(withRecap: boolean): string {
  return withRecap ? withCard() : alone();
}

function alone(): string {
  return `When you need input, put any explanation in a reply block before calling the question tool; the question card ends the turn. Otherwise, end your final reply with one :::reply block containing the answer, explanation, completion details, and relevant commit or PR links. ${MARKERS}\n${BODY}`;
}

/** A question card owns the reply when input is required; other turns carry recap fields. */
function withCard(): string {
  return `When the user's answer is required, end with a question card; put any explanation before that tool call. Otherwise, finish authorized work and end with one reply block as the whole final message, with no text or tool call after it. ${MARKERS}
Set state="complete", state="review", or state="waiting" on the opener; optional kind is answer, investigation, change, recommendation, proposal, status, or handoff, independently of state.
State covers work this thread owns: complete when all authorized work is finished; review when a finished result awaits the user to inspect, test, merge, or ship; waiting only for an async result this thread must check to resume work. Work elsewhere counts only while this thread owns follow-up. Before complete/review, check blockers and authorized continuations. Continue work or ask for required input. Waiting also sets timeout="<seconds>" (1–86400), a realistic time until you check again. The card counts down; if that turn is still current at expiry, Workstreams prompts a status check.
Recap fields update the card and sidebar; use terse inline Markdown without closing periods.
Card fields: start with # and one short present-tense sentence stating what is true (at most 80 characters), -ing for waiting. If a complete or review reply has a body, put 1–3 - [x] results immediately after the headline, before any body content. Advice still needs a result stating the recommendation or finding, even with no file changes. Results are concrete outcomes, most important first, about 12 words each, with relevant commit and PR links. The body explains the outcomes rather than repeating their sentences.
Reserved ### sections: Review (review only) has 1–3 steps to inspect the result and what to expect. Links (review only) lists [title](location) review targets, HTTPS or absolute paths. Waiting on (waiting only) lists one @thread:<id> task per awaited agent. Next (complete/review) lists 1–3 Title: message actions the user might request, with short labels (at most 28 characters) and self-contained messages sent verbatim. Include a next action when the user has a useful next step; never offer work you should do yourself. For a one-line answer, use only the # headline inside the block.
${BODY}
Example with illustrative details:
:::reply{state="review" kind="change"}
# The coupon applies a percentage
- [x] Callers pass whole percentages; conversion stays beside the calculation

\`\`\`workstreams
{"type":"context","topic":"Coupon calculation","background":"Review the percentage fix while keeping caller units unchanged."}
\`\`\`

The calculation divides the percentage by 100 before applying it to the amount, so callers keep the same units.

\`\`\`workstreams
{"type":"change","title":"Coupon behavior","before":"10 subtracted ten cents","after":"10 subtracts ten percent","limitation":"Existing saved orders are unchanged"}
\`\`\`

### Review
- Inspect the percentage calculation and its regression test

### Next
- Check callers: Check the other coupon callers for the same unit mismatch
:::
Short answer:
:::reply{state="complete"}
# Python 3.9 or newer
:::`;
}

export const REPLY_COMPONENT_INSTRUCTIONS = `Compose information inside the body with JSON objects in fenced code blocks tagged workstreams. Call ${REPLY_EXAMPLES_TOOL} for the types you need before writing them. Its examples are illustrative, not facts about this thread. Place each fence at the body's top level, outside lists or quotes. Components retain information and relationships; the body displays their full contents as plain Markdown. Each fence contains one object. Ordinary code uses its own language tag.
For a substantive reply, start its body with context. Give an investigation's conclusion, certainty, and evidence in a finding; show before/after behavior in a change; state a recommendation with its reason and qualification in a recommendation. Use prose to explain the causal reasoning and connect those pieces. These are defaults for relevant information, not requirements to add unrelated components.
Use concrete words and omit filler. Put conditions first; say whether checks ran locally or in CI.
Choose by the reader's question:
context: what are we working on, where, and what background matters? topic, optional where and background.
finding: what did we establish, how certain is it, and why does it matter? title, explanation, certainty (observed|inferred|unknown), optional consequence and evidence.
comparison: how do these options differ? title and 2–8 items, each name, summary, optional qualification, detail, recommended. Put a consequential trade-off in qualification; use detail for supporting explanation. Compare with reasons and consequential trade-offs; numerical scores require a stated measurement or scoring method. Put essential reasons in summary or qualification; detail adds support.
sequence: what happens in what order? title and steps with title, optional detail and attention.
change: what changed for the reader? title, before, after, optional unchanged and limitation. A limitation stays beside the change.
checks: what was checked and what remains unverified? title, scope, items with name, status (passed|failed|skipped|blocked|untested), optional detail and evidence. Optional testTotals {passed,failed,skipped} contains actual nonnegative counts. A clean run may need only a sentence.
delivery: which stages really happened? title, scope, stages with name, status (done|pending|blocked|unknown), detail, optional evidence. Distinguish committed, pushed, built, installed, and deployed. A reported stage does not independently prove it happened.
recommendation: what do you recommend and why? choice, reason, optional qualification. State the boundary beside it.
details: supporting material with title and body (Markdown). Keep required actions and important qualifications with the explanation or component they qualify.
group: related information; relationship="peers" for comparable pieces or "supporting" for an explanation with support. children has 2–8 entries: a component or a nonempty list kept together, at most 8 components total. Groups do not nest. A text child has type="text" and body (full Markdown).
Evidence: plain label, optional detail, location (HTTPS or literal file path), line and endLine (1-based file range). Use links to real reports, source, or artifacts; distinguish a mock presentation check from verifying the claims in the mock. Relative files stay in the workspace; external files require an absolute path. Link factual claims to evidence and preserve uncertainty; component status is an agent report, not host verification.
Each component takes only the named fields. Keep values as complete readable Markdown; the Markdown body preserves full values, including supporting detail. Components that don't help the reader can be omitted. Shared context, sources and actions should not be repeated on every piece. A reply's kind describes its purpose; choose the components its information needs. Ask required questions through the question card; these components display information and do not collect approval or execute work.`;

/*
 * The reply contract travels separately from question instructions. Component
 * examples ride on their own optional tool, so each delivered instruction
 * remains within BB's per-text budget.
 */
import { REPLY_BLOCK } from "./reply.ts";
export const REPLY_EXAMPLES_TOOL = "WorkstreamsReplyExamples";
const MARKERS = `Put \`:::${REPLY_BLOCK}\` and its attributes on their own line, with no space after the colons or before \`{\`. Use a top-level block, closed with \`:::\` alone on a line. Fenced code works inside; a line that must be only \`:::\` goes inside \`::::reply\` and \`::::\`.`;

export function replyInstructions(withRecap: boolean): string {
  return withRecap ? withCard() : alone();
}

function alone(): string {
  return `When required input is missing, put the explanation in a reply block before calling the available question-card tool; the card ends the turn. Otherwise put the entire final answer, explanation, completion details, and relevant commit or PR links in one reply block. ${MARKERS}`;
}

/** A question card owns the reply when input is required; other turns carry recap fields. */
function withCard(): string {
  return `When user input is required, end with a question card; explain before calling it. Otherwise finish authorized work, then end with one reply block as the entire final message, with no later text or tools. ${MARKERS}
Set state="complete", state="review", or state="waiting" on the opener; optional kind is answer, investigation, change, recommendation, proposal, status, or handoff, independently of state.
State covers what this thread owns: complete when all authorized work is finished; review when a finished result awaits inspection, testing, merging, or shipping; waiting while an async result this thread needs is still running. Work elsewhere counts while this thread owns follow-up; a route that leaves the destination owning the follow-up is complete, and its Next names how the destination reports back. Waiting requires timeout="<seconds>" (1–86400), a realistic polling interval; the card prompts a status check at expiry.
Recap fields set the card and sidebar; use terse inline Markdown without closing periods.
Card fields: start with # and a present-tense fact (at most 80 characters), -ing for waiting. Complete/review replies with bodies put 1–3 - [x] results immediately after the headline; a waiting card keeps only its headline, Waiting on, and timeout, so results and explanation go in the body. Advice results state the recommendation, not an implemented change. Results: concrete outcomes, most important first, about 12 words each, with relevant commit and PR links. Explain outcomes in the body without repeating them.
Reserved ### sections: Review (review state only, required): 1–3 steps to inspect the result and what to expect. Links (review only) lists [title](location) review targets: HTTPS or absolute paths. Waiting on (waiting only) lists one @thread:<id> task per awaited agent. Next (required for complete and review; only a short factual answer with nothing left open omits it): 1–3 Title: message actions; labels at most 28 characters. Messages are self-contained requests; whitespace and closing periods are normalized. Next names each thing this reply leaves open: a pull request unopened, unmerged, or awaiting review; a result only the user can check on their own machine or display; a decision they still own; a step the body names but nobody did; an optional improvement or unauthorized change you recommended; for a handoff, how the destination reports back. An unauthorized action is a Next item, not a question card, unless the reply cannot stand without the answer; Next never requests approval or executes. Do authorized continuations yourself.
Example:
:::reply{state="review" kind="change"}
# The coupon applies a percentage
- [x] Callers pass whole percentages; conversion stays beside the calculation

\`\`\`workstreams
{"type":"context","topic":"Coupon calculation","background":"Review the percentage fix with caller units unchanged."}
\`\`\`

\`\`\`workstreams
{"type":"change","title":"Coupon behavior","before":"10 subtracted ten cents","after":"10 subtracts ten percent","limitation":"Existing saved orders are unchanged"}
\`\`\`

### Review
- Inspect the percentage calculation and its regression test

### Next
- Check callers: Check the other coupon callers for the same unit mismatch
:::
Completed change:
:::reply{state="complete" kind="change"}
# Arrow keys follow the card order
- [x] Holding a key flips cards one at a time

### Next
- Try it on your display: Confirm holding ↓ flips one card at a time
:::
The only reply that omits Next, because nothing is left open:
:::reply{state="complete"}
# Python 3.9 or newer
:::
Advice-only example:
:::reply{state="complete" kind="recommendation"}
# Renaming the label preserves behavior
- [x] The recommendation matches the stored value without changing execution

### Next
- Rename the label: Rename the setting label and add a regression test
:::`;
}

export const REPLY_COMPONENT_INSTRUCTIONS = `Write the answer and causal reasoning in complete Markdown paragraphs; name actors and observable behavior, use concrete words, put conditions first, and keep qualifications beside their claims. Supporting detail stays with its explanation. Actions name their effect. Distinguish local from CI checks, passed from untested, and committed, built, pushed, installed, and deployed.
For substantive replies, orient the reader with context; investigations use finding for conclusion/certainty/evidence, changes use change for before/after, and advice uses recommendation for choice/reason/boundary. These are defaults, not requirements for unrelated components. Short replies need no components; a clean test run may need only a sentence.
Compose components as one JSON object per workstreams fence at the body's top level, outside lists or quotes. Call ${REPLY_EXAMPLES_TOOL} for needed types before authoring them; its examples are illustrative, not thread evidence. Ordinary code uses its own language tag. Values are complete readable Markdown, preserved in the text body. Use every required field and only named fields; omit only those marked optional:
context: topic; optional where, background.
text: body (Markdown).
finding: title, explanation, certainty (observed|inferred|unknown); optional consequence, evidence.
comparison: title, 2–8 items with name, summary; optional qualification, detail, recommended. Essential reasons belong in summary or qualification; consequential trade-offs in qualification; supporting explanation in detail. Numerical scores need a stated measurement or scoring method.
sequence: title, steps with title; optional detail, attention per step.
change: title, before, after; optional unchanged, limitation beside the change.
checks: title, scope, items with name, status (passed|failed|skipped|blocked|untested); optional detail, evidence per item. Optional testTotals {passed,failed,skipped} uses actual nonnegative counts.
delivery: title, scope, stages with name, status (done|pending|blocked|unknown); optional detail and evidence per stage. Reported status is not independent proof.
recommendation: choice, reason; optional qualification beside the recommendation.
details: title, body (Markdown). Required actions and important qualifications stay with what they qualify.
group: relationship="peers" for comparable pieces or "supporting" for explanation plus support. children: 2–8 components or nonempty lists kept together, at most 8 components total; no nested groups.
Evidence: label; optional detail, location (HTTPS or literal file path), line, endLine (1-based). Link factual claims to real reports, source, or artifacts and preserve uncertainty. Distinguish a mock's presentation check from verifying its claims. Workspace files use relative paths; external files use absolute paths.
Choose components for the reply's purpose, omit unhelpful ones, and share context, sources, and actions without repeating them per piece. Components display information; required input and approval use question cards, not components.`;

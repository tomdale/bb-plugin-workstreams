# Evaluation

Evaluations make paid AI Gateway calls and never apply their results to plugin
facts. Keep private reference fixtures and outputs outside the public
repository.

## Classification contracts

Run `node eval/classification.ts` for placement, or
`EVAL_KIND=quick node eval/classification.ts` for the actual Quick prompt,
output schema, and parser. Quick flattens a synthetic case's requests into one
opening request; it does not measure conversation trajectories or the production
repair retry. Placement receives generated titles and optional conflicting
hints, checkouts, and current assignments; scoped cases also check `scopeShift`.

- `EVAL_MODEL`: model ID; default `openai/gpt-6-sol` for placement and
  `openai/gpt-6-luna-fast` for Quick
- `EVAL_KIND`: `placement` or `quick`
- `EVAL_REASONING_LEVEL`: explicit gateway effort; default `none`
- `EVAL_OUTPUT`: JSON report path; default `/tmp/classification-eval.json`
- `EVAL_COLD=1`: remove known topics
- `EVAL_REPETITIONS`: repeat each case 1–20 times
- `EVAL_HOLDOUT=1`: use reserved cases

Reports retain responses and usage even on validation failures, with expected
paths, classification mode, repetitions, duration, cost, and p95 latency. The
runner exits nonzero when any case fails. Invalid identities fail rather than
being normalized into guessed topic IDs.

Compare warm main and holdout runs, cold hierarchy choices, and repetitions when
changing a prompt or model. Measure latency against the 15-second first-send
budget. A small perfect synthetic run is not a production accuracy estimate.
Cold Placement checks root ownership because its output can propose only one
topic; full hierarchy remains advisory there. Compare baseline and candidate
with the same fixtures and scoring. See [classification.md](classification.md)
for limits.

## Placement gate

`node eval/placementGate.ts` asks the placement gate's typed question over the
same cases and scores its accepted answers with the same scorer, so a change to
its threshold, question, or model is measured. `EVAL_MODEL` selects the decision
model (default `openai/gpt-6-luna-decisions`), `EVAL_HOLDOUT=1` selects reserved
cases, and `EVAL_OUTPUT` sets the report path (default
`/tmp/placement-gate-eval.json`). A case the gate doesn't settle is reported as
falling back, which is what the placement model would answer, so it is not a
failure; an accepted answer the scorer rejects fails the run. Warm only: a cold
placement answers with a proposal, which a typed question can't express.

## Categories

`node eval/categories.ts` evaluates the production category prompt, schema, and
parser against synthetic collections. Cases cover creation at either topic
depth, keeping a useful arrangement, arrivals, departures, changed work, and
untrusted text in evidence. `EVAL_HOLDOUT=1` uses reserved cases. Partition
checks ignore category-name wording; stability cases also require the explicit
keep decision. This measures the supplied collections, not production grouping
accuracy.

- `EVAL_MODEL`: defaults to the Organization model's shipped default
- `EVAL_REASONING_LEVEL`: defaults to that model's shipped reasoning level
- `EVAL_REPETITIONS`: 1–3; default `1`
- `EVAL_BUDGET`: reported-cost budget with per-call headroom; default `$5`,
  maximum `$10`
- `EVAL_OUTPUT`: default `/tmp/category-eval.json`

The runner is serial, bounds output and call duration, and retains responses,
validation failures, costs, and latency. Keep private baseline and candidate
reports outside the public repository. An existing topic-split prompt can be
compared on creation partitions, but cannot serve as a baseline for the category
keep, persistence, or discard contracts it does not implement. Account for spend
across separate runs when applying an overall authorization limit.

## Group drops

`node eval/group-drops.ts` evaluates the production Placement prompt, schema,
and parser when a user moves a thread into a multi-topic group. Synthetic cases
cover titles, sidebar layout, and question cards while the old topic, project,
and checkout point elsewhere. Every answer must choose an existing leaf within
the destination; the report also checks the expected topic.

- `EVAL_MODEL`: defaults to the production Placement model
- `EVAL_REPETITIONS`: 1–20; default `3`
- `EVAL_OUTPUT`: default `/tmp/group-drops-eval.json`

Reports retain responses, costs, and latency on failures as well as successes.
The runner never changes plugin facts. This small synthetic set checks the
scoped contract, not accuracy on all real threads.

## Titles

`node eval/titles.ts` runs Quick analysis's prompt, schema, and parser on
synthetic opening requests, each listed under a workstream and sometimes a
parent thread; `EVAL_KIND=full` runs Full analysis's on the same requests as a
first turn. `EVAL_KIND=follow` gives Full analysis a title Workstreams wrote and
a later request: a request that only takes the work to its next step must keep
the title, and one that changes the goal must rename it. A title passes when it
starts with an -ing verb that says what kind of work it is, names its case's
subject, repeats nothing its listing shows, and fits a sidebar row
(`EVAL_VISIBLE`, default `34` characters).

- `EVAL_MODEL`: default `openai/gpt-6-luna-fast` (Quick) or
  `openai/gpt-6-sol-fast` (Full)
- `EVAL_REASONING_LEVEL`: default `none`
- `EVAL_REPETITIONS`: default `3`
- `EVAL_OUTPUT`: default `/tmp/title-eval.json`

## Thread goals

`node eval/goals.ts` evaluates the production Full analysis prompt, schema, and
parser on synthetic implementation, refactoring, design, and audit requests.
Cases include misleading recap headlines, housekeeping and testing follow-ups, a
genuine change of purpose, and a user-owned title. Goals must retain the settled
outcome through intermediate steps and follow changes in user intent.

- `EVAL_MODEL`: default `openai/gpt-6-sol-fast`
- `EVAL_REASONING_LEVEL`: default `none`
- `EVAL_REPETITIONS`: 1–20; default `3`
- `EVAL_OUTPUT`: default `/tmp/goal-eval.json`

Reports retain responses, usage, cost, latency, and word counts even on
failures. Subject checks and exact preservation checks are heuristics; word
counts outside the usual 12–20 words are advisory. Inspect the generated
sentences for clarity, success-first framing, and useful detail. This small
synthetic set is not a production accuracy or reader-comprehension estimate.

## Tidy passes

`node eval/tidy.ts` runs the tidy prompt, schema, and parser on synthetic topic
trees, dropping edits the tree's rules refuse, as production does. Each case
lists edits that must appear (a move under the product a top-level topic is part
of, one home for a near-duplicate) and edits that must not (moving a personal
tool under a work product it's named like). It also counts reasons that don't
name their own edit's topics, and checks renames on moves.

- `EVAL_MODEL`: model ID; default `anthropic/claude-sonnet-5.5`
- `EVAL_REASONING_LEVEL`: default `medium`
- `EVAL_REPETITIONS`: repeat each case 1–20 times; default `3`
- `EVAL_CASE`: run one case by ID
- `EVAL_OUTPUT`: JSON report path; default `/tmp/tidy-eval.json`

## Composed replies

`node eval/replies.ts` makes paid, tool-free Gateway calls against synthetic
investigation, change, shipped-change, recommendation, handoff, routing,
waiting, body-only, and short-answer tasks. Each run makes the two authorings a
turn makes: the reply block as plain assistant text, then the `WorkstreamsRecap`
arguments against the production tool schema and the schema the server accepts
at execution.

The reply call scores one closed whole-message block, no recap fields inside it,
malformed components, and reported test counts. Preferred component selections
are recorded as advisory notes, not failures: a valid composition can explain a
fact in prose or use another suitable component. Test counts may appear in prose
or optional structured totals, and prose scoring recognizes explicit numeric or
zero-through-ten word counts beside passed/failed/skipped, including a count
written as an adjective ("one skipped integration test"). Inspect other wording
in recorded responses before treating a count failure as a factual error.

The recap call scores the accepted arguments: the expected state, required Next
items after completed work including a handoff and a shipped change, a route to
a running thread reported as complete, waiting-agent details and polling
interval, no results or actions on a waiting recap, and no unnecessary content
for a short answer. A call the server's schema rejects is answered once with the
rejection message, as the tool answers it inside the turn that made it; the
report keeps every rejection, so a rising repair rate is visible.

- `EVAL_MODEL`: default `openai/gpt-6-luna`
- `EVAL_REASONING_LEVEL`: default `medium`
- `EVAL_REPETITIONS`: 1–5; default `1`
- `EVAL_CASE`: run one case by ID
- `EVAL_OUTPUT`: report path; default `/tmp/reply-eval.json`

Reports preserve both authorings, the readable text, usage, cost, and latency
even when validation fails. A run the gateway cuts off at its token limit is
recorded as skipped and left out of the pass rate. The runner exits nonzero on a
failed or empty run. Examples are supplied as if the read-only guide tool had
returned them, and each authoring is wrapped in a one-field JSON envelope for
the shared Gateway runner; the recap arguments travel in a `recap` field instead
of a real tool call, which the tool-free runner cannot make. Reply guidance uses
the system role, with the component guide and the reply contract as BB delivers
them, and the synthetic request uses the user role, so a request for a brief
answer does not replace the reply-format contract. This checks format and
supplied facts, not tool selection, real harness turn ordering, visual
rendering, or reader comprehension. Those need separate checks.

## Reply architecture slice

`node --experimental-transform-types eval/reply-architecture.ts` previews a
one-case, tool-free experiment without credentials or paid calls. The Node flag
supports the component parser's TypeScript parameter property. Add `--run` to
make at most four paid calls: a pagination diagnosis with the production
reply/component instructions, the same diagnosis with Markdown instructions,
presentation of that exact Markdown response, then a separate fidelity review.
Direct UI authoring and the presenter receive identical worked context, finding,
recommendation, and details examples from the production guide. The semantic
author receives Markdown instructions without the component guide. Both task
authorings receive the same code and question; the presenter receives its source
response, not the original task or reference answers. The deterministic path
preserves the Markdown verbatim as a text component.

`EVAL_MODEL` selects the same model for all calls (default `openai/gpt-6-luna`).
Reasoning is `none`; each call has a 2,048-token output limit and 30-second
deadline. There are no retries. Further calls stop once reported cumulative cost
reaches $0.75; this is not a hard spend cap, since an in-flight call or
unreported cost can exceed it.

The runner prints a fresh temporary artifact directory containing `report.json`,
`semantic.md`, and each path's reply Markdown. The report keeps prompts,
responses, parsed components, timings, reported usage/cost, and failures. It
records the Git revision, a working-tree dirty flag, and the runner's SHA-256;
the hash identifies the runner, not uncommitted changes to its dependencies.
Each path's `checks` separates four dimensions:

- `format`: one closed whole-message reply with valid components and no recap
  fields. Transport errors, empty output, and token limits fail or block this
  check even if a partial reply parses.
- `componentUse`: counts and types of information components, excluding text
  wrappers. `none` is allowed; readable Markdown does not fail format because it
  uses no information components.
- `corruption`: heuristic detection of unfenced component calls, including
  multiline calls without a `workstreams` marker, and reply-delimiter residue or
  nested reply containers. Literal code examples are excluded. These checks
  catch suspected source leakage, not every possible duplicated or garbled
  answer.
- `fidelity`: a separate model call compares direct and semantic answers with
  the task and the presented answer with its exact semantic source. It returns
  `pass`, `fail`, or `review` with reasons and verbatim issue quotes; quotes and
  comparison coverage are validated. Unavailable, truncated, malformed, or
  contradictory judge output becomes `error` or `blocked`, not a pass. The
  deterministic path checks exact source preservation; the semantic source's own
  task fidelity is reported separately as `semanticFidelity`.

The report retains the fidelity request, raw verdicts, latency, and cost as the
`fidelity` call. Total run cost and duration include that evaluation overhead;
it is not a presentation-path cost. The judge uses the selected model in a
separate call and can be wrong or miss an issue. It does not establish factual
truth or replace human inspection. A zero exit requires format and corruption
passes, fidelity passes for all available paths, and a semantic-source fidelity
pass; component use is advisory. `review`, judge errors, and blocked results
exit nonzero. Unusable semantic output blocks both downstream paths. Use the
report's manual questions to inspect the diagnosis, corrected offsets,
unverified execution, and fidelity to the source.

This slice checks task authoring through presentation syntax. It does not run
workspace tools, render a browser comparison, measure reader preference, or
establish an architecture winner. It does not change the live reply path.

## Recap corrections

`node eval/recap-corrections.ts` compares the previous and current reminder
using synthetic conversations and real Gateway tool selection. It checks an
already-answered request, an unanswered request, and a request needing a
question card. The answered case passes only when the agent calls the recap
without more text; the unanswered case requires the answer in the reply or recap
and a valid recap call. The question case requires a valid question call without
repeating the previous message. If the agent stops without calling a tool, the
runner sends up to three reminders, retaining its replies. This small test
cannot establish a production failure rate or reproduce BB's complete provider
session.

- `EVAL_MODEL`: default `openai/gpt-6-luna`
- `EVAL_REASONING_LEVEL`: default `xhigh`
- `EVAL_REPETITIONS`: 1–5; default `1`
- `EVAL_OUTPUT`: default `/tmp/recap-corrections-eval.json`

The report includes both variants' text, tool arguments, and usage. The runner
exits nonzero when a candidate case fails.

## Status fixtures

`node eval/run.ts [model ...]` runs analysis evaluations against supported
synthetic fixtures. Private fixture/output paths must satisfy the runner's
configured private storage policy.

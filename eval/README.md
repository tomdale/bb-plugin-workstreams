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
investigation, change, shipped-change, recommendation, handoff, uncertainty,
waiting, body-only, and short-answer tasks. It uses the production instructions,
component examples, parser, and recap validation. Checks cover one closed
whole-message reply, usable recaps and required result lists, malformed
components, reported test counts, explicit uncertainty cues, required Next items
after completed work including a handoff and a shipped change, waiting-agent
details, body-only formatting, and unnecessary content in short answers. Test
counts may appear in prose or optional structured totals. Prose scoring
recognizes explicit numeric or zero-through-ten word counts next to
passed/failed/skipped; inspect other wording in recorded responses before
treating a count failure as a factual error. Preferred component selections are
recorded as advisory notes, not failures: a valid composition can explain a fact
in prose or use another suitable component. The uncertainty check is a
phrase/status heuristic; inspect the recorded replies to judge whether their
claims are true.

- `EVAL_MODEL`: default `openai/gpt-6-luna`
- `EVAL_REASONING_LEVEL`: default `medium`
- `EVAL_REPETITIONS`: 1–5; default `1`
- `EVAL_CASE`: run one case by ID
- `EVAL_OUTPUT`: report path; default `/tmp/reply-eval.json`

Reports preserve the reply, readable text, usage, cost, and latency even when
validation fails. The runner exits nonzero on a failed or empty run. Examples
are supplied as if the read-only guide tool had returned them; the model's reply
is wrapped in a JSON field for the shared Gateway runner. Reply guidance uses
the system role, with tool guidance before the main reply contract as BB
delivers it, and the synthetic request uses the user role, so a request for a
brief answer does not replace the reply-format contract. This checks format and
supplied facts, not tool selection, real harness turn ordering, visual
rendering, or reader comprehension. Those need separate checks.

## Status fixtures

`node eval/run.ts [model ...]` runs analysis evaluations against supported
synthetic fixtures. Private fixture/output paths must satisfy the runner's
configured private storage policy.

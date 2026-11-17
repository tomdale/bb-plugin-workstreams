# Evaluation

Evaluations make paid AI Gateway calls and never apply their results to plugin
facts. None of them has an npm script; run each with `node`. Keep private
reference fixtures and outputs outside the public repository.

## Classification contracts

Run `node eval/classification.ts` with `EVAL_KIND` set to `workstream-choice`
(the default), `start` (title and workstream from the opening request), or
`turn-end` (description and workstream from the case's requests as a first
turn). Each kind uses its production prompt, output schema, and parser; in model
traces they appear as Workstream choice, New thread, and Turn end. A start joins
a synthetic case's requests into one opening request, so it does not measure
conversation trajectories or the production retry. Every kind receives generated
titles where it reads them, optional conflicting hints, checkouts, and the
thread's current workstream; cases with an expected scope change also check
`scopeShift`. Cases live in `eval/classification-cases.ts`.

- `EVAL_MODEL`: model ID; default `openai/gpt-6.1-sol`
- `EVAL_KIND`: `workstream-choice`, `start`, or `turn-end`
- `EVAL_REASONING_LEVEL`: explicit gateway effort; default `none`
- `EVAL_OUTPUT`: JSON report path; default `/tmp/classification-eval.json`
- `EVAL_COLD=1`: remove the known workstreams and groups
- `EVAL_REPETITIONS`: repeat each case 1–20 times; default `1`
- `EVAL_HOLDOUT=1`: use the reserved `holdout-` cases

Reports hold responses and costs even on validation failures, with expected
paths, warm or cold mode, split, repetitions, durations, total cost, and p95
latency. The runner exits nonzero when any case fails. An answer with an
unlisted workstream ID fails without the runner guessing which workstream it
meant.

Compare warm main and holdout runs, cold runs, and repetitions when changing a
prompt or model. For `start`, measure latency against the start call's 15-second
attempt timeout. A small perfect synthetic run is not a production accuracy
estimate. In a cold run the model can propose only one new workstream, so
acceptance checks that the top of the proposed path matches the expected one
(the report's `acceptance` field says `top-level ownership`). The report records
full-path matches as advisory. Compare baseline and candidate with the same
fixtures and scoring. See [classification.md](classification.md) for limits.

## Categories

`node eval/categories.ts` evaluates the production category prompt, schema, and
parser against synthetic threads in one workstream (cases in
`eval/category-cases.ts`). Cases cover creating categories in a standalone
workstream and in a workstream inside a group, keeping a useful arrangement,
arrivals (forming a new category or joining an existing one), departures,
changed work, rearranging an arrangement that is mostly single-thread
categories, and untrusted text in a thread's work. `EVAL_HOLDOUT=1` uses the
reserved `holdout-` cases. Partition checks ignore category-name wording, except
flagged cases that fail names joining scopes with "and" or commas; stability
cases also require the model's explicit keep decision. The score covers the
supplied threads and is no estimate of production category accuracy.

- `EVAL_MODEL`: defaults to the Arrange categories model's shipped default
- `EVAL_REASONING_LEVEL`: defaults to that model's shipped reasoning level
- `EVAL_KIND`: `rearrange` (default) or `fit`, the Category check call that
  tests changed threads against the current categories. `fit` runs only the
  cases that have current categories and a changed thread, defaults to the Name
  and organize new threads model, and uses reasoning `none` unless
  `EVAL_REASONING_LEVEL` is set. A `fit` case passes when the check puts every
  changed thread into the expected categories, or sends the case to a full
  rearrangement when the current categories can't reach the expected ones.
- `EVAL_REPETITIONS`: 1–3; default `1`
- `EVAL_BUDGET`: reported-cost budget in dollars; default `5`, maximum `10`. The
  runner stops starting calls once reported cost reaches 75% of the budget, to
  leave room for one call in flight.
- `EVAL_OUTPUT`: default `/tmp/category-eval.json`

The runner makes one call at a time, bounds output and call duration, and keeps
responses, validation errors, costs, and latency in its report. It exits nonzero
when a case fails or the budget stops the run. Keep private baseline and
candidate reports outside the public repository. You can compare a
split-suggestion prompt on creation partitions. It implements no category keep,
persistence, or discard contract, so it is no baseline for those. Add up spend
across separate runs when applying an overall spending limit.

## Group drops

`node eval/group-drops.ts` evaluates the production workstream choice prompt,
schema, and parser for the case where the user moves a thread onto a group that
holds several workstreams. Synthetic cases cover titles, sidebar layout, and
question cards while the thread's previous workstream, project, and checkout
point elsewhere. Every answer must choose an existing workstream inside the
destination group; the report checks it against the expected workstream.

- `EVAL_MODEL`: defaults to the Name and organize new threads model
- `EVAL_REPETITIONS`: 1–20; default `3`
- `EVAL_OUTPUT`: default `/tmp/group-drops-eval.json`

Reports keep responses, costs, and latency for failures as well as passes. This
small synthetic set checks the call's contract and says nothing about accuracy
on real threads.

## Titles

`node eval/titles.ts` runs synthetic opening requests through the production
prompts, schemas, and parsers. Each case in `eval/title-cases.ts` lists the
thread under a workstream path such as `Harbor › Sandbox Plugin`, and a child
thread also under its parent thread. `EVAL_KIND` selects the call:

- `start` (default): the start call; for a thread that isn't a child thread, the
  listed path is the workstream list it chooses from.
- `turn-end`: the turn-end call as a first turn, with that workstream already
  chosen.
- `turn-end-follow`: the turn-end call sees a title Workstreams wrote and a
  later request. A request that only takes the work to its next step must keep
  the title, and one that changes the goal must rename it.

A new title passes when it starts with an -ing verb that says what kind of work
it is, includes its case's subject, repeats nothing its listing shows, and fits
a sidebar row (`EVAL_VISIBLE`, default `34` characters).

- `EVAL_MODEL`: default `openai/gpt-6.1-sol`
- `EVAL_REASONING_LEVEL`: default `none`
- `EVAL_REPETITIONS`: 1–20; default `3`
- `EVAL_OUTPUT`: default `/tmp/title-eval.json`

## Thread goals

`node eval/goals.ts` evaluates the production turn-end prompt, schema, and
parser, which also chooses a workstream from a small list, on synthetic
implementation, refactoring, design, and audit requests. Cases include
misleading recap headlines, housekeeping and testing follow-ups, a real change
of purpose, and a title the user wrote. Goals must keep the settled outcome
through intermediate steps and follow changes in what the user wants.

- `EVAL_MODEL`: default `openai/gpt-6.1-sol`
- `EVAL_REASONING_LEVEL`: default `none`
- `EVAL_REPETITIONS`: 1–20; default `3`
- `EVAL_OUTPUT`: default `/tmp/goal-eval.json`

Reports keep responses, usage with cost, latency, and word counts even on
failures. Subject checks and exact preservation checks are heuristics; word
counts outside the usual 12–20 words are advisory notes. Inspect the generated
sentences for clarity, success-first framing, and useful detail. This small
synthetic set is not a production accuracy or reader-comprehension estimate.

## Suggested changes

`node eval/tidy.ts` runs the Suggest changes prompt, schema, and parser (the
`tidy` call, shown as Suggested changes in model traces) on synthetic
workstreams and groups, and drops edits the structure's rules refuse, as
production does. Each case in `eval/tidy-cases.ts` lists edits that must appear
(moving a workstream into the product it is part of, renames that remove a
repeated parent name, one home for a near-duplicate) and edits that must not
(moving a personal tool into a work product whose capability has a similar
name). The report lists each reason that doesn't mention a workstream or thread
from its own edit (`offWorkstream`); a case that expects a rename passes only
when the move or rename gives the expected name.

- `EVAL_MODEL`: model ID; default `anthropic/claude-sonnet-5.5`
- `EVAL_REASONING_LEVEL`: default `medium`
- `EVAL_REPETITIONS`: repeat each case 1–20 times; default `3`
- `EVAL_CASE`: run one case by ID
- `EVAL_OUTPUT`: JSON report path; default `/tmp/tidy-eval.json`

## Composed replies

`node eval/replies.ts` makes paid, tool-free Gateway calls against synthetic
investigation, change, shipped-change, recommendation, handoff, routing,
waiting, blocked, body-only, report-components, and short-answer tasks. Each run
makes the two authorings a turn makes, in the order the reply contract puts
them: the `WorkstreamsRecap` arguments, checked against the production tool
schema and the schema the server accepts at execution, then the reply block as
plain assistant text, written with the recap it already reported in hand.

The reply call scores one closed whole-message block, no recap fields inside it,
malformed components, and reported test counts. Preferred component selections
are recorded as advisory notes: a valid composition can explain a fact in prose
or use another suitable component. Test counts may appear in prose or optional
structured totals, and prose scoring recognizes explicit numeric or
zero-through-ten word counts beside passed/failed/skipped, including a count
written as an adjective ("one skipped integration test"). Inspect other wording
in recorded responses before treating a count failure as a factual error.

The short-answer task asks for a fact only, so it expects that fact as plain
text with no reply block, matching the exact-output rule in the reply
instructions. The body-only task runs with recaps turned off and fails a reply
block that includes recap fields.

The recap call scores the accepted arguments: the expected state, required Next
actions after completed work including a handoff and a shipped change, a route
to a running thread reported as complete, waiting-agent details and polling
interval, no results or actions on a waiting recap, at least one `unblock` step
and no Next actions or links on a blocked recap, and no unnecessary content for
a short answer. When the server's schema rejects a call, the runner answers once
with the rejection message, as the tool answers it inside the turn that made it;
the report lists every rejection, so a rising repair rate is visible.

- `EVAL_MODEL`: default `openai/gpt-6-luna`
- `EVAL_REASONING_LEVEL`: default `medium`
- `EVAL_REPETITIONS`: 1–5; default `1`
- `EVAL_CASE`: run one case by ID
- `EVAL_OUTPUT`: report path; default `/tmp/reply-eval.json`

Reports keep both authorings, the readable text, usage, cost, and latency even
when validation fails. The report marks a run the gateway cuts off at its token
limit as skipped and left out of the pass rate. The runner exits nonzero on a
failed or empty run. The runner supplies examples as if the read-only guide tool
had returned them, and the model returns the reply in a one-field JSON envelope
for the shared Gateway runner. The recap arguments arrive in a `recap` field of
a JSON answer, because the tool-free runner cannot make a real tool call. Reply
guidance uses the system role, with the component guide and the reply contract
as BB delivers them, and the synthetic request uses the user role, so a request
for a brief answer does not replace the reply-format contract. This checks
format and supplied facts. Tool selection, real harness turn ordering, visual
rendering, and reader comprehension need separate checks.

## Reply comparison

`node --experimental-transform-types eval/reply-architecture.ts` previews a
one-case experiment without credentials or paid calls. The Node flag supports
the reply parser's TypeScript parameter property. Add `--run` to compare:

- **Answer and format in one step:** one model writes the answer and chooses its
  UI blocks.
- **Show the answer as written:** one model writes Markdown, which is displayed
  unchanged inside a text block.
- **Answer first, format in a second step:** a second model arranges that same
  Markdown answer into UI blocks.

Both ways of writing the answer receive the same code and question. Both steps
that choose UI blocks receive identical worked examples from the production
guide. The second-step formatter receives the answer to arrange, without the
original task or reference answers. A fourth model call checks whether the
answers kept the required meaning. The experiment has no execution tools.

`EVAL_MODEL` selects the same model for all calls (default `openai/gpt-6-luna`).
Reasoning is `none`; each call has a 2,048-token output limit and 30-second
deadline. There are no retries. The runner stops making calls once reported
cumulative cost reaches $0.75. This is not a hard spend cap, since an in-flight
call or unreported cost can exceed it.

The runner prints a fresh temporary artifact directory containing `report.json`,
`semantic.md`, and each approach's reply Markdown. The report keeps prompts,
responses, parsed components, timings, reported usage and cost, and failures. It
records the Git revision, a working-tree dirty flag, and the runner's SHA-256;
the hash identifies the runner file, and does not cover uncommitted changes to
its dependencies. The console uses the three approach names above. Saved reports
and filenames use `direct`, `deterministic`, and `presentation`, respectively;
`semantic.md` holds the answer before formatting. Each approach's `checks`
records:

- **Valid format?** (`format`): one closed whole-message reply with valid UI
  blocks and no recap fields. Failed requests, empty output, and token limits
  fail or block this check even if a partial reply can be read.
- **UI blocks** (`componentUse`): counts and types of information blocks,
  excluding text wrappers. Zero is allowed; readable Markdown with no
  information blocks passes.
- **Broken text?** (`corruption`): checks for component calls printed as prose,
  leftover reply markers, and nested reply containers. Literal code examples are
  excluded. These checks can miss duplicated or garbled answers; the console
  says `none found` when they find no problems.
- **Meaning kept?** (`fidelity`): a separate model compares each written answer
  with the task, then compares the formatted answer with the exact answer it
  received. It returns `pass`, `fail`, or `review` with reasons and exact
  quotes; the runner validates the quotes and checks that the model answered
  every comparison. Missing, cut-off, malformed, or contradictory review output
  becomes `error` or `blocked`. **Show the answer as written** checks for an
  exact copy, which says nothing about whether the diagnosis is correct. The
  answer before formatting is checked against the task separately as
  `semanticFidelity`.

The report keeps the meaning check's request, raw responses, time, and cost as
the `fidelity` call. Total run cost and duration include this review, which
plays no part in producing an answer. The review uses the selected model in a
separate call and can be wrong, so it does not replace human inspection. A zero
exit requires valid format, no detected broken text, and a meaning-check pass
for all three approaches and the answer before formatting. The number of UI
blocks does not affect the exit status. Uncertain reviews, failed checks, and
missing results exit nonzero. An unusable answer before formatting blocks both
approaches that depend on it. Use the report's manual questions to inspect the
diagnosis, corrected offsets, unverified execution, and any changed meaning.

This experiment checks writing an answer and formatting it. It does not run
workspace tools, render a browser comparison, measure reader preference, or
establish which approach is best. It does not change live replies.

## Recap corrections

`node eval/recap-corrections.ts` compares a fixed baseline reminder with the
production recap reminder (`RECAP_REMINDER`), using synthetic conversations and
real Gateway tool selection. It checks an already-answered request, an
unanswered request, and a request that needs a question card. The answered case
passes when the agent calls the recap and any text it writes is one short line
that doesn't repeat the earlier answer. The unanswered case requires the answer
in the reply or recap, at most one line of text, and a valid recap call. The
question case requires a valid question call without repeating the previous
message. If the agent stops without calling a tool, the runner sends up to three
reminders and records each reply. This small test cannot establish a production
failure rate or reproduce BB's complete provider session.

- `EVAL_MODEL`: default `openai/gpt-6-luna`
- `EVAL_REASONING_LEVEL`: default `xhigh`
- `EVAL_REPETITIONS`: 1–5; default `1`
- `EVAL_OUTPUT`: default `/tmp/recap-corrections-eval.json`

The report includes both variants' text, tool arguments, and usage. The runner
exits nonzero when a production-reminder case fails.

## Status fixtures

`node eval/run.ts [model ...]` runs every fixture in `eval/cases.json`,
`eval/holdout.json`, `eval/delegation.json`, and `eval/state.json` through the
production turn-end call (status and title). In the cold runs that call also
chooses a workstream from an empty list, and the proposed workstream is scored
against the fixture's expected names. For `cases` and `state` it also runs the
start call on the opening request and the turn-end call with no title. With no
arguments it compares `google/gemini-3.1-flash-lite` and `openai/gpt-4.1-mini`;
a `:disabled` suffix on a model ID turns thinking off. The console shows each
model's scores: valid responses, workstream matches per fixture set, how many
pairs of related threads share a proposed workstream and how many unrelated
pairs were merged, status accuracy and Needs input recall, titles, latency,
cost, and misses. `EVAL_OUTPUT` writes the full report with every result.

`EVAL_PRIVATE` adds a private fixture file. A private run requires
`EVAL_PRIVATE_ROOT` and an `EVAL_OUTPUT` inside it, and the console omits
private cases from its examples and misses.

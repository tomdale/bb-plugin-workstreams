# Workstream choice evaluation

Run `node eval/classification.ts` with AI Gateway authentication available. This
opt-in evaluation makes paid model calls and does not move threads or change
workstreams. Fixtures are synthetic; production has no fixture-specific rules or
synonym tables.

`EVAL_KIND` selects the call: `workstream-choice` (default), `start`, or
`turn-end`, each with its production prompt, schema, and parser. A start
combines synthetic requests into one opening request and does not evaluate
temporal behavior. `EVAL_MODEL` selects the model, `EVAL_REASONING_LEVEL`
selects effort, `EVAL_OUTPUT` selects the report, `EVAL_COLD=1` removes known
workstreams, `EVAL_REPETITIONS` repeats cases, and `EVAL_HOLDOUT=1` selects
reserved variants. Reports retain raw responses and usage even on parser
failures, expected paths, mode, split, repetitions, durations, cost, and p95
latency. Invalid responses fail and produce a nonzero exit status.

Cases cover product and capability ownership, repositories, scheduling, sibling
capabilities, misleading titles, schema work, symptom versus defect ownership,
follow-up work, display modes, shared SDK deliverables, infrastructure
consumers, and unresolved requests. Holdouts test misleading titles and explicit
ancestry. The workstream choice receives each case's generated title and
optional conflicting checkout, hints, and current workstream. Cases with an
expected scope change also check `scopeShift`.

The specificity cases test work on one capability of a broad workstream with no
workstream for that capability: the answer is a new workstream under the broad
one. Work on the broad workstream as a whole, or a task naming no capability,
keeps the broad workstream. The new-workstream cases test the tree they carry,
so cold runs skip them.

The lookalike cases carry their own tree, with a pane workstream in the group of
an unrelated app whose description fits the request. The request names its
owner. When the platform's own plugin workstream exists beside the pane, it is
the expected workstream. When it does not, the answer is a new workstream
outside the app's group; choosing the pane, the app, or No workstream fails, and
a proposal is anchored as production anchors it. These cases test the tree they
carry, so cold runs skip them.

Warm acceptance requires the expected existing workstream or supported proposal.
Cold calls can propose only one workstream, so acceptance checks top-level
ownership against evaluation-only synonyms, while capability and hierarchy
matches remain advisory. Reports state the acceptance criterion and retain
hierarchy and exact-path measurements separately. Compare baseline and candidate
using the same runner, fixtures, and scoring. Scores do not evaluate invented
descriptions or guarantee extra descendants are useful.

Rerun public and holdout splits after changing a prompt or model. Do not treat
exact-match failures as a semantic error rate or a successful hierarchy score as
proof descriptions are grounded.

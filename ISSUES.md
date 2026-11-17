# Workstreams issues

This list distinguishes confirmed defects from SDK limitations and intentional
behavior. Resolved defects belong in regression tests and Git history, not an
open bug list. Paths below are relative to this package.

## Open limitations

### Provider-worker generation controls and telemetry

**Evidence:** `src/server/inference/worker.ts`, `src/server/index.ts`, and the
released SDK 0.6.5 `ThreadSpawnArgs` / `ThreadOutputResponse` types.

Non-Gateway models run in hidden BB threads. The spawn API has no output-schema
or output-token-limit fields, and `threads.output` returns text only. Responses
are parsed and validated, but generation cannot be constrained in the same way
as a direct Gateway call. Token usage, cost, and reasoning metadata are
unavailable; worker traces use `usage: null`, not fabricated zero usage. The
usage record counts each worker call as a request with no reported cost, so the
requests-per-hour limit covers worker calls and the spend limits do not.

**Workaround:** Use a Gateway model for constrained output and reported usage.
The requested completion API is recorded in the BB SDK wishlist,
`docs/bb-sdk-wishlist.md` in tomdale/bb-plugins. Do not infer total spend from
the sum of reported costs when worker calls exist.

### Spend the usage ledger and pause thresholds do not see

**Evidence:** `tests/server/usage-instrumentation.test.ts`, `eval/`,
`src/server/index.ts` (`threadSend`), `src/server/questions/store.ts`, and
`docs/usage.md`.

The ledger counts the model calls, compositions, debug threads, and recap
reminders that Workstreams sends. It does not count your own messages and
question answers, which start turns in your threads; the eval runners, which
call AI Gateway directly under their own `EVAL_BUDGET`; or a turn BB re-attempts
itself after a failure, since the plugin sent that message once. Calls already
in flight when a pause threshold is reached finish, so spend can pass the
threshold by what they cost. Every other path to a provider goes through the
gate, and the instrumentation test fails when a new one does not.

**Workaround:** Give AI Gateway keys their own budget in Vercel for a hard stop
that covers everything on a key, including the evals. Add up eval spend across
runs when applying an overall limit.

### Enhanced responses have not run with a real model

**Evidence:** `src/server/postTurn/`, `src/server/inference/presentation/`, and
`src/app/postTurn/`; tests in `tests/server/postTurn/` and
`tests/app/post-turn-documents.test.tsx`.

The composition loop has run only against scripted models. No presentation model
has composed a document, so image delivery through AI Gateway's Messages
endpoint, the model's use of the screenshots, latency, cost, and whether the
document preserves the response's meaning are all unmeasured. Structural
validation and screenshots cannot establish meaning.

The appended view finds its row by BB's internal assistant message id
(`<thread>:assistant:kind:assistant|turn:…|parent:root|item:…`), which BB does
not publish; if the format changes, documents stop appearing and the original
responses are unaffected. BB has no slot below a message, so the view appends
its own element to the timeline row. Previews always use the dark theme, and the
document header shows the workstream captured when the document was composed. A
recap reminder's one-line reply is composed like any other final response.

**Workaround:** Keep the setting off outside trials. Check a thread's documents
with `bb plugin rpc call workstreams presentations`.

### Snooze in BB's thread menus

**Evidence:** `src/app/snooze/threadAction.ts` and the SDK's
`PluginThreadActionChoice`, which has only `id`, `label`, `icon`, `selected`,
and `disabled`.

BB's thread menus and the Quick Actions ring list the snooze presets by name,
without the wake time each would pick, and mark no default among them. The
action's `detail` names the default preset, which Quick Actions matches by label
to light it. Custom… needs this plugin's dialog, so those menus leave it out.

**Workaround:** The thread header's Snooze menu shows wake times and Custom…. A
choice-level detail and default flag are recorded in the BB SDK wishlist,
`docs/bb-sdk-wishlist.md` in tomdale/bb-plugins.

### Workstream discovery without a matching known area

**Evidence:** `eval/classification-cases.ts`, `src/domain/classify.ts`, and
`src/domain/workstreamChoice.ts`.

A workstream choice can pick a similarly described workstream in the wrong group
when the correct area is absent; in the synthetic eval, faster models such as
`openai/gpt-6-luna` do this far more often than `openai/gpt-6.1-sol`. Cold
discovery can also establish a product without its supported capability, or name
a new thread's workstream for a capability alone. Structural validation keeps
threads out of groups and paths within two levels; it does not check that the
choice is right. A small synthetic evaluation is not a production accuracy
estimate.

**Workaround:** Review previews of automatic moves and split suggestions. A
turn's end reconsiders the workstream after each new request; a workstream you
choose stays.

### Workstream choice and suggestion evidence

**Evidence:** `src/server/workstreamChoice.ts`, `src/domain/tidy.ts`.

Choosing a workstream reads requests, title, project, and checkout; it doesn't
read the titles or changed files of pull requests a thread names, since the
plugin has no GitHub client. Checkout hints and the coordination check know only
the checkouts Workstreams has recorded, so a thread whose workstream was chosen
before its checkout was recorded contributes nothing until its workstream is
chosen again. Tidy sees threads by title and checkout, at most 12 per
workstream.

### User-selected colors

**Evidence:** `src/domain/spinner.ts`, `src/app/settings/SpinnerSettings.tsx`,
and `src/domain/workstreamColor.ts`.

Custom colors accept any valid hex value, including low-contrast choices.
Workstream colors are allocated from a finite palette; a large family or many
workstreams can produce similar colors. Labels and status text remain necessary;
color is not an identity or status guarantee.

### Stream Deck keys

**Evidence:** `src/server/streamDeck.ts`, `src/app/upNext/StreamDeckBridge.tsx`,
and `stream-deck/src/render.ts`.

The Next key and the keys that open a thread act in every connected BB app, a
phone included, because BB's thread open and plugin realtime signals reach all
of them. The keys leave out the thread open in the BB app that reported last,
and each app reports when it opens a thread or comes to the front. After you use
BB on a phone, the keys leave out the phone's thread until the desktop app comes
to the front again. The plugin breaks key text into lines using Helvetica Neue's
widths as Chrome measures them; Stream Deck draws the text itself, so a line can
end a little short or run slightly long. The plugin supports only macOS.

### Suggestions the review cannot draw

**Evidence:** `src/server/suggestions.ts` (`delta`) and
`src/app/sidebar/suggestionMiniatures.ts`.

The review draws the sidebar after a suggestion from its `delta`. Two kinds of
suggestion have none: a change that needs a workstream another suggestion of the
same pass creates, and a split whose workstream gained threads since it was
made, since a model call places those threads only when you accept it. Neither
shows a drawing, and **Accept** still works. The drawing counts threads without
their child threads, as suggestions do, and leaves out categories. Snoozed
threads are dashed ticks, only in the workstreams a change touches. Archived
threads are only counted, never drawn, since a workstream can hold thousands.

**Workaround:** Accept the suggestion that creates the workstream first; a
split's newcomers land where the model places them, which Activity records.

### An old reply's unfinished results

**Evidence:** `src/domain/reply.ts` (`parse`) and
`src/app/reply/LegacyCard.tsx`.

A reply that carries a card keeps its unchecked results in the body as a "Not
done" section, so they stay visible when the live card, not the block, draws the
turn. Where the block draws the card's fields itself, that section reads as a
Markdown heading above the labelled Done, Review, Links and Next rows, and the
card's own Not done row stays empty. The two shapes show the same unfinished
work; the heading above a label row is not a distinction the stored data makes.

### A part that fails to parse draws as body text

**Evidence:** `src/app/reply/PlainBody.tsx`.

A component the schema rejects prints its reason and then its source at body
size, in body order. The reply renderer has no fallback frame, so the problem is
legible without announcing that the part below it is not the real thing.

### Best-effort redaction

**Evidence:** `src/domain/redact.ts`.

Regex masking covers common credential shapes, not every possible secret. It is
not an access-control or data-loss-prevention boundary. Inspect diagnostic
exports before sharing; don't put secrets in prompts. Provider processing
policies apply to conversation excerpts sent for analysis.

## Audit findings that are not defects

- **Completed threads in workstreams:** A completed thread stays in its
  workstream and counts toward category eligibility like any other visible
  thread, so finishing work never empties a workstream or discards its
  categories; see `tests/server/grouping-regressions.test.ts`.
- **Nested Up Next / archive destinations:** Up Next contains only threads
  without a parent, so child threads cannot become separate archive destinations
  in that band. See `tests/domain/upNext.test.ts` and
  `tests/domain/upNextNavigation.test.ts`.
- **Projection defaults:** The pure projection (`src/domain/project.ts`) has no
  stored analysis input, so its default `needsYou` predicate can only inspect
  native pending interactions. App and CLI callers supply the shared `needsYou`
  rule from `src/domain/status.ts`.
- **Archive offer withdrawal:** `useArchiveOffer` deliberately treats drafting a
  continuation as declining Archive for that recap. Clearing the draft does not
  restore it; a new recap can offer Archive again. This behavior is explicitly
  covered in `tests/app/recap-card.test.tsx`. The thread header and context menu
  remain available for deliberate archive actions.
- **Status labels versus JSON states:** CLI text prints status labels (Needs
  input, Blocked, Ready for review, Waiting, Complete); `--json` prints the
  stored work states `needs-input`, `blocked`, `review`, `waiting`, and
  `complete`. Working and Failed come from BB's runtime state: `error` is a BB
  thread status, not an inferred `WorkState` value.
- **Similar labels:** “New threads” names a settings section while “New work” is
  a sidebar menu action. They are not separate features or state values.
- **Snooze dates:** A weekday rule is always a future day: Saturday at 9 AM
  chosen on a Saturday means next Saturday. Use a Today rule or Custom… for the
  current day.
- **Wake event timing:** Turn-end events are checked when BB reports the turn
  idle, when its recap or turn-end analysis lands, and on the minute-long
  reconcile. Lasting conditions (a pending question, failed send, machine wait)
  are dated by the inventory read before the one that showed them, so one that
  began within a minute before or after a snooze may be taken as older and not
  wake it; a question card's own event still wakes it at once. Pull request
  state is polled every 5 minutes. A child thread cut off without failing (an
  interrupted turn that ends idle) is not seen as failed. A server restart
  forgets failure times (a failed turn then counts when its attention moved
  after the snooze) and how each turn first read, so a turn re-analyzed after a
  restart counts by its new reading.
- **Retitle enablement checks:** Re-checking title settings after awaited SDK
  work protects against a setting change during the request, not redundant
  validation.

## Regression coverage for confirmed defects

- Workstream dialog name, description, and alias limits:
  `tests/app/workstream-dialog-limits.test.tsx`.
- Activity debug filters and empty states: `tests/app/activity-debug.test.tsx`.
- Overview's thread list, follow-ups, and missing-workstream states:
  `tests/app/overview.test.tsx`.
- Setting-save errors and title-lock copy: `tests/app/settings.test.tsx`.
- Snooze rules, preset repair, and valid custom snoozes:
  `tests/domain/snooze.test.ts`, `tests/app/custom-snooze-dialog.test.tsx`,
  `tests/app/snooze-settings.test.tsx`.
- Wake events: `tests/domain/wake.test.ts`, `tests/server/snooze-wake.test.ts`.
- Question answer limits and attachment availability: `tests/app/question/`.
- Sidebar ordering/drop affordances and shared band preferences:
  `tests/app/drop.test.ts`, `tests/app/sidebar-drag.test.tsx`,
  `tests/app/sidebar-render.test.tsx`.
- CLI JSON, bounded output, diagnostics, and repair preview titles:
  `tests/server/cli-workstreams.test.ts`, `tests/server/service.test.ts`,
  `tests/server/trace.test.ts`, `tests/server/reclassification.test.ts`.
- Shared attention rules and response validation: `tests/domain/status.test.ts`,
  `tests/domain/analysis.test.ts`, `tests/domain/recap.test.ts`.
- Unknown worker usage: `tests/server/worker.test.ts`.
- Bounded inspector history explicitly reports truncation:
  `tests/app/inspector-limit.test.tsx`.
